llama.cpp server runtime for Android arm64 (CPU build)
======================================================

CI builds this on every run and packages it into the APK as
lib/arm64-v8a/libllamaserver.so (the stripped llama-server executable) plus
lib/arm64-v8a/libomp.so. DawayaLLMPlugin starts it as a child process from the
app's native library directory and talks to it over a 127.0.0.1 socket with a
random port and API key. Without the binary the assistant falls back to
grounded smart search; nothing else changes.

Provenance
----------
Upstream     : llama.cpp release tag b11985
Commit       : 6d194531e1e5876d5d1a0641ce3ca7dae23f94ad (pinned; the CI step
               clones the tag and fails unless HEAD matches this commit)
Source       : https://github.com/ggml-org/llama.cpp (MIT license;
               LICENSE-llama-cpp.txt is in Source/windows/llama/)
Web UI assets: official prebuilt UI from the ggml-org/llama-ui Hugging Face
               bucket, version b11985, sha256
               b3afc0f39735db54f3a095b75160752a35fdd4428a7cfb5ffbb334a4fe74e539
               (pinned and checked in CI before the build embeds it)
libomp.so    : the Android NDK's OpenMP runtime (Apache-2.0 with LLVM
               exception; license text in Source/windows/llama/)
Verified     : 2026-11-24 - this exact recipe was run locally (NDK r27c,
               android-24, arm64-v8a) and produced a working AArch64 PIE
               executable before it was put in the workflow.

CI build (what .github/workflows/build.yml does)
------------------------------------------------
  git clone --depth 1 --branch b11985 https://github.com/ggml-org/llama.cpp.git
  git rev-parse HEAD   # must equal the pinned commit above
  curl -fLO https://huggingface.co/buckets/ggml-org/llama-ui/resolve/b11985/dist.tar.gz
  sha256sum -c         # against the pinned hash above
  tar -xzf dist.tar.gz -C llama.cpp/tools/ui/dist
  cmake -S llama.cpp -B build \
    -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_LATEST_HOME/build/cmake/android.toolchain.cmake \
    -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DLLAMA_CURL=OFF \
    -DGGML_NATIVE=OFF -DLLAMA_USE_PREBUILT_UI=OFF -DLLAMA_BUILD_UI=OFF
  cmake --build build --target llama-server
  llvm-strip build/bin/llama-server -o app/src/main/jniLibs/arm64-v8a/libllamaserver.so
  cp $ANDROID_NDK_LATEST_HOME/toolchains/llvm/prebuilt/linux-x86_64/lib/clang/*/lib/linux/aarch64/libomp.so \
     app/src/main/jniLibs/arm64-v8a/libomp.so

The same commands work on a local Linux/macOS machine with any NDK r27+
(substitute its toolchains path). android-24 matches minSdkVersion 24, so the
binary runs on every device the app supports. The build is CPU-only; the app
limits threads to leave one core free (see assets/ai/model-config.json).
