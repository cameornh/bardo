# Live beach fluid fields

The live sand beach opts into this solver with `bulkFields: true`. It replaces
the three global particle-density pressure passes. Historical `SandLab` scenes,
previous live fixtures, and the isolated `fluid-fields` experiment do not opt in.
The terrain edit store, Gaussian/SH renderer, and 60 Hz presentation cap are unchanged.

## Physics path

1. Keep the existing water parcels as the volume and free-surface representation.
   Predict their motion with the existing gravity, contact, wind and wave forces.
2. Deposit predicted velocities onto a camera-independent staggered (MAC) grid.
   Moving sand, objects, boulders and the player define its solid occupancy.
   Air is advected and forced by wind/brush input. Water and air share normal
   interface flux and use their respective densities and kinematic viscosities.
3. Project velocity by solving the variable-density pressure Poisson equation.
   The pressure field is gauge pressure in Pa; adding 101325 Pa gives absolute
   pressure. Water's gravity-induced hydrostatic component is included. Air is
   an incompressible, constant-density approximation, not an acoustic simulation.
4. Transfer the incremental pressure/viscosity velocity change back to parcels
   (FLIP-style). Preserve their count/volume and held state. Retain one local
   density/contact pass in the surface/solid band. Reciprocal pair forces reach
   the adjacent interior particles. The same existing WASM arithmetic accelerates
   this pass, with a tested JavaScript reference. Thin cups and carved sand still
   use fine SDF contacts; their sub-cell shape is not replaced by the coarse mask.
5. Water transport defaults to compiled CPU arithmetic alongside the CPU contact
   pass, avoiding its former extra round trip. Reuse the existing GPU surface
   reconstruction, spray, foam and grain systems. A small GPU resampling pass supplies the projected air to
   their existing air atlas. CPU rain, wind forces, and objects sample that same
   projected field. Changes to water parcels from rain/tides appear in the next
   grid occupancy/deposition; no separate grid water mass is added.

Temperature (K) is advected in each phase and conducts across the interface.
Air specific humidity (kg vapour/kg moist air) is advected only in air. Relative
humidity is derived from temperature and absolute pressure. Rain takes the local
air temperature on impact, mixes sensible heat into water, and existing rain-only
surface condensation patches exchange sensible heat with air and expose ambient
humidity. This does **not** enable evaporation, humidity-driven condensation,
latent heat, weather generation or thermally driven buoyancy.

The thermal ledger includes boundary, moving-mask, rain, drop and debug-probe
exchanges. Newly occupied phase cells use ambient phase temperature and humidity;
the energy/vapour difference is explicitly recorded as remapping exchange. This
is a coarse Eulerian thermal model, not material-perfect heat tracking through
rapidly changing interfaces. Existing restrictions on condensation (objects and
boulders only, removed under water) remain authoritative.

## Multigrid and execution

Phase-aware aggregates form a Galerkin hierarchy (`Ac = Pᵀ A P`), with weighted
Jacobi smoothing and a V-cycle preconditioner for conjugate gradients. Open air
boundaries have zero gauge pressure; water perimeter/solids have no-through-flow
conditions, with moving-wall normal velocity. Sealed components have independent
pressure gauges and compatible right-hand sides.

The default CPU solver converges to a relative residual of 2e-5. The live lattice
has at most 4096 cells and does not depend on camera motion. Cell size is coarse
and bounded by a work budget; parcel/sand resolution remains independent of it.
This is not adaptive fine-resolution CFD, and its pressure accuracy is limited
by this coarse moving occupancy mask.

The optional GPU backend uses short, generic sparse-stencil shaders on the
existing WebGL renderer. Pressure, residual, restriction and prolongation stay
GPU-resident across two V-cycles; only the final pressure is read back. CPU
residual correction completes convergence when necessary. Transfers, geometry,
temperature/humidity transport and rigid bodies still use CPU. Surface contacts
and water-particle transport default to CPU, with the separate WebGPU option below.
Only one physics job is in flight. Work/stencil/readback budgets disable failed
or excessively slow GPU solves instead of repeatedly submitting them.

`Verify small GPU field` compares a 288-cell V-cycle with the CPU result and
checks a complete corrected solve before enabling the GPU option. This Mac's
measured GPU pressure was slower than CPU at this grid size, so GPU pressure is
not automatically enabled. The RTX branch uses the same feature implementation;
users can select the validated GPU path on that hardware.

The multigrid design follows the pressure/preconditioning approach described in
[McAdams, Sifakis and Teran, 2010](https://www.math.ucdavis.edu/~jteran/papers/MST10.pdf),
adapted here to a small, changing two-density graph. It is not a reproduction of
that paper's optimized large-grid implementation.

## Controls and checks

Open `/?scene=sand-lab&paused=1`, then the **Air / water fields** controls.
`Step beach once` initializes/advances the field while keeping the scene paused.
`Show field slices` exposes pressure, velocity, temperature, specific/relative
humidity and divergence, phase filters, three slice planes, arrows, exact hover
values, and heat/vapour probes. Hide slices to avoid their diagnostic drawing cost.
The checkbox can compare with the old solver without clearing terrain edits.

Run `node --test tests/beach-fields.test.js tests/fluid-fields.test.js` and
`npm run build`. `/tests/live-beach-fields.html` runs bounded numerical beach
steps and a small GPU check without loading the full scene shaders.


## Optional WebGPU particle pipeline (2026-11-07)

`Verify GPU particles` compares six bounded fixtures against the CPU reference,
checks deliberate spatial-bucket overflow, then warms the current beach while
paused. The warm-up result is discarded. Select **WebGPU** under **Particle
backend** after it passes; the default remains CPU/WebAssembly. Both machine
branches share these controls and code. `/tests/live-particle-compute.html`
contains the isolated numerical and physics-only comparison, without a WebGL
renderer. This backend is independent of the optional WebGL pressure backend.

Five compute passes keep grid-to-particle transfer, spatial hashing, neighbor
lists, density/contact correction and viscosity/chemistry transport together.
They share GPU buffers and use one packed readback per step. Exact cell checks
reject hash collisions. Terrain B-splines, ordered sand CSG, oriented cup walls,
spheres and the player capsule use the same contact formulas as the CPU oracle.
There is no camera-dependent physics resolution.

Particle-to-grid deposition, the default pressure solve, phase geometry and
heat/humidity advection remain on CPU. Moving deposition alone would add another
readback before the CPU pressure solve. Removing that boundary means porting
these operations together, including rendering consumption of the resulting
state; that is future work, not a benefit claimed for this implementation.

Storage is fixed at approximately 35.4 MiB plus bounded readback. Limits are
32,768 particles, 8,192 hash buckets, 64 bucket entries, 128 neighbors, 32 objects,
32 sand parcels per query cell and 16 cuts per parcel, with an additional contact
work estimate. Overflow discards the entire result and selects exact CPU fallback;
it never silently truncates contacts. One job may be in flight. Failed/lost
WebGPU devices, invalid data and timeout/throughput guards select CPU. These
bounds reduce risk; browser GPU work cannot be guaranteed immune to driver bugs.

On the development Mac, numerical errors were small and the full beach ran
without a context loss. The GPU improved the measured particle stage, but did
not improve end-to-end frame rate in the high-wind rendered scene. CPU is kept
as the default for that reason. See the dated results and report under
`tests/results/particle-compute-2026-11-07/` for raw measurements and limitations.
