# RTX GPU test branch

Branch: `codex/rtx-5070-ti-gpu`. Intended for the separate RTX 5070 Ti computer.
The original `main` checkout and historical test implementations remain unchanged.

## Update and run

From the repository folder on the test computer:

```sh
git switch codex/rtx-5070-ti-gpu
git pull --ff-only
npm ci
npm run start:windows
```

Open `http://127.0.0.1:5178/?scene=sand-lab&backend=safe&paused=1` and keep the terminal open.
Alternatively double-click `Start-Windows.cmd` after dependencies are installed.
The launcher checks the Node version, builds the production bundles, and serves
only that build on port 5178. A port conflict is an error rather than silently
choosing another address. Build errors stay visible in the terminal. It reports
the source revision and writes `/build-info.json` with the build identity.
The suggested URL starts with CPU pressure and GPU rendering/transport, matching
the Mac's pressure baseline. GPU pressure remains available in Diagnostics after
the scene is working. The normal root URL still selects the GPU experiment.

`npm run dev` remains available on port 5173. Production startup removes the
development module graph from the investigation; it does not change rendering
or simulation settings. This branch also opens the GPU sand lab at its root URL. **On `main`,
the root URL opens the older “10 · Open beach” snapshot instead**; comparisons
must use the explicit sand-lab URL.

The experiment shows a paused scene frame before its optional GPU pressure
checks. Eight fixtures of at most 175 samples compare GPU arithmetic and
contacts against the CPU reference. Resume after the checks finish.
Diagnostics show the actual adapter, backend, and comparison results. Confirm
that Chrome reports the NVIDIA card. Rendering uses WebGL 2 and parallel compute
uses fragment shaders; this is not CUDA or WebGPU. Floating-point targets require
[`EXT_color_buffer_float`](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/).

## If startup stalls

The page now displays **Startup diagnostics · startup-v3** before importing any
scene modules. It captures module download/parse failures and rejected startup
promises as well as graphics errors. Initialization yields between major stages
so the browser can display progress. Controls stay inactive until startup ends.

The last stage, including the last first-frame drawing pass, is written before
the operation begins. Open `http://127.0.0.1:5178/?startup=report` and click
**Copy startup report** if a page stalls without producing an error. This report
route never imports a scene or requests a graphics context, and reading it does
not erase the saved attempt. Reports use browser local storage, with session
storage as a fallback, under a separate diagnostic key.

`/graphics-health.html` is included in both production and development builds.
It uses one pixel to check WebGL 2 and reports the actual adapter when available.
It loads no scene shaders or simulation. A pass establishes basic graphics
availability; it does not validate compilation of the larger scene programs.

## Startup compatibility changes

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
- Existing compatible optimization checkboxes start enabled. Display is capped
  at 60 FPS instead of 15. Physics uses a 12 ms inter-step budget, allowing at
  least one due step. Requested realtime speed and timestep remain unchanged.

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

## Validation

- Windows-startup follow-up: 44 targeted startup, graphics-safety and CPU-reference
  tests passed, along with the production build. The production launcher, saved
  report page and packaged graphics check were checked locally. Windows execution
  still requires verification on that machine; no Windows result is claimed here.
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

Manual checks are at `/tests/rtx-gpu.html` and `/tests/rtx-sampling-gpu.html`.
Neither creates a graphics context until its button is clicked. The full scene
has not been stress-tested on the Mac during this change, and the RTX startup
fix remains unconfirmed until tested on that computer. A blank screen on the
older root scene does not establish the cause of the sand-lab shader failure.
