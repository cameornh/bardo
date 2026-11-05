# Beach field integration verification

Live implementation: `src/rtx-sand-lab/fields/`. Historical fixtures were not
changed. The live beach enables the hybrid path; its checkbox retains the prior
solver for comparison without clearing the terrain.

## Numerical checks

70 tests passed across beach fields, the isolated field experiment, asynchronous
transfer, rigid contacts, surface stability, shader dependencies/startup, shared
live experience and compatible reconstruction. Production build passed (existing
large-bundle warnings only).

The 14 beach-specific tests cover the two-density pressure operator, manufactured
pressure recovery, multigrid convergence, divergence removal, impermeable walls,
sealed cavities, thermal conservation, open-boundary/remap ledgers, diagonal-wind
scalar stability, held/spray particles, snapshot isolation, full CPU integration,
capillary-drop heat exchange and native/JS surface-contact agreement.

Three additional 100-step CPU runs (6.667 simulated seconds each, 1,164 parcels,
wind 0 / 24 / 80 m/s, tides and visual detail disabled) retained all water parcels
and finite positions. Maximum relative pressure residuals were respectively
1.9394e-5, 1.9843e-5 and 1.9964e-5. Temperature remained 287.15–293.15 K and
specific humidity 0–0.007932715 kg/kg. These runs check bounded stability, not
long-duration fluid accuracy or visual performance.

## GPU and live browser checks

On this Mac's Radeon Pro 560X / ANGLE Metal renderer, the 288-cell GPU verification
passed. Maximum one-V-cycle CPU/GPU pressure-potential difference was
4.0933e-9. The complete corrected solve had relative pressure error 4.3968e-6
against the tighter CPU reference and residual 7.1586e-6. One final readback
followed 85 bounded draws. No context loss or shader error was observed.

A full 13,293-parcel live beach step also completed using GPU multigrid plus CPU
residual correction: 3,553 field cells, 669 water cells, 13,063 coupled parcels,
relative residual 4.68e-6, divergence reduced from 0.0992/s to 4.65e-7/s. This
used the real scene renderer and existing GPU transport/air/fine paths.

The live scene was also stepped with CPU multigrid and native surface contacts;
the pressure/velocity cross-section and hover values were visually inspected.
Reset, solver toggling and slice controls were exercised. A reset callback and
canvas-aspect bug found during this check were corrected.

## Performance interpretation

GPU pressure took about 131 ms in the live step, compared with roughly 18–28 ms
for warm CPU multigrid. CPU pressure therefore remains the default on this
machine; the GPU path is explicitly validated before selection. There is no
claimed RTX measurement from this Mac.

The JS-only CPU reference comparison was encouraging (~110 versus ~1,000 ms per
warm step at 3,024 parcels), but that baseline lacks the real scene's native/GPU
accelerations. It is **not** evidence of a whole-scene speedup. The actual live
warm submission samples were about 277 ms with the added coupled fields versus
181 ms with the previous solver, excluding asynchronous transfer latency. These
are short samples, not average FPS benchmarks. The added air and scalar fields
currently have a cost on this Mac.

Useful improvements already made: bounded multigrid, GPU-resident V-cycle
intermediates, native reciprocal surface pairs, batched SDF contacts, and avoiding
global particle pressure iterations. Further speed work should target air
advection and particle/grid transfers (currently CPU), then persistent sparse
GPU topology/resources. More work on those is needed before claiming a net live
performance improvement. Increasing GPU pressure use alone was not beneficial
at this small lattice size.
