# Beach field performance and stability pass

Completed November 7, 2026. The result directory retains the November 6 session name. Baseline: `05b3f10f89e7599247c3776dd4471c2b3917317d`. Changes apply to the shared live beach; historical scene implementations retain their existing physics and rendering paths.

## Measured outcome

The final two standard-beach runs averaged **24.5% higher presentation throughput and 26.0% higher simulation throughput** than the fresh, same-session baseline. This is an improvement, but the full scene is still slow on this Mac; this is **not** a doubling or a real-time result.

| Run | Frames / wall second | Simulation / wall second | Median frame | 95th percentile frame |
| --- | ---: | ---: | ---: | ---: |
| Unchanged baseline | 3.22 FPS | 0.205× | 316.5 ms | 383.6 ms |
| Final compiled fields, run 1 | 3.85 FPS | 0.245× | 250.2 ms | 350.8 ms |
| Final compiled fields, run 2 | 4.18 FPS | 0.272× | 233.6 ms | 283.3 ms |

Sources: [baseline](baseline-same-session-45.json), [final run 1](compiled-fields-beach-45.json), [final run 2](compiled-fields-repeat-45.json). Aggregate throughput uses total frames/simulated time divided by total wall time, not an average of the on-screen FPS labels.

Conditions: own in-app browser, AMD Radeon Pro 560X through ANGLE/Metal, 1280 × 720 preview, 110 m beach, resolution 2.2, 13,299 bulk samples, 32,768 fine samples, wind 24 m/s, standard camera, compatible execution policy, existing adaptive drawing enabled. The baseline was served from the unchanged main checkout; only one graphics scene ran at a time. Each run covers 45 presented frames. These short runs are sensitive to thermal load and other work on the machine. They do not establish performance on Windows/RTX or long-session variance.

Intermediate results are retained rather than discarded. In particular, files named `final-beach-*` and `final-same-session-*` predate the compiled pressure solver. Their names are historical; they are **not** the final implementation measurements. The full/half-detail timing comparison was noisy and does not support assigning a particular percentage of the total gain to that change alone.

The isolated 3,553-cell pressure comparison alternated 20 solves per backend. Median time fell from **8.67 ms to 3.27 ms (2.65× faster)** with a maximum potential difference of **2.78e-17**. See [pressure comparison](pressure-comparison.json). Final browser pressure times were approximately 3–4 ms. The hybrid step also removes the physics state upload/readback round trip; both final logs report **zero physics state readbacks**. This does not mean the renderer or all diagnostics perform no readbacks.

## What changed

- Kept the pressure/particle state on the CPU through transport instead of uploading it for a small GPU stage and reading it back immediately. Pressure and transport now have compiled WebAssembly CPU kernels with explicit JavaScript reference fallbacks. Diagnostics identify them as CPU work.
- Reused pressure scratch storage and particle-to-grid interpolation stencils. Cached fixed MAC face advection stencils without changing the interpolation result.
- Tightened the live hybrid solver's neighbor margin to its actual single-correction bound. Reuse is invalidated by particle motion, spacing, size or backend changes; it never depends on the camera. Reciprocal transport computes a pair once when the complete neighbor list permits it; overflow uses the directed reference behavior.
- Drew soft water particles at half linear resolution and reused their depth-aware screen reconstruction. The projected covariance Gaussian, spherical-harmonic lighting, simulation count, main water surface and terrain resolution remain intact. The QA checkbox **Lower-resolution soft water particles** restores the previous drawing resolution. [Half](fine-half.jpg) and [full](fine-full.jpg) views show the same paused physical state; the lower-resolution result is somewhat softer.

## Water stability

The field integration had several interacting faults:

1. FLIP saved velocities after wall clamping, losing the wall impulse during transfer back to particles. Gravity/outward motion could accumulate at the boundaries.
2. The rounded-up lattice extended past the physical beach walls. It now uses exact rectangular extents with the corresponding per-axis divergence, projection and transport coefficients.
3. Sparse liquid faces could enter the wind branch. Liquid face velocities are now extrapolated before projection, and air sampling uses a separate air velocity field instead of feeding water motion back as wind.
4. A single sparse drop could mark an entire cell as incompressible water. Sparse spray now remains ballistic. Conversely, sufficient actual liquid occupancy overrides a coarse cell-center solid test at the sloping shore; exact particle contacts still handle the terrain and objects.
5. Numerical particle re-spacing was being converted into extra velocity. That shift is now excluded from the physical impulse while genuine collision corrections remain. A timestep-scaled PIC contribution damps unresolved FLIP noise.

The 30-second, full-count CPU audit with wind and tides disabled passed: **13,293 particles retained; all positions/velocities finite; final edge RMS speed 0.0229 m/s; maximum edge speed 0.0800 m/s; whole-water RMS 0.0488 m/s**. Sparse ballistic drops can still have greater speeds. Pressure relative residual was about 5e-6. See [all time samples](cpu-calm-30s.json). Reproduce with:

```sh
node tools/check-beach-field-rest.mjs
```

A separate browser calm fixture ran for 30 simulated seconds, plus bounded ordinary playback, a glass-object playback check and a camera sweep. None lost the graphics context or reported a shader error. [Glass playback](glass-playback-45.json), [camera sweep](camera-sweep.json), [calm browser view](final-calm-30s.jpg), [field debug view](field-slice.jpg).

This fixes the identified feedback and boundary failures; it does **not** make the coarse free surface perfectly smooth. Some shoreline stepping/puffiness remains visible at this resolution. Fractional surface cells and better particle/grid transfer are worthwhile fidelity work; increasing pressure iterations alone will not fix it.

## WebGPU result and execution policy

The existing bounded WebGPU pressure probe was run successfully in the in-app browser: **288 cells, 32 iterations, maximum error 2.38e-7** against the CPU result. It used 16.9 ms including compute/wait versus 8 ms for the probe's CPU reference. The device was released afterwards. See [probe output](webgpu-probe.txt).

The WebGPU probe selected an Intel `gen-9` adapter, whereas the WebGL beach used the AMD GPU. It is a tiny kernel comparison, not a complete WebGPU beach benchmark or a comparison with the new compiled multigrid solver. It therefore neither proves that WebGPU is unsuitable nor justifies enabling it for the beach by default. The bounded WebGL GPU field verification option remains available. No queue limits, graphics failure guards or 60 FPS presentation caps were relaxed.

Active roles: CPU/WebAssembly handles bulk pressure, particle transfer, surface contacts and transport; the existing CPU paths handle sand, rigid bodies and related bookkeeping. GPU work includes rendering, the air texture resample and fine particle evolution. The independent WebGPU experiment remains isolated.

## Research and next useful work

All three supplied video transcripts were reviewed: [Simulating Fluids](https://www.youtube.com/watch?v=rSKMYc1CQHE), [Rendering Fluids](https://www.youtube.com/watch?v=kOkfC5fLfgE), and [Simulating Smoke](https://www.youtube.com/watch?v=Q78wvrQ9xsU). The staggered velocity grid, explicit boundary conditions and precomputed grid relationships were directly relevant. The smoke example is two-dimensional; the beach remains a three-dimensional MAC grid with three velocity components.

The rendering direction is also supported by Simon Green's [Screen Space Fluid Rendering for Games](https://developer.download.nvidia.com/presentations/2010/gdc/Direct3D_Effects.pdf). Its front-surface/depth-aware filtering approach motivates the soft-particle resolution change. This implementation still uses covariance-projected Gaussians; the raster triangles merely cover each Gaussian's projected footprint.

The strongest remaining directions are:

1. **Move a complete persistent simulation pipeline to GPU**, including particle/grid transfer, neighbor construction and contact/transport work. Pressure is now only about 4 ms; moving only that stage is unlikely to produce a large overall gain. CPU/GPU exchange and the surrounding stages matter more. Preserve bounded dispatch sizes and numerical reference checks.
2. **Reduce or overlap the remaining CPU particle work.** Field preparation, neighbor search, surface contacts and transport still account for much of the roughly 100 ms CPU step. A worker and carefully bounded overlap with rendering could help, but neither was added in this pass.
3. **Try a separate screen-space Gaussian bulk-water renderer.** Reconstruct the visible front surface from projected Gaussians and keep a cheaper world field for underwater views, glass, reflections and off-screen queries. Replacing all world-space information with screen-space depth would break those cases. This larger change is not included here.
4. **Improve transfer and fractional boundary cells.** [The Affine Particle-In-Cell Method](https://math.ucdavis.edu/~jteran/papers/JSSTS15.pdf) offers a direction for reducing transfer noise while retaining motion. The current implementation is a PIC/FLIP blend, not APIC. Fractional free-surface/cut-cell treatment would address remaining shoreline stepping more directly than additional pressure iterations.

The accompanying primary implementations were also consulted: [Fluid-Sim](https://github.com/SebLague/Fluid-Sim) and [Smoke-Simulation](https://github.com/SebLague/Smoke-Simulation).

## Validation and limits

- 25 targeted numerical tests passed: field stability and boundaries, compiled pressure versus reference, transport parity across topology/capacity changes, neighbor coverage, scalar behavior and private render-resolution uniforms.
- `npm run build` passed.
- Full suite before the last two pressure tests: 739 of 741 passed. One failure was the restricted test environment's local server binding; all four startup-server tests passed when rerun with local server permission. The other is an existing `sand-drops-rigid.test.js` assertion expecting the old backend label `CPU object contacts`; the unchanged baseline fails the same assertion against the current `JavaScript CPU` label. That historical snapshot was left untouched.
- Both final beach measurements, glass playback and camera sweep completed in our own preview without asking for a restart or outside-browser access. These bounded checks cannot guarantee that every long-running workload or driver is crash-free.
- Both branches receive the same live feature code. Hardware-specific policy remains separate. Saved user terrain/clay data and historical test behavior were not migrated or reset by code changes.
