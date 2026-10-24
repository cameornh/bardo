# Beach throughput pass — October 24, 2026

This pass accelerates water constraints and reduces distant drawing work. The measurements below are **CPU constraint timings**, not whole-scene FPS or realtime-speed results. Baseline is the already optimized, compiled solver from commit `e2953a7`, not the slower JavaScript reference.

## Measured results on this machine

Six warmup pairs, then 24 measured pairs per scene, alternating execution order. Both paths receive identical predicted positions, neighbors, geometry, wind (24 m/s), and the existing 1/15-second step. The larger beach has a 165 m width and retains physical resolution. The original baseline Wasm module is loaded from Git alongside the new module; both use the same comparison driver. No graphics context was created for these measurements.

| Scene | Mean, previous → current | Speedup | p95, previous → current | Standard deviation |
| --- | --- | --- | --- | --- |
| standard (13,293 water samples) | 67.3 → 35.9 ms | 1.87× | 79.2 → 40.4 ms | 5.8 → 2.8 ms |
| objects (13,293 water samples) | 74.3 → 39.0 ms | 1.91× | 84.1 → 42.4 ms | 6.5 → 2.5 ms |
| scattered (13,293 water samples) | 125.5 → 68.3 ms | 1.84× | 130.5 → 76.4 ms | 4.2 → 3.8 ms |
| large (26,592 water samples) | 139.5 → 73.3 ms | 1.90× | 172.7 → 89.0 ms | 20.6 → 8.2 ms |

Raw timings and numerical differences: [cpu.json](cpu.json). Timing variance is machine-dependent; these short matched runs do not establish long-run frame pacing.

## Changes enabled in the live sand lab

- **Batched compiled contacts:** collision and boundary arithmetic operate on whole arrays, avoiding tens of thousands of JavaScript/Wasm calls and temporary vectors per step. Boundary results are reused only for exactly unchanged positions within the same solve; geometry refreshes on every new step.
- **Compiled edited-sand contacts:** the same ordered sand bins, flattened ellipsoids, smooth unions, and carve/intersection cuts execute in Wasm. This was particularly useful in the scattered-sand case, which otherwise kept returning to JavaScript.
- **Adaptive pressure work:** the first iteration checks all water. Later iterations focus on density errors exceeding 1%, together with their entire neighbor support. Reciprocal pair corrections remain paired. Above 70% active coverage the original full pass is used; grabbing water and the wind brush also retain full pressure passes. Gravity, integration, transport, contacts and parcel mass are never turned off. The refinement decision does not depend on the camera.
- **Stronger continuous distance reduction:** water ray/column sampling transitions from the original near spacing to up to eight times that spacing (previously four), with an earlier smooth onset. The render target size stays fixed, and surface crossings still receive the existing root refinement. Covariance Gaussian primitives and directional SH lighting are retained.
- **Unused underwater view:** above the conservative support bound of every reconstructed water Gaussian, including the field interpolation halo, the underwater pass is skipped. This avoids an unnecessary draw and shader compilation. It resumes when the camera could be in water.

All five additions have individual optimization checkboxes. Their dependencies disable transitively without discarding the user's selections. Old snapshot scenes do not opt into the new paths. Physical spacing, particle counts and timestep are unchanged by these switches. CPU constraints retain the JavaScript reference/fallback; the existing GPU object-contact safety restriction remains in place. Normal live operation still uses GPU transport, air, fine particles and reconstruction; sand, rigid-body and player simulation remain on the CPU.

## Numerical and graphics validation

Batch contacts matched the existing solver exactly in the tested held-water, player, cup and edited-sand fixtures. The compiled complex-sand tests compare contacts and normals against the JavaScript geometry, including a second set of geometry edits, within 1e-6 position / 1e-7 metric tolerances.

A four-second, 3,024-sample pressure/transport comparison preserved exact parcel volume, finite positions, bounded contacts and stable peak speeds. The mean water-height difference was approximately 2.6 mm at the fixture's physical scale; the 95th-percentile height difference was approximately 9 mm. In the full-size single-step benchmarks, the maximum individual position change from adaptive pressure was approximately 2.9 cm, versus 1.91 m sample spacing. Those are bounded approximation measurements, not a promise of identical trajectories indefinitely.

The focused regression suite passed, and `npm run build` passed. See [validation.txt](validation.txt).

A paused preview was inspected before the later graphics failure, but the final rendering changes and full-scene throughput **are not verified**. During the bounded comparison, the submerged shader failed with both compile-status checks false and no driver error log. The graphics guard stopped submission. A subsequent page reload reported WebGL unavailable (`GL_VENDOR = Disabled`, `GL_RENDERER = Disabled`, `BindToCurrentSequence failed`). No more graphics checks or restarts were attempted. The paired FPS/realtime comparison did not complete and is not used as performance evidence.

The new benchmark page loads no graphics context until a test button is pressed, uses one context, retains partial results on failure, and has a per-scene time budget. Its two comparison paths both use the conservative underwater-pass cull, so a future comparison isolates the other changes. A more complicated reduction in volumetric-lighting intervals was removed after the graphics failure rather than being enabled without validation.

## Research used and next useful work

[Adaptive Position-Based Fluids, Köster and Krüger (2016)](https://arxiv.org/abs/1608.04721) motivated allocating pressure iterations per region/particle instead of giving every parcel the same iteration count. This implementation uses density residuals and neighbor support, not that paper's camera-dependent criteria.

[Position Based Fluids, Macklin and Müller, SIGGRAPH 2013](https://mmacklin.com/pbf_sig_preprint.pdf) provides the incompressibility/iteration tradeoff underlying this approach. The present implementation retains the existing PBF constraints and kernel equations.

[NVIDIA GPU Gems 3, Chapter 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids) discusses reduced-resolution fluid rendering and integration choices. It informed keeping a stable pixel grid and spending less sampling work on distant fluid. The variable volumetric-integration experiment is not included in this change.

The most promising further work is to separate the large scene/lighting shaders into smaller bounded passes, then measure completed frames safely; without that, CPU gains cannot establish end-to-end improvement. Beyond that, moving compiled CPU constraints off the rendering thread could overlap their remaining cost with drawing. True interior particle merging would offer a larger simulation reduction, but needs conservative mass/momentum transfer and robust split/merge transitions; it is a larger change than the iteration shortcut shipped here.
