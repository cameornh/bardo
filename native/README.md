# Native wgpu live lab

Run `npm install` once, then `npm run start:native`. On this Mac, double-click
`Start-Native.command` for the same development launcher. `Start-Native.cmd` is
the Windows equivalent. The window starts paused; Resume runs physics.

The launcher downloads a pinned, SHA-256-verified Deno runtime locally, builds
the shared scene and tiny OS window helper, and opens a native window. No localhost
server or Chromium process is needed. All generated files and shader caches live
under ignored `.native/`. Existing browser routes and saved browser data remain
untouched. Updates still use the same source files; rebuild/relaunch after edits.

Requirements: the existing Node/npm installation and a C compiler (Xcode Command
Line Tools on Mac; LLVM clang or a Visual Studio C++ developer terminal on Windows).
The runtime download needs network access once; the application runs offline.
Windows source support is included, but only macOS/Metal has been exercised here.

## Architecture and scope

Deno's WebGPU binding executes through native Rust **wgpu**, using Metal on Mac
and DX12/Vulkan on Windows. This is not an Electron/WebView wrapper. The current
live sand lab reuses its JavaScript scene, CPU/WebAssembly physics, GPU compute,
GLSL-to-WGSL translation, Gaussian covariance projection and spherical harmonics.
The native UI draws functional controls itself and dispatches the same handlers
through a lightweight DOM adapter. No scene pixels cross a JS/IPC bridge for
normal presentation. Screenshot export is the deliberate readback exception.

The CPU work has **not** been rewritten in Rust or moved wholesale onto the GPU.
Sand, rigid bodies, player, rain accounting, topology and feature mirrors still
use their existing implementations. The validated resident water solver is an
option; CPU physics is the default on this AMD Mac because it measures faster.
The backend menu reports the actual selection. RTX devices default to the
validated connected GPU route. Validation failure retains the CPU reference.

This ports the current live beach experience. Historical numbered tests, the
standalone fluid-fields experiment and older fountain/pipe snapshots remain
browser archives; selecting one does not silently run a modified native copy.
A deliberate separate migration of those snapshots remains in the backlog.

The 60 FPS presentation cap, memory/particle limits, one outstanding scene frame,
shader preflight and completion guards remain. The Mac bridge drains Cocoa
objects between event-loop turns and explicitly retires presented textures.
These protections do not guarantee immunity to driver/runtime bugs.

## Reproducible checks

- `npm run test:native` — controls, input, surface lifetime, MRT planning and
  completion ordering/failure guards.
- `npm run build:native` — bundle the shared scene and compile the window helper.
- `.native/tools/deno run --config native/deno.json --allow-read --allow-ffi native/probe.js`
  — tiny native-window graphics check.
- `.native/tools/deno run --config native/deno.json --allow-read --allow-write=.native --allow-env --allow-sys --allow-ffi native/check.js`
  — bounded full native-window feature suite and GPU/CPU oracles; results in
  `.native/check/`. Add `--headless` to test the same GPU rendering offscreen.
- `npm run start:native -- --width=640 --height=400 --resolution=1 --backend=safe --play --frames=80 --report=.native/run.json --screenshot=.native/run.png`
  — bounded real-loop performance check. `--backend=gpu` selects validated GPU
  water; `--headless` omits the window. Compare only equal image/physics settings.
  `--completion=immediate` restores the old serialized wait for comparison;
  deferred native completion is now the default.
- `.native/tools/deno run --config native/deno.json --allow-read --allow-write=.native --allow-env --allow-sys --allow-ffi native/completion-parity.js`
  — frozen full-renderer image comparison of immediate and deferred completion;
  results in `.native/waits-parity.json` and `.native/waits-parity.png`.
- `tests/native-host-browser.html?renderer=webgpu&backend=safe&paused=1` — matching
  browser live-loop comparison; the button runs 48 frames then pauses.

On Windows use `.native/tools/deno.exe` in place of `.native/tools/deno`.
Do not run native and browser GPU benchmarks concurrently.

## Known work remaining

Native does not yet establish a performance win over the browser on this Mac.
Deno's completion operations block the JS thread inside the call that returns a
Promise and add a polling delay. The native host now defers entering that binding
by one microtask: submit the immutable frame, advance the existing CPU-only physics
work while the GPU renders, then wait before retiring resources or submitting
another frame. The browser's existing asynchronous completion order is unchanged.
This restores useful CPU/GPU overlap; it does not make Deno's binding nonblocking
or remove its polling delay. Native input can still wait for the remaining fence.
The native adapter also exposes a smaller color-attachment byte
limit; depth-free wide MRT passes are split without reducing precision. GPU
pass timestamps are unavailable on this runtime/adapter, despite being available
in Chrome. Keep the browser path available while profiling these costs.

This is a source-based development application, not a signed distributable.
Standalone packaging, hot reload, broader platform tests, accessibility and a
native asynchronous completion bridge remain follow-up work.

The original matched 80-frame comparison measured **5.55 FPS / 0.740× realtime**
natively versus **12.88 FPS / 1.000×** in browser WebGPU at 640 × 400 / resolution 1
([original report](../tests/results/native-wgpu-2026-11-08/report.html)).
The November 10 completion-order comparison measured **5.25 → 7.62 FPS** and
**0.699 → 0.978× realtime**, with p95 frame intervals **214 → 152 ms**. The frozen
linear RGB image comparison was exact. These are bounded 80-frame runs on the AMD
560X, not Windows/RTX results or a long-run stability guarantee. A worker/RPC
alternative measured slower than the simpler scheduling change and was rejected.
See the [completion measurements](../tests/results/native-waits-2026-11-10/report.html).
Diagnostics are saved to `.native/last-run.json` when the window closes. The
in-memory frame history is bounded. Historical browser saves are never modified;
cross-host import/export is not implemented.

References: [wgpu](https://wgpu.rs/), [Deno native WebGPU](https://docs.deno.com/api/deno/gpu/),
[Deno queue completion implementation](https://github.com/denoland/deno/blob/v2.9.8/ext/webgpu/queue.rs).
