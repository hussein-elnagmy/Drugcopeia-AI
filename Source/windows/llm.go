package main

/*
 * Dawaya AI - Windows on-device runtime.
 *
 * The Go launcher owns the model file and a bundled llama.cpp server. Everything
 * below stays on loopback: the browser talks to /__dawaya/llm/*, the launcher
 * talks to llama-server on 127.0.0.1 with a random port and API key, and the only
 * outbound request in the whole file is the user-initiated model download, which
 * is restricted to the hosts declared in assets/ai/model-config.json.
 *
 * The web layer never downloads model bytes itself and never sends prompt text
 * anywhere: tokens are streamed back over a server-sent-event channel bound to
 * this same loopback server.
 */

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const downloadUserAgent = "Dawaya/1.7.8 (offline medicine guide; model download)"

type aiConfig struct {
	Model struct {
		ID       string   `json:"id"`
		Version  int      `json:"version"`
		Name     string   `json:"name"`
		FileName string   `json:"fileName"`
		URL      string   `json:"url"`
		Mirrors  []string `json:"mirrorUrls"`
		Size     int64    `json:"sizeBytes"`
		SHA256   string   `json:"sha256"`
	} `json:"model"`
	Generation struct {
		NCtx          int     `json:"n_ctx"`
		ThreadsFloor  int     `json:"n_threads_floor"`
		Temperature   float64 `json:"temperature"`
		TopK          int     `json:"top_k"`
		TopP          float64 `json:"top_p"`
		RepeatPenalty float64 `json:"repeat_penalty"`
		MaxTokens     int     `json:"n_predict_max_new_tokens"`
		BatchSize     int     `json:"batch_size"`
	} `json:"generation"`
	Device struct {
		MinRAMMB  int `json:"minRamMB"`
		MinDiskMB int `json:"minDiskMB"`
	} `json:"device"`
}

type llmService struct {
	cfg    aiConfig
	dir    string // %LOCALAPPDATA%\Dawaya\models
	binDir string // extracted llama-server directory

	mu           sync.Mutex
	part         string // current .part path
	cancelDL     context.CancelFunc
	paused       atomic.Bool
	cancelled    atomic.Bool
	downloading  atomic.Bool
	downloadID   string
	lastError    string
	server       *exec.Cmd
	serverPort   int
	serverKey    string
	serverThread int
	loaded       bool
	running      atomic.Bool
	activeCancel context.CancelFunc
	activeMu     sync.Mutex

	eventsMu sync.Mutex
	events   map[chan string]struct{}
}

func newLLMService(cfg aiConfig, dataDir, binDir string) *llmService {
	s := &llmService{cfg: cfg, dir: filepath.Join(dataDir, "models"), binDir: binDir, events: map[chan string]struct{}{}}
	_ = os.MkdirAll(s.dir, 0o755)
	return s
}

/* ---------- embedded config and runtime staging ---------- */

func loadAIConfig() aiConfig {
	var cfg aiConfig
	data, err := fs.ReadFile(content, "www/assets/ai/model-config.json")
	if err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	return cfg
}

/*
 * The llama.cpp runtime is embedded in the exe and unpacked once into the app's
 * local data folder. A short marker file records the runtime build so a newer
 * release replaces the extracted copy instead of reusing mixed DLLs.
 */
func ensureLLMRuntime(dataDir string) string {
	dir := filepath.Join(dataDir, "runtime")
	marker := filepath.Join(dir, ".runtime-version")
	if data, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(data)) == llamaVersion {
		return dir
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return dir
	}
	_ = fs.WalkDir(llamaRuntime, "llama", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		relative := strings.TrimPrefix(strings.TrimPrefix(name, "llama"), "/")
		if relative == "" {
			return nil
		}
		target := filepath.Join(dir, filepath.FromSlash(relative))
		if entry.IsDir() {
			_ = os.MkdirAll(target, 0o755)
			return nil
		}
		data, readErr := llamaRuntime.ReadFile(name)
		if readErr != nil {
			return nil
		}
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		_ = os.WriteFile(target, data, 0o755)
		return nil
	})
	_ = os.WriteFile(marker, []byte(llamaVersion), 0o644)
	return dir
}

/* ---------- event hub (server-sent events) ---------- */

func (s *llmService) emit(event map[string]any) {
	if event == nil {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	line := string(payload)
	s.eventsMu.Lock()
	for ch := range s.events {
		select {
		case ch <- line:
		default:
			/* A slow tab must never stall a download or generation. */
		}
	}
	s.eventsMu.Unlock()
}

func (s *llmService) subscribe() chan string {
	ch := make(chan string, 64)
	s.eventsMu.Lock()
	s.events[ch] = struct{}{}
	s.eventsMu.Unlock()
	return ch
}

func (s *llmService) unsubscribe(ch chan string) {
	s.eventsMu.Lock()
	delete(s.events, ch)
	s.eventsMu.Unlock()
}

func (s *llmService) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	ch := s.subscribe()
	defer s.unsubscribe(ch)
	fmt.Fprint(w, ": dawaya\n\n")
	flusher.Flush()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case line := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

/* ---------- capabilities and status ---------- */

func (s *llmService) capabilities() map[string]any {
	total, free := memoryBytes()
	cores := runtime.NumCPU()
	disk := freeDiskBytes(s.dir)
	supported := s.serverBinary() != ""
	reason := ""
	if !supported {
		reason = "runtime-missing"
	} else if s.cfg.Device.MinRAMMB > 0 && total > 0 && total < int64(s.cfg.Device.MinRAMMB)*1024*1024 {
		supported = false
		reason = "low-memory"
	}
	return map[string]any{
		"supported":    supported,
		"reason":       reason,
		"backends":     []string{"cpu"},
		"totalRamBytes": total,
		"freeRamBytes":  free,
		"cores":         cores,
		"storageBytes":  disk,
	}
}

func (s *llmService) modelPath() string {
	name := s.cfg.Model.FileName
	if name == "" {
		name = "model.gguf"
	}
	return filepath.Join(s.dir, filepath.Base(name))
}

func (s *llmService) partPath() string {
	return s.modelPath() + ".part"
}

func (s *llmService) statePath() string {
	return filepath.Join(s.dir, "model-state.json")
}

func (s *llmService) readState() map[string]any {
	out := map[string]any{}
	data, err := os.ReadFile(s.statePath())
	if err == nil {
		_ = json.Unmarshal(data, &out)
	}
	return out
}

func (s *llmService) writeState(patch map[string]any) {
	state := s.readState()
	for key, value := range patch {
		state[key] = value
	}
	state["modelVersion"] = s.cfg.Model.Version
	data, err := json.MarshalIndent(state, "", "  ")
	if err == nil {
		_ = os.WriteFile(s.statePath(), data, 0o644)
	}
}

func (s *llmService) status() map[string]any {
	s.mu.Lock()
	downloading := s.downloading.Load()
	loaded := s.loaded
	s.mu.Unlock()
	info, err := os.Stat(s.modelPath())
	present := err == nil && info.Size() > 0
	state := "not-downloaded"
	verified := false
	if stored := s.readState(); stored != nil {
		if value, ok := stored["checksumVerified"].(bool); ok {
			verified = value
		}
	}
	switch {
	case loaded:
		state = "ready"
	case downloading:
		state = "downloading"
	case present && verified:
		state = "ready-to-load"
	case present:
		state = "ready-to-load"
	}
	var size int64
	if info != nil {
		size = info.Size()
	}
	var part int64
	if info, err := os.Stat(s.partPath()); err == nil {
		part = info.Size()
	}
	return map[string]any{
		"state":            state,
		"fileName":         filepath.Base(s.modelPath()),
		"sizeBytes":        size,
		"downloadedBytes":  part,
		"checksumVerified": verified,
		"path":             s.modelPath(),
	}
}

/* ---------- download / pause / resume / cancel / verify ---------- */

func (s *llmService) download() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cfg.Model.URL == "" {
		return "", errors.New("model url is not configured")
	}
	if !isAllowedModelHost(s.cfg.Model.URL, s.cfg) {
		return "", errors.New("model host is not allowlisted")
	}
	if s.downloading.Load() {
		return s.downloadID, nil
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "", err
	}
	id := "d" + strconv.FormatInt(time.Now().UnixNano(), 36)
	s.downloadID = id
	s.paused.Store(false)
	s.cancelled.Store(false)
	s.downloading.Store(true)
	s.lastError = ""
	ctx, cancel := context.WithCancel(context.Background())
	s.cancelDL = cancel
	go s.runDownload(ctx, id)
	return id, nil
}

func (s *llmService) runDownload(ctx context.Context, id string) {
	defer s.downloading.Store(false)
	urls := []string{s.cfg.Model.URL}
	for _, mirror := range s.cfg.Model.Mirrors {
		if mirror != "" && mirror != s.cfg.Model.URL && isAllowedModelHost(mirror, s.cfg) {
			urls = append(urls, mirror)
		}
	}
	var lastErr error
	for _, source := range urls {
		done, err := s.downloadFrom(ctx, id, source)
		if err == nil {
			if done < 0 {
				return /* paused or cancelled: the event was already sent */
			}
			s.writeState(map[string]any{"downloaded": true, "sizeBytes": done})
			s.emit(map[string]any{"type": "download-completed", "id": id, "sizeBytes": done})
			return
		}
		lastErr = err
		if ctx.Err() != nil {
			break
		}
		logger.Printf("download source failed, trying the next one: %v", err)
	}
	if s.paused.Load() {
		s.emit(map[string]any{"type": "download-paused", "id": id})
		return
	}
	if s.cancelled.Load() {
		return
	}
	s.fail(id, lastErr)
}

/*
 * downloadFrom fetches one source into the .part file, resuming where it stopped.
 * It returns the final size, -1 when the reader paused, or an error. A connection that
 * cannot be opened within 30s, or that delivers nothing for 45s, is an error rather than an
 * endless "Downloading" state, so the next mirror gets its turn and the reader sees a reason.
 */
func (s *llmService) downloadFrom(parent context.Context, id, source string) (int64, error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	stalled := atomic.Bool{}
	watchdog := time.AfterFunc(45*time.Second, func() { stalled.Store(true); cancel() })
	defer watchdog.Stop()

	part := s.partPath()
	_ = os.Remove(s.modelPath())
	var offset int64
	if info, err := os.Stat(part); err == nil {
		offset = info.Size()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", downloadUserAgent)
	req.Header.Set("Accept", "application/octet-stream")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	client := &http.Client{
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 20 * time.Second}).DialContext,
			TLSHandshakeTimeout:   20 * time.Second,
			ResponseHeaderTimeout: 30 * time.Second,
		},
		CheckRedirect: func(r *http.Request, via []*http.Request) error {
			if len(via) > 5 {
				return errors.New("too many redirects")
			}
			if !isAllowedModelHost(r.URL.String(), s.cfg) {
				return errors.New("redirect to a host that is not allowlisted")
			}
			return nil
		},
	}
	response, err := client.Do(req)
	if err != nil {
		if s.paused.Load() {
			return -1, nil
		}
		if stalled.Load() {
			return 0, errors.New("connection timed out")
		}
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK && offset > 0 {
		/* The server ignored the range: start the file again rather than appending twice. */
		offset = 0
		_ = os.Remove(part)
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return 0, fmt.Errorf("download failed: %d", response.StatusCode)
	}
	mode := os.O_CREATE | os.O_WRONLY
	if offset > 0 {
		mode |= os.O_APPEND
	} else {
		mode |= os.O_TRUNC
	}
	file, err := os.OpenFile(part, mode, 0o644)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	total := s.cfg.Model.Size
	if response.ContentLength > 0 {
		total = offset + response.ContentLength
	}
	done := offset
	started := time.Now()
	lastEmit := time.Now()
	buf := make([]byte, 262144)
	for {
		if s.paused.Load() {
			return -1, nil
		}
		n, readErr := response.Body.Read(buf)
		if n > 0 {
			watchdog.Reset(45 * time.Second)
			if _, writeErr := file.Write(buf[:n]); writeErr != nil {
				return 0, writeErr
			}
			done += int64(n)
			if time.Since(lastEmit) > 400*time.Millisecond {
				lastEmit = time.Now()
				rate := float64(done-offset) / time.Since(started).Seconds()
				s.emit(map[string]any{
					"type":            "download-progress",
					"id":              id,
					"downloadedBytes": done,
					"totalBytes":      total,
					"bytesPerSecond":  int64(rate),
				})
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			if s.paused.Load() {
				return -1, nil
			}
			if stalled.Load() {
				return 0, errors.New("connection stalled")
			}
			return 0, readErr
		}
	}
	if err := file.Close(); err != nil {
		return 0, err
	}
	if total > 0 && done != total {
		return 0, fmt.Errorf("download incomplete: %d of %d bytes", done, total)
	}
	if err := os.Rename(part, s.modelPath()); err != nil {
		return 0, err
	}
	return done, nil
}

func (s *llmService) pause(id string) {
	if s.downloading.Load() {
		s.paused.Store(true)
		if s.cancelDL != nil {
			s.cancelDL()
		}
	}
}

func (s *llmService) resume(id string) (string, error) {
	return s.download()
}

func (s *llmService) cancel(id string) {
	s.cancelled.Store(true)
	s.paused.Store(false)
	if s.cancelDL != nil {
		s.cancelDL()
	}
	_ = os.Remove(s.partPath())
	s.writeState(map[string]any{"downloaded": false, "checksumVerified": false})
	s.emit(map[string]any{"type": "download-cancelled", "id": id})
}

func (s *llmService) fail(id string, err error) {
	s.lastError = err.Error()
	s.emit(map[string]any{"type": "download-error", "id": id, "error": err.Error()})
}

func (s *llmService) verify(id string) map[string]any {
	sum, err := sha256File(s.modelPath())
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	if s.cfg.Model.SHA256 != "" && !strings.EqualFold(sum, s.cfg.Model.SHA256) {
		_ = os.Remove(s.modelPath())
		s.writeState(map[string]any{"downloaded": false, "checksumVerified": false, "checksumFailed": true})
		s.emit(map[string]any{"type": "checksum-failed", "id": id, "expected": s.cfg.Model.SHA256, "actual": sum})
		return map[string]any{"ok": false, "sha256": sum}
	}
	s.writeState(map[string]any{"downloaded": true, "checksumVerified": true, "checksum": sum})
	return map[string]any{"ok": true, "sha256": sum}
}

func (s *llmService) deleteModel() map[string]any {
	s.stopServer()
	_ = os.Remove(s.modelPath())
	_ = os.Remove(s.partPath())
	_ = os.Remove(s.statePath())
	return map[string]any{"ok": true}
}

/*
 * Manual import: the reader picks a .gguf file with the Windows file dialog, and
 * the launcher copies it into private storage and checks it against the configured
 * checksum before it is ever loaded.
 */
func (s *llmService) importModel() map[string]any {
	s.stopServer()
	const script = `Add-Type -AssemblyName System.Windows.Forms;` +
		`$d = New-Object System.Windows.Forms.OpenFileDialog;` +
		`$d.Filter = 'GGUF model (*.gguf)|*.gguf';` +
		`if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }`
	cmd := exec.Command("powershell", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script)
	cmd.SysProcAttr = hiddenSysProcAttr()
	out, err := cmd.Output()
	if err != nil {
		return map[string]any{"ok": false, "error": "dialog-failed"}
	}
	source := strings.TrimSpace(string(out))
	if source == "" {
		return map[string]any{"ok": false, "error": "cancelled"}
	}
	input, err := os.Open(source)
	if err != nil {
		return map[string]any{"ok": false, "error": "read-failed"}
	}
	defer input.Close()
	target := s.modelPath()
	_ = os.MkdirAll(filepath.Dir(target), 0o755)
	output, err := os.Create(target)
	if err != nil {
		return map[string]any{"ok": false, "error": "write-failed"}
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		_ = os.Remove(target)
		return map[string]any{"ok": false, "error": "copy-failed"}
	}
	output.Close()
	info, _ := os.Stat(target)
	verification := s.verify("import")
	if ok, _ := verification["ok"].(bool); !ok {
		return map[string]any{"ok": false, "error": "checksum-mismatch"}
	}
	s.writeState(map[string]any{"downloaded": true, "checksumVerified": true, "imported": true})
	var size int64
	if info != nil {
		size = info.Size()
	}
	return map[string]any{"ok": true, "checksumVerified": true, "fileName": filepath.Base(target), "sizeBytes": size}
}

/* ---------- server lifecycle ---------- */

func (s *llmService) serverBinary() string {
	if s.binDir == "" {
		return ""
	}
	for _, name := range []string{"llama-server.exe", "llama-server"} {
		candidate := filepath.Join(s.binDir, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func (s *llmService) ensureServer(params llmParams) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded && s.server != nil && s.server.Process != nil {
		return nil
	}
	bin := s.serverBinary()
	if bin == "" {
		return errors.New("runtime-missing")
	}
	if _, err := os.Stat(s.modelPath()); err != nil {
		return errors.New("model-missing")
	}
	threads := params.NThreads
	if threads <= 0 {
		threads = runtime.NumCPU() - 1
	}
	if threads < 1 {
		threads = 1
	}
	port, err := freePort()
	if err != nil {
		return err
	}
	key, err := randomKey()
	if err != nil {
		return err
	}
	ctx := s.cfg.Generation.NCtx
	if params.NCtx > 0 {
		ctx = params.NCtx
	}
	if ctx <= 0 {
		ctx = 2048
	}
	args := []string{
		"--model", s.modelPath(),
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(port),
		"--ctx-size", strconv.Itoa(ctx),
		"--threads", strconv.Itoa(threads),
		"--parallel", "1",
		"--api-key", key,
	}
	cmd := exec.Command(bin, args...)
	cmd.Dir = s.binDir
	cmd.SysProcAttr = hiddenSysProcAttr()
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return err
	}
	s.server = cmd
	s.serverPort = port
	s.serverKey = key
	s.serverThread = threads
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		if s.health() {
			s.loaded = true
			s.running.Store(true)
			return nil
		}
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			break
		}
		time.Sleep(350 * time.Millisecond)
	}
	_ = cmd.Process.Kill()
	s.server = nil
	s.loaded = false
	s.running.Store(false)
	return errors.New("runtime-load-failed")
}

func (s *llmService) health() bool {
	client := &http.Client{Timeout: 2 * time.Second}
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/health", s.serverPort), nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+s.serverKey)
	response, err := client.Do(req)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK
}

func (s *llmService) stopServer() {
	s.activeMu.Lock()
	if s.activeCancel != nil {
		s.activeCancel()
		s.activeCancel = nil
	}
	s.activeMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server != nil && s.server.Process != nil {
		_ = s.server.Process.Kill()
		_, _ = s.server.Process.Wait()
	}
	s.server = nil
	s.loaded = false
	s.running.Store(false)
}

func (s *llmService) unload() {
	s.stopServer()
}

/* ---------- generation ---------- */

type llmParams struct {
	NCtx            int     `json:"n_ctx"`
	NThreads        int     `json:"n_threads"`
	Temperature     float64 `json:"temperature"`
	TopK            int     `json:"top_k"`
	TopP            float64 `json:"top_p"`
	RepeatPenalty   float64 `json:"repeat_penalty"`
	NPredict        int     `json:"n_predict"`
	NBatch          int     `json:"n_batch"`
	UseMmap         *bool   `json:"use_mmap"`
	UseMlock        *bool   `json:"use_mlock"`
	GPULayers       any     `json:"gpu_layers"`
	UnicodeDecoder  *bool   `json:"unicode_decoder"`
}

type llmGenerateRequest struct {
	RequestID string    `json:"requestId"`
	Prompt    string    `json:"prompt"`
	Params    llmParams `json:"params"`
}

const chatmlSystem = "You answer only from the reference data the user supplies."

func chatml(prompt string) string {
	return "<|im_start|>system\n" + chatmlSystem + "<|im_end|>\n<|im_start|>user\n" + prompt + "<|im_end|>\n<|im_start|>assistant\n"
}

func (s *llmService) generate(request llmGenerateRequest) map[string]any {
	if request.RequestID == "" {
		request.RequestID = "r" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	if err := s.ensureServer(request.Params); err != nil {
		return map[string]any{"error": err.Error(), "text": "", "requestId": request.RequestID}
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.activeMu.Lock()
	s.activeCancel = cancel
	s.activeMu.Unlock()
	defer func() {
		cancel()
		s.activeMu.Lock()
		if s.activeCancel != nil {
			s.activeCancel = nil
		}
		s.activeMu.Unlock()
	}()

	temperature := request.Params.Temperature
	if temperature == 0 && s.cfg.Generation.Temperature > 0 {
		temperature = s.cfg.Generation.Temperature
	}
	topK := request.Params.TopK
	if topK == 0 {
		topK = s.cfg.Generation.TopK
	}
	topP := request.Params.TopP
	if topP == 0 {
		topP = s.cfg.Generation.TopP
	}
	repeat := request.Params.RepeatPenalty
	if repeat == 0 {
		repeat = s.cfg.Generation.RepeatPenalty
	}
	predict := request.Params.NPredict
	if predict <= 0 {
		predict = s.cfg.Generation.MaxTokens
	}
	if predict <= 0 {
		predict = 300
	}

	body := map[string]any{
		"prompt":         chatml(request.Prompt),
		"stream":         true,
		"n_predict":      predict,
		"temperature":    temperature,
		"top_k":          topK,
		"top_p":          topP,
		"repeat_penalty": repeat,
		// Reuse the token-verified prefix of the previous prompt; llama-server
		// compares the actual tokens before reusing a slot, so a changed system
		// rule or a different retrieved record is recomputed, never inherited.
		"cache_prompt":   true,
		"stop":           []string{"<|im_end|>"},
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("http://127.0.0.1:%d/completion", s.serverPort), strings.NewReader(string(payload)))
	if err != nil {
		return map[string]any{"error": err.Error(), "text": "", "requestId": request.RequestID}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.serverKey)
	client := &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 0}
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return map[string]any{"cancelled": true, "text": "", "requestId": request.RequestID}
		}
		return map[string]any{"error": err.Error(), "text": "", "requestId": request.RequestID}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return map[string]any{"error": fmt.Sprintf("runtime returned %d", response.StatusCode), "text": "", "requestId": request.RequestID}
	}

	started := time.Now()
	var text strings.Builder
	tokens := 0
	reader := bufio.NewReaderSize(response.Body, 1<<16)
	for {
		line, readErr := reader.ReadString('\n')
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			var chunk struct {
				Content string `json:"content"`
				Stop    bool   `json:"stop"`
				Tokens  int    `json:"tokens_predicted"`
			}
			if json.Unmarshal([]byte(data), &chunk) == nil {
				if chunk.Tokens > 0 {
					tokens = chunk.Tokens
				}
				if chunk.Content != "" {
					text.WriteString(chunk.Content)
					tokens++
					s.emit(map[string]any{"type": "token", "requestId": request.RequestID, "token": chunk.Content})
				}
				if chunk.Stop {
					break
				}
			}
		}
		if readErr != nil {
			break
		}
	}
	cancelled := ctx.Err() != nil
	return map[string]any{
		"text":         text.String(),
		"tokens":       tokens,
		"milliseconds": time.Since(started).Milliseconds(),
		"cancelled":    cancelled,
		"requestId":    request.RequestID,
	}
}

func (s *llmService) cancelGeneration(requestID string) {
	s.activeMu.Lock()
	if s.activeCancel != nil {
		s.activeCancel()
	}
	s.activeMu.Unlock()
}

/* ---------- HTTP surface used by the web layer ---------- */

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return decoder.Decode(target)
}

func (s *llmService) routes(mux *http.ServeMux) {
	base := "/__dawaya/llm"
	post := func(path string, handle func(w http.ResponseWriter, r *http.Request)) {
		mux.HandleFunc(base+path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method-not-allowed"})
				return
			}
			handle(w, r)
		})
	}
	mux.HandleFunc(base+"/capabilities", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.capabilities())
	})
	mux.HandleFunc(base+"/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.status())
	})
	mux.HandleFunc(base+"/stream", s.stream)
	post("/download", func(w http.ResponseWriter, r *http.Request) {
		id, err := s.download()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id})
	})
	post("/pause", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		_ = readJSON(r, &body)
		s.pause(body.ID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	post("/resume", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		_ = readJSON(r, &body)
		id, err := s.resume(body.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id})
	})
	post("/cancel", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		_ = readJSON(r, &body)
		s.cancel(body.ID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	post("/verify", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		_ = readJSON(r, &body)
		writeJSON(w, http.StatusOK, s.verify(body.ID))
	})
	post("/delete", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.deleteModel())
	})
	post("/import", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.importModel())
	})
	post("/load", func(w http.ResponseWriter, r *http.Request) {
		var body llmParams
		_ = readJSON(r, &body)
		if err := s.ensureServer(body); err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	post("/unload", func(w http.ResponseWriter, r *http.Request) {
		s.unload()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	post("/generate", func(w http.ResponseWriter, r *http.Request) {
		var body llmGenerateRequest
		if err := readJSON(r, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad-request"})
			return
		}
		writeJSON(w, http.StatusOK, s.generate(body))
	})
	post("/cancelGeneration", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RequestID string `json:"requestId"`
		}
		_ = readJSON(r, &body)
		s.cancelGeneration(body.RequestID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

/* ---------- helpers ---------- */

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func randomKey() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

/* Only the hosts declared in the model config may be contacted for a download. */
func isAllowedModelHost(rawURL string, cfg aiConfig) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, allowed := range []string{"huggingface.co", "hf.co", "github.com", "githubusercontent.com"} {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}
