# Shared live sand lab on WebGPU

Open `/?scene=sand-lab&renderer=webgpu&backend=gpu&paused=1` through the local server. The page shows the full live scene and controls. Resume starts ordinary playback. `backend=safe` retains CPU/WebAssembly physics with native WebGPU rendering. WebGL remains the default because the first faithful full-scene port is slower on the tested Mac.

This is separate from `src/resident-water`: that experiment demonstrated fast resident water with reduced features. This adapter preserves the existing live scene's materials and interactions instead of substituting that reduced renderer.

## Shared implementation

`src/rtx-sand-lab/main.js`, `LiveSandLab`, and `LiveWaterRenderer` remain authoritative for both rendering backends and both branches. THREE supplies cameras, scene/geometry containers and material definitions; this adapter creates no WebGL context. Native WebGPU executes every draw and the GLSL texture-compute passes. Covariance-projected Gaussian geometry, SH response, edge tracing, optical layering, stars, exposure and existing controls are retained.

`translate.js` uses Babylon's GLSL processor to assign resources/varyings, glslang for SPIR-V, and Tint for WGSL. Translation happens in a worker. Compiler assets are shipped locally, with licenses in `public/vendor`; no runtime CDN fetch. `uniforms.js` implements the std140 contract. `renderer.js` implements only the rendering interface actually used by the live scene, not a general replacement for THREE.WebGLRenderer. Shader keys depend on declared resources; unrelated shared uniforms cannot trigger new variants.

The connected water pipeline can share the rendering device. Its pressure/deposition/neighbor/contact work runs on WebGPU after CPU/GPU verification. **The full simulation is not yet GPU-resident.** CPU sand, bonds, rigid bodies, player, rain mass, droplets, scalar transport, geometry preparation and final water readback remain. Keeping these functions intact preserves feature behavior but also retains their cost.

## Safety and lifecycle

- One render frame in flight, sequential pipeline compilation before any frame dispatch.
- 30-second translation/pipeline budgets and a normal 2-second submitted-work budget. Startup's one-pixel exercise has its existing separate 10-second completion budget. The longer compilation allowance concerns asynchronous CPU/driver compilation, not a longer GPU workload.
- Rendering allocations capped at 512 MiB, checked before allocation. Compute has its separate fixed capacity/overflow checks (~40 MiB in the tested connected case).
- Requires `float32-filterable` and `float32-blendable`; unsupported devices stop with a WebGL-route message before building the scene.
- Resources are retired after their owning submission. Shared geometry attributes are released only after their final owner. Exiting the page destroys its device and compiler worker.
- Shared-device compute disposal never destroys the rendering device. Numerical failure retains the explicit CPU physics fallback.
- No synchronous WebGPU readbacks, simultaneous scene tests, retry loops or automatic fidelity increases. Presentation stays capped at 60 FPS.

These are bounded safeguards, not a guarantee against driver failures. One cold production pipeline exceeded the original 10-second compile allowance and stopped cleanly; declared-resource cache keys and a distinct 30-second asynchronous compilation budget address that case. The revised production build completed startup, solver validation and 45 playback frames (~102 MiB rendering allocations) without device loss. Do not describe this as a device crash or omit it from the evidence.

## Validation and next steps

`tests/webgpu-scene-backend.html` performs explicit, bounded checks and exports frozen pixels/image stages. Add `backend=webgl` for the matched reference. `snapshot=features` includes glass, mirror/light cups, rock, tannins and a terrain carve. It first renders the loaded terrain before editing, so the reference's partial texture updates have initialized storage. `snapshot=night` adds an underwater night view.

Run the focused tests and build:

```
node --test tests/webgpu-scene-backend.test.js tests/live-connected-fields.test.js tests/live-particle-compute.test.js tests/live-field-stability.test.js tests/live-field-transfer.test.js tests/live-field-transport.test.js tests/live-cpu-throughput.test.js
npm run build
```

[Measured workload and image evidence](../../tests/results/full-webgpu-2026-11-08/report.html) records both the slower full-scene port and the remaining CPU work. Next priorities are direct resident-state reconstruction, connected mutable terrain/body feedback, and reducing duplicated optical passes with frozen-image validation. Do not claim the water-only prototype's speedup applies to this full port.
