# Asset Studio sand editing and sustained structural loads

## What to try

In the world preview, choose sand for the ground. Repeatedly lift from one spot, move the scoop and release it. Loose sand that lands enters the same heightfield used for picking and rigid contact. Steep edges slump toward the material’s angle of repose. Throwing sand back into a pit raises its floor. Wind above the material’s entrainment threshold transports both the ambient dunes and the local relief.

Select **Check structural loads** in the [bounded preview](../../studio-ground-workload.html) to compare three members. The rear cantilever loses its outer half, the stronger middle cantilever holds and the soft foreground column buckles while staying attached. The [captured frame](structures.jpg) shows the result after 2.16 simulated seconds.

## Measurement

The fixture uses the three starter assets on sand, calm wind, a fixed camera and a 640 × 360 viewport. Each run warms up for 8 frames, samples the untouched scene for 48, issues 24 scoops and 24 impulses across 96 frames, then samples another 48 frames after input stops. Rendering, drawing the assets, Rapier stepping and terrain updates all run. Each sample waits for the GPU to finish. Realtime is actual simulated seconds divided by elapsed wall time. The follow-up interval can include sand that landed on an elevated object.

The local embedded browser ran the revised version, baseline, baseline and revised version in succession. The baseline uses commit `7947ba9`. The workload, fixed step, view and render settings match. Rates below pool the two equal-length runs per version using their wall times. CPU milliseconds per frame cover physics stepping. [Raw observations](measurements.json)

| Phase | FPS, before → after | Simulation speed, before → after | Physics ms/frame, before → after |
|---|---:|---:|---:|
| Untouched | 6.85 → 8.66 | 0.587× → 0.718× | 12.41 → 9.21 |
| During edits | 6.30 → 7.39 | 0.618× → 0.669× | 45.67 → 19.44 |
| After input stopped | 6.71 → 7.93 | 0.635× → 0.672× | 44.58 → 8.92 |

The runs varied in absolute frame rate. In both revised runs, physics after editing returned to within 0.6 ms/frame of its own untouched value. In both original runs it remained at least 28 ms/frame above its untouched value. All four runs completed every input with a healthy graphics context.

After tightening collision-tile invalidation to the exact shared edges, a final full-scene check completed all 48 gestures. It measured 7.56 FPS, 0.677× and 19.05 ms of physics per frame during editing, then 7.39 FPS, 0.646× and 7.98 ms once input stopped. The graphics context remained healthy.

A separate CPU run advanced exactly 1,728 physics steps per trial with the same gesture sequence and eight steps per frame. Mean time per step during edits fell from 3.35 to 1.30 ms. After input stopped, it fell from 2.84 to 0.74 ms. These timings include the tool actions and omit drawing.

## Limits and regression checks

- Ground edits are local to the physics preview. Their spatial history is sparse. The concurrent loose-parcel budget is 768. Steep cells and wind transport have separate fixed update budgets.
- Rigid contact, granular transport and failure use the CPU. Airborne sand from the tools uses one instanced Gaussian draw. A settled scoop has no separate terrain mesh or rigid body. A hard object above the terrain can still support airborne parcels.
- A slender single-box solid has one potential failure section. Stress is estimated from the forces, contact reactions and bending moments transmitted through the section. Compression is compared to an Euler buckling estimate. After sustained overload, a buckled section keeps an elastic joint and a fractured section separates into two colliding bodies. This is a preview approximation. Curved fracture paths, multiple cracks in one member and failure inside heterogeneous sculpts remain open.
- Regressions cover conservation through 75 scoops and 75 impulses, more than 64 distinct excavations, return of falling sand into an existing pit, collision height at a tile boundary, wind transport, reuse of scoop geometry, weak and strong beams, attached tip weights, free fall, broad support, wind failure and elastic/plastic ground recovery.
