# Bounded GPU pressure — October 24, 2026

A separate GPU pressure/contact pipeline is now available in the live sand lab under **GPU pressure when measured faster**. The previous monolithic object-contact shader remains blocked. Historical snapshot scenes do not opt in.

## Method and limits

Pressure density, pressure correction, analytic boundary density, and analytic contact projection are four separate, small compute passes. Each draw covers at most 2,048 samples; the entire solve is capped at 32,768 samples, 128 neighbors and three iterations. The geometry shader contains only the cached beach heightfield, up to sixteen spheres/oriented cups, the player capsule and domain bounds. It does not include scene rendering, lighting, arbitrary sand CSG, or neighbor arithmetic. One readback follows the three iterations.

Every new renderer must first pass independent CPU comparisons on 175-sample fixtures. These include held water, sparse water, an oriented cup, a player, boulders, ground and bounds. The live path then measures four CPU steps (discarding the cold first sample). Scenes smaller than 8,192 water samples, carved sand, more than sixteen bodies, disabled cached terrain, or size changes outside the calibrated range retain CPU pressure. Three GPU samples must average at least 5% faster than the CPU baseline; the same rolling check continues afterward. A slowdown latches CPU pressure for the session. A solve exceeding 80 ms, nonfinite output, changed held positions or a graphics failure also disables further submissions. A time check cannot interrupt a draw already submitted to the driver; small kernels and bounded draw sizes are the preventive measures.

The CPU fallback is the existing compiled solver, or the JavaScript reference when compiled contacts are disabled/unavailable. Sand, rigid bodies, player, rain mass and neighboring searches still run on the CPU. Normal transport, air and fine-particle work keep their existing GPU paths. Simulation does not depend on camera distance or visual LOD. No mass, spacing, timestep or saved terrain edits are changed.

## Measurements and validation

The initial default-size comparison used 13,293 samples and two warmup pairs followed by six measured pairs, with alternating CPU/GPU order. Each receives identical inputs. The CPU is the current optimized adaptive solver; the GPU executes full pressure passes. Transfers and synchronization are included.

| Result | CPU mean | GPU mean | Interpretation |
| --- | ---: | ---: | --- |
| Initial default beach comparison | 59.22 ms | 33.32 ms | 1.78× constraint-stage speedup |
| Four-second coupled test, 3,024 samples | 20.39 ms | 34.15 ms | GPU overhead loses on this small scene |
| Subsequent default-size check | — | 113.8 ms | Exceeded the 80 ms guard; no subsequent GPU checks ran |

This is **not evidence of a consistent whole-scene FPS or realtime-speed improvement**. Shared GPU load and synchronization produced substantial variance. The default path therefore selects a backend from measured costs and retains the CPU when offload does not pay off. No graphics errors or lost contexts occurred during this retry, and no browser/computer restarts were performed. Full-scene rendering was not exercised after the bounded time limit was reached.

Small-fixture maximum errors were 3.99e-5 simulation units for pressure with CPU contacts and 1.48e-5 for GPU beach contacts, under the 2.8e-4 tolerance. Held positions and flags matched exactly. The 60-step coupled pressure/prediction/transport test preserved exact parcel volume and positive ground clearance. At the fixture's 10 m/unit scale, mean height differed by 1.88 mm and the 95th-percentile height by 1.01 cm; peak speeds were 2.15 versus 2.18 units/s. Individual particle trajectories are not identical: the maximum coordinate difference after four seconds was 0.442 units (4.42 m), with a mean absolute coordinate difference of 0.00984 units. The nonlinear solver amplifies tiny arithmetic differences; the coupled check evaluates aggregate water shape, speed, mass and contact stability, not long-term particle identity.

Raw evidence: [small validation](validation.json), [initial benchmark](benchmark-earlier.json), [coupled simulation](trajectory.json), [time guard](time-guard.json). The focused numerical regression suite passed 55 tests; the production build passed with its existing chunk-size warning. New policy tests exercise small/oversized scenes, edited sand, body limits, live texture handoff, numerical rejection and permanent fallback without a graphics context.

## Rejected approach and promising follow-up

[Position Based Dynamics, Müller et al., §3.4](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf) motivated testing contact planes prepared outside the pressure iterations. Frozen planes diverged too much around the curved and concave cup geometry, so that experiment was removed. The shipped path evaluates analytic contacts each iteration.

The useful next direction is keeping pressure and transport data resident on the GPU, with a single combined readback for CPU consumers. This may reduce the synchronization variance seen here. Bounded compiled CPU contacts remain preferable for arbitrary sand edits until a separate, equally small and numerically checked GPU representation is available. A permanent GPU-only switch is not justified by these measurements.
