wllama - WebAssembly binding for llama.cpp (runs the assistant model in the browser)
=====================================================================================

Bundled so the web/PWA build runs the same on-device model with no CDN, no
account and no build step. The files below are the untouched releases of the
npm packages, pinned by SHA-256 (verify with: sha256sum -c README.txt is not
supported - compare the hashes printed here, or run scripts/privacy-check.py
which checks them).

Source:
  https://github.com/ngxson/wllama (MIT licence, see LICENSE.txt)
  npm @wllama/wllama 4.0.0        (llama.cpp b11985 lineage, MIT)
  npm @wllama/wllama-compat 4.0.0 (Asyncify build for browsers without JSPI
                                   or relaxed SIMD, most notably Safari)

Files:
  index.js            esm/index.js of @wllama/wllama 4.0.0
    sha256 062c3fbaa266dea3ee991c699c176c21cf22e7199b0cac6481182b8708fc703b
  wllama.wasm         esm/wasm/wllama.wasm of @wllama/wllama 4.0.0
    sha256 b012436a101ede8c877f2d26644c3181429d4fb8da4fd90c356110d86bfd74a6
  wllama-compat.wasm  wasm/wllama.wasm of @wllama/wllama-compat 4.0.0
    sha256 6c5445f579a152c19ccad65aacebb57084d1db2f1b87ad473fa3acc0051ac72f
  LICENSE.txt         the MIT licence shipped by both packages

Nothing here is modified. The app never fetches the compat build from the
jsDelivr CDN (the library default): ai/wasm-bridge.js pins both wasm files to
these local copies through Wllama's config paths and setCompat().

Upgrade: replace the files, update the hashes here and in
assets/ai/model-config.json (web.wasmRuntime.sha256), and re-run
tests/ai/run-tests.js and scripts/privacy-check.py.
