# Shared live scene and machine profiles

Branches: `main` and `codex/rtx-5070-ti-gpu`. Both ship the same live scene,
features and controls. Hardware policy selects execution and image budgets:
the RTX machine defaults to validated GPU pressure, while the Mac defaults to
compiled CPU pressure with GPU transport/rendering. Historical snapshot URLs
retain their previous implementations.

## Update and run

The latest live editing and moon checks are documented in
[`tests/results/live-edits-2026-10-25/report.md`](tests/results/live-edits-2026-10-25/report.md).
They cover bounded repeated terrain edits, much dimmer lunar discs, the shared
direct sunlight / moonlight control, and click-versus-drag tool routing.

The wind brush now defaults to 2,400 m/s and reaches 9,000 m/s, with stronger
high-speed sand erosion and the same packet budgets. See
[`tests/results/strong-brush-2026-10-25/report.md`](tests/results/strong-brush-2026-10-25/report.md).
The live sand/object pass also respects carved cavities. Its original checks are in
[`tests/results/carved-contacts-2026-10-25/report.md`](tests/results/carved-contacts-2026-10-25/report.md)
for the isolated bowl preview and collision checks.

From the repository folder on the test computer:

```sh
git switch codex/rtx-5070-ti-gpu
git pull --ff-only
npm ci
npm run start:windows
```

On Windows the launcher opens a separate Chrome profile through NVIDIA OpenGL,
at `http://127.0.0.1:5178/?scene=sand-lab`. Keep the terminal open. Both
`Start-Windows.cmd` and `Start-Windows-OpenGL.cmd` can be double-clicked after
dependencies are installed. `npm run start:windows:opengl` explicitly requests
the same OpenGL launcher. Existing Chrome windows and profiles stay available.
The launcher checks the Node version, builds the production bundles, and serves
only that build on port 5178. A port conflict is an error rather than silently
choosing another address. Build errors stay visible in the terminal. It reports
the source revision and writes `/build-info.json` with the build identity.
The normal URL selects GPU pressure after validation. To compare the Mac's
CPU-pressure baseline, use `?scene=sand-lab&backend=safe&paused=1` in the OpenGL
window. `--manual-browser` starts only the server when explicitly needed.

The user confirmed that the RTX 5070 Ti freezes through Chrome's Direct3D 11
backend and runs the full scene through **NVIDIA OpenGL 4.5.0**, including the
running, unpaused scene. The isolated entry therefore stops D3D11 startup before
submitting scene shaders and directs users to the OpenGL launcher. It does not
disable browser security, GPU watchdogs, or driver workarounds. Backend selection
uses [ANGLE's documented Chrome options](https://github.com/google/angle/blob/main/doc/DebuggingTips.md#usage).

`npm run dev` remains available on port 5173. Production startup removes the
development module graph from the investigation; it does not change rendering
or simulation settings. Both branches open the shared live sand lab at the root
URL and at `?scene=sand-lab`.

The experiment shows a paused scene frame before its optional GPU pressure
checks. Eight fixtures of at most 175 samples compare GPU arithmetic and
contacts against the CPU reference. A plain URL starts running afterward; add
`paused=1` to keep it paused. The test-control panel starts visible, and a fixed
**Show/Hide test controls** button remains available even while startup waits.
Diagnostics show the actual adapter, backend, and comparison results. Confirm
that Chrome reports the NVIDIA card. Rendering uses WebGL 2 and parallel compute
uses fragment shaders; this is not CUDA or WebGPU. Floating-point targets require
[`EXT_color_buffer_float`](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/).

## If startup stalls

The page now displays **Startup diagnostics · startup-v4** before importing any
scene modules. It captures module download/parse failures and rejected startup
promises as well as graphics errors. Initialization yields between major stages
so the browser can display progress. Simulation controls become available after
the first frame. The show/hide button remains active throughout.

The last stage, including the last first-frame drawing pass, is written before
the operation begins. Open `http://127.0.0.1:5178/?startup=report` and click
**Copy startup report** if a page stalls without producing an error. This report
route never imports a scene or requests a graphics context, and reading it does
not erase the saved attempt. The production server also saves checkpoints in
`.startup/windows-startup.json` and prints the stage in the terminal. Major
startup/compile checkpoints are acknowledged by the server before the operation
begins, so closing an incognito window no longer discards the only copy. Browser
storage is retained as a fallback; runtime report files are ignored by Git.

`/graphics-health.html` is included in both production and development builds.
It uses one pixel to check WebGL 2 and reports the actual adapter when available.
It loads no scene shaders or simulation. A pass establishes basic graphics
availability; it does not validate compilation of the larger scene programs.

## Startup compatibility changes

- First-frame programs compile one at a time with nonblocking completion polls,
  named progress, and a 60-second per-program limit. Link/uniform queries happen
  only after completion, avoiding a synchronous first-use wait. This follows
  [Three.js's parallel preparation mechanism](https://threejs.org/docs/pages/WebGLRenderer#compileAsync).
  A slow compile can still take time; no claim is made that every driver call
  can be interrupted or that all first-use pauses have been eliminated.
- The RTX field-maximum shader uses one runtime-bounded loop instead of three
  nested fixed loops. It visits the same 729 samples in exactly the same order,
  avoiding unnecessary static expansion without changing the occupancy result.
- Density, correction, and geometry run as separate small GPU programs. The
  original large shader nesting sand geometry inside pressure is not compiled.
- Speculative object-program compilation is disabled. Only requested variants
  compile, while feature specialization stays enabled.
- Reads from non-mipmapped data/render textures use explicit level zero, retaining
  their existing filtering. Implicit derivatives inside divergent ray loops can
  trigger costly loop unrolling in the Windows graphics translation path; see
  [ANGLE's D3D compiler handling of loop/gradient errors](https://chromium.googlesource.com/angle/angle/+/927410a8c1bd7ab8f52fdb8cbb59c87c2f27e331/src/libANGLE/renderer/d3d/HLSLCompiler.cpp).
  This is a compatibility mitigation, not a confirmed diagnosis of the remote
  machine's failure. Textures that use mipmaps retain normal mip selection.
- A rejected optional pressure shader with a healthy context selects CPU
  pressure, leaving rendering available. Rejected programs are not retried.
  Context loss or a required rendering failure stops further submissions.
- Errors identify the stage and material even when the driver returns no shader
  source or compiler log, and include compile/link status and context state.

## Active work

- GPU density constraints and simple beach, boulder, cup, and player contacts.
  Edited sand uses CPU boundary/contact calculations with GPU neighbor pressure.
- GPU water transport/chemistry, packed neighbor reads, boundary reuse, batched
  readback, and spray-emission queries.
- Existing GPU air field, fine spray/bubble/mist motion, airborne sand grains,
  sea-foam transport, rain object-contact map, water reconstruction, medium
  lighting, atmosphere and exposure, plus drawing.
- Existing compatible optimization checkboxes start enabled. Presentation is
  capped at 60 FPS with fractional-deadline pacing, including on 144 Hz displays.
  Live physics uses the independent one-step asynchronous pipeline below.

Sand stock/adhesion, rigid bodies, player, rain mass, condensation bookkeeping,
tides, and neighbor construction still run on the CPU with existing compiled
and spatial-cache optimizations. No new GPU implementation is claimed for these.

## Backend choices and limits

| Setting | Behavior |
| --- | --- |
| GPU pressure / split contacts | Default after numeric validation. Separate pressure/contact programs; CPU contacts for edited or unsupported geometry. |
| CPU pressure / GPU transport | Compiled CPU constraints with remaining GPU paths active. |
| CPU reference | CPU references where available; scene drawing still uses the GPU. |

Append `&backend=safe` or `&backend=cpu` to bypass pressure checks at startup.
The old `backend=bounded` URL is an alias for the split GPU path. The unchanged
safe snapshot is `/?scene=sand-lab&profile=safe&paused=1`.

GPU pressure retains limits of 32,768 samples, 128 neighbors, 2,048 samples per
draw, three iterations, and an 80 ms live solve budget. Larger or rejected
workloads use the CPU reference. This time budget prevents later submissions;
it cannot interrupt a driver call already running. Simple GPU contacts support
up to 16 rigid bodies; other geometry uses CPU contacts.

## Live throughput and night sky

- `LiveSandLab` runs one fixed physics step at a time. A pixel-pack buffer and
  GPU fence transfer position/transport results together while the main thread
  can present frames. Validated simple geometry keeps pressure output on the
  GPU until that transfer, removing the earlier pressure readback and re-upload.
  Predictions and packed neighbors are reused rather than copied/uploaded a
  second time. Changed neighbor lists are validated; reused lists retain their
  completed validation. This follows the
  [WebGL guidance on asynchronous readbacks](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#avoid_blocking_api_calls_in_production).
- No additional GPU steps are queued. Polling uses at most 32 yielded tasks in
  a 12 ms window before reverting to frame/timer polls. A transfer timeout stops
  the asynchronous path. Context-loss protection, bounded dispatch sizes and
  CPU fallbacks remain. The same fixed timestep and realtime-speed ceiling
  apply at 30, 60 and 144 display refresh rates; camera motion cannot change
  physical resolution or earned simulation time.
- Both profiles retain 960 × 640 base pixels at 50% drawing scale. Spare
  throughput is reserved for maintaining physics speed and handling harder
  frames, rather than automatically increasing image resolution or FPS.
- Live intermediate images retain 32-bit floating-point night radiance. The
  previous half-float images could erase the Milky Way and faint stars before
  exposure. All 8,404 catalogue stars remain covariance-projected Gaussians,
  with the existing centered twinkle. The unresolved galactic band and dark
  lane follow one fixed great circle; texture varies along the band without
  displacing its centre line. Historical sky snapshots retain their prior look.
- Stars and the Milky Way receive the same final scene autoexposure as objects.
  Fixed HDR gains replace the earlier exposure floor / inverse compensation;
  faint stars emerge gradually as exposure rises. Sparse stellar highlights
  remain excluded from the scene meter to keep adaptation stable. Moon
  scattering across the sky is 8% of the snapshot look, moonlit surface
  irradiance is 6×, and dark-scene adaptation targets 2× the previous brightness.
  The live moon disc emits half its previous radiance at every phase.
  Moon orbit, phase, tide behavior and the slow exposure timing are unchanged.

Remaining CPU work still includes sand, bonds, rigid bodies, player forces and
neighbor construction; this does not claim to use all CPU cores. If these
dominate the new stage timings, a worker for compiled contacts/neighbors is the
next useful parallelism target. Keeping more solver state resident on the GPU
would remove additional transfers, but requires a broader change to interactions
and sand/water coupling. Neither was silently added here.

## Validation

- Moon-disc brightness follow-up: 23 sky checks and the production build passed.
  The isolated production celestial shader produced exactly 0.5× radiance,
  with zero half-radiance error. Preview/check: `/tests/moon-brightness-gpu.html`;
  raw results: `tests/results/moon-brightness-2026-10-25/`.
- Exposure / galactic-band correction: 25 relevant numerical tests and the
  production build passed. In the isolated production-shader preview, a 10×
  change of exposure changed peak stellar radiance by exactly 10×. The GPU band
  matched its CPU reference within 0.00000074 and had zero mirrored-latitude
  error; CPU projection checks confirmed a straight centre line at multiple
  camera orientations. Raw results and preview:
  `tests/results/sky-exposure-2026-10-25/`. These checks load no full beach scene.
- 60 FPS follow-up: 20 pacing, simulation, transfer and profile checks passed,
  along with the production build. Pacing stays at 60 on displays from 60 to
  240 Hz, does not further throttle slow rendering, and cannot burst through
  missed frames after a stall. The asynchronous physics path is unchanged.
- Shared live follow-up: 80 relevant numerical, scheduling, safety and routing
  checks passed with the production build. Small GPU fixtures (175 samples)
  produced identical packed results to the synchronous route; maximum CPU
  pressure difference was 0.00001073 against a 0.00028 tolerance, with held
  samples unchanged. Deferred pressure used zero readbacks plus one packed
  transfer per step. Local timings demonstrate lower blocking submission cost,
  not a measured full-scene RTX utilization or FPS improvement.
- `/tests/live-night-gpu.html` checks the production Gaussian stars/galactic
  shader without a beach simulation. `/tests/live-pipeline-gpu.html` checks the
  bounded pipeline. Both create a context only when requested. Raw results and
  the isolated sky preview are in `tests/results/live-experience-2026-10-25/`.
- Controls follow-up: panel styling is embedded with the UI module, and the
  Show/Hide button controls an explicit overlay. FPS and simulation rate stay
  in the bottom-left corner when the panel is hidden. The isolated no-graphics
  fixture (`/tests/rtx-ui.html`) checks running and paused readouts without an
  external stylesheet. Hide/show and overlay placement were also checked in
  the production sand lab with `startup=prepare`; 19 startup checks and the
  production build passed. No full-scene GPU work was run for this UI change.
- OpenGL recovery follow-up: 54 targeted startup, graphics-safety and CPU-reference
  tests passed, along with the production build. The separate Chrome launcher is
  tested with a mocked Windows process launch. The user verified the underlying
  OpenGL launch command and full scene on the actual RTX machine; the latest
  shader-preparation changes still require a full-scene check there.
- The new 12-cell GPU maximum-reduction check retained all 729 samples per cell
  and matched the CPU reference exactly (maximum error zero). Its prepared
  program was reused by the first draw after the initially null sampler was
  populated. Raw result: `tests/results/rtx-startup-2026-10-24/macro.json`.
- 77 targeted CPU numerical, routing, startup, and fallback regression checks
  passed. `npm run build` passed.
- All eight GPU pressure/contact fixtures passed locally on AMD Radeon Pro 560X
  through ANGLE Metal. Maximum positional difference: **0.00004843**, below the
  **0.00028** tolerance; held samples stayed unchanged.
- Two tiny rendering comparisons (nearest and linear filtering, 32 × 16 pixels)
  produced **zero difference** between implicit sampling and explicit level zero.
  The rendered comparison image was visually inspected.
- Raw local results: `tests/results/rtx-startup-2026-10-24/pressure.json` and
  `sampling.json`. These are local arithmetic checks, not RTX throughput results.

Manual checks are at `/tests/rtx-gpu.html`, `/tests/rtx-sampling-gpu.html`, and
`/tests/rtx-macro-gpu.html`; they create no graphics context until clicked. The
control panel and 19-program startup plan were inspected with `startup=prepare`,
which constructs scene state but compiles/draws no scene shaders. The full scene
was not stress-tested again on the Mac. No new Windows throughput measurements
or quantitative startup-time improvements are claimed.
