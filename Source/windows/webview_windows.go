//go:build windows

package main

import (
	"errors"
	"path/filepath"

	webview2 "github.com/jchv/go-webview2"
)

// runNativeWindow shows the app in a real desktop window (Microsoft Edge
// WebView2, in this process) and returns when the user closes it. It returns an
// error when the WebView2 runtime is missing so the caller can fall back.
func runNativeWindow(appURL, dataDir string) error {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(dataDir, "webview"),
		WindowOptions: webview2.WindowOptions{
			Title:  "Drugcopeia",
			Width:  1280,
			Height: 900,
			Center: true,
		},
	})
	if w == nil {
		return errors.New("WebView2 runtime unavailable")
	}
	defer w.Destroy()
	w.SetSize(1280, 900, webview2.HintNone)
	w.Navigate(appURL)
	w.Run()
	return nil
}
