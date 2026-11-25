llama.cpp server runtime for Windows x64 (CPU build)
=====================================================

These files are embedded in Dawaya.exe by `//go:embed all:llama` (main.go) and
unpacked once into %LOCALAPPDATA%\Dawaya\runtime on first launch (llm.go). The
assistant only loads them when the reader downloads the model file; without them
the same pipeline answers from grounded smart search.

Provenance
----------
Upstream     : llama.cpp release tag b11985
Asset        : llama-b11985-bin-win-cpu-x64.zip
Location     : https://github.com/ggml-org/llama.cpp/releases/download/b11985/llama-b11985-bin-win-cpu-x64.zip
Archive      : sha256 1c93f23afd48f8434c4cdc4d9f0a46f47a0d98ea6b3214007cbddc10c34c0c16
Verified     : 2026-11-01 - every one of the 30 files kept here is byte-identical
               to the same-named file inside that archive, checked by SHA-256.

The command-line and RPC binaries from the archive (llama-cli.exe, llama-bench.exe,
llama-quantize.exe, llama.exe, ggml-rpc-server.exe and the rest) were not copied;
only the server and the DLLs it loads ship in the exe.

Licenses
--------
LICENSE-llama-cpp.txt      MIT, "Copyright (c) 2023-2026 The ggml authors"
LICENSE-LLVM-OpenMP.txt    Apache-2.0 with LLVM exception, for libomp.dll

Refreshing this folder
----------------------
Download the asset above to /tmp/llama-runtime/win.zip (or point LLAMA_WIN_ZIP at
it) and run build-windows.sh: it deletes llama/*.dll and llama/*.exe, unpacks the
new server and DLLs, and leaves this note and the licences in place. If the zip is
absent the script leaves the staged files untouched and says so - the build still
embeds whatever is here, so check the archive hash above before shipping.
