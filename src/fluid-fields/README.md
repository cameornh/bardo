# Bulk fluid fields experiment

Open `/?scene=fluid-fields` (also linked as scene 13 in the live sand lab). The development alias is `/tests/live-fluid-fields.html`. Starts paused after one projected step. `backend=cpu` skips GPU initialization; `backend=gpu` explicitly selects the GPU after validation. Historical scenes and saved terrain data are not touched.

## Why a field solver

The live beach currently uses particle-neighborhood density/position constraints for incompressibility and neighbor velocity diffusion for viscosity. Its air lattice caches procedural wind, obstacle slip and shelter; it does not solve air pressure. Render-density Gaussians are another representation, not a physical pressure field.

This experiment implements a small Eulerian, staggered (MAC) grid for **low-Mach incompressible Navier–Stokes**: velocity advection, viscosity, then a pressure projection. This follows the grid/projection construction in [Bridson and Müller-Fischer's SIGGRAPH fluid course](https://www.cs.ubc.ca/~rbridson/fluidsimulation/fluids_notes.pdf). Grid pressure is a natural bulk representation. Retaining particles for a moving liquid surface is a subsequent coupling task; [APIC](https://www.andyselle.com/papers/24/) is a useful reference for transfers that lose less motion than basic PIC. APIC/FLIP transfers are **not implemented here**.

## Fields and units

| Quantity | Location | Meaning |
|---|---|---|
| Velocity | Cell faces, both phases | Three staggered components, m/s |
| Dynamic pressure | Cell centers, both phases | Pressure enforcing the divergence constraint, Pa |
| Absolute pressure | Cell centers, both phases | 101,325 Pa at the reference interface + hydrostatic head + dynamic pressure |
| Temperature | Cell centers, both phases | Kelvin internally, Celsius in the view |
| Specific humidity | Air cell centers only | kg water vapour / kg moist air; displayed as g/kg |
| Relative humidity | Derived for air only | Vapour pressure / saturation pressure at local temperature and absolute pressure |

The humidity definition follows [ECMWF atmospheric thermodynamics](https://stage.ecmwf.int/sites/default/files/elibrary/2015/16954-atmospheric-thermodynamics.pdf). The warm-temperature saturation approximation follows [FAO's Tetens equation](https://www.fao.org/4/X0490E/x0490e07.htm). Cooling increases relative humidity at fixed vapour content. Supersaturation is retained rather than deleting water; condensation/latent heat is deliberately deferred. This is a warm-water test, not an ice/snow thermodynamics model.

## Boundaries and numerical choices

- A **fixed horizontal interface** separates air and water. Each phase has no normal flow through the interface or solid walls, and free tangential slip. This is a rigid-lid validation setup, not a moving two-phase ocean simulation. Dynamic normal stresses are not yet coupled across the lid.
- Pressure has an independent zero-mean gauge in **every connected fluid region**, including cavities split by obstacles. Hydrostatic equilibrium is handled analytically rather than applying gravity and asking the iterative solver to cancel it every step. No acoustic pressure waves or compressible gas equation of state are simulated.
- Within each constant-density region, the Poisson unknown is `phi = dt * dynamicPressure / density`. Normalization avoids conditioning the solve on the water/air density ratio. The matrix is the symmetric six-neighbor graph Laplacian, with the exact adjoint MAC divergence/gradient pair.
- Velocity uses first-order semi-Lagrangian advection, phase-aware interpolation, and short wall-clipped backtraces. This is dissipative, especially on a coarse grid. Viscosity uses symmetric face diffusion with molecular coefficients by default; the diagnostic multiplier deliberately exaggerates it.
- Scalars use conservative upwind face fluxes. Heat diffusion exchanges **energy**, with the different water/air volumetric heat capacities and harmonic thermal conductivity across the interface. Moisture cannot cross into water or solids. The optional mixing diffusivity acts inside each phase only; solids are insulated.
- CFL and explicit-diffusion limits bound each timestep. The simulation does not depend on slice orientation, display size, camera or visual detail.

## Compute and diagnostics

GPU work is a dedicated small WebGL 2 six-neighbor pressure stencil (red/black SOR). No full-scene SDF, complex scene shaders or particle-neighborhood searches are used. Hard bounds: 32,768 cells, 96 sweeps maximum, 8 sweeps outstanding between fences, and one step in flight. Readback is fenced and failures disable further GPU submission. A timeout stops future work; it cannot cancel GPU commands already submitted.

The CPU reference is matrix-free diagonally preconditioned conjugate gradient. An independent FP64 SOR reference verifies GPU outputs. GPU residuals above the convergence threshold receive a CPU correction before velocities are updated. **Advection, viscosity, scalar transport, boundary setup and debug visualization are CPU work.** The UI reports the actual pressure path, including corrections.

Automatic mode compares complete pressure solve times on the current grid, including GPU convergence correction. A small grid can favor CPU execution because GPU dispatch/readback dominates. GPU availability does not imply a speedup. No claim is made that this prototype accelerates the existing beach. Presentation remains capped at 60 Hz; simulation targets at most 1× realtime and does not queue catch-up work.

Views: temperature, dynamic/total gauge pressure, speed with vector arrows, specific/relative humidity, and divergence. Slice all three axes, isolate a phase, and inspect exact values under the pointer. Push, heat, cool and moisture probes exercise the transport without adding rain, evaporation, buoyancy or other external behavior.

## Verification and next steps

`node --test tests/fluid-fields.test.js tests/scene-startup.test.js` covers manufactured pressure recovery, matrix symmetry, disconnected gauges, projection energy, wall fluxes, density scaling, viscosity, heat/vapour conservation, hydrostatic rest and sustained stepping. The preview validates the actual GPU in two fixtures, including four disconnected regions, against the independent CPU reference at a 2e-5 tolerance.

The next useful optimization is **multigrid/preconditioning**, not more relaxation passes. A larger bulk grid also needs GPU-resident advection/scalars to avoid frequent readback. The next fidelity task is a moving free surface and conservative particle/grid transfers, then variable-density interface pressure and subcell solid boundaries. [Batty, Bertails and Bridson's variational solid/fluid coupling](https://www.cs.ubc.ca/labs/imager/tr/2007/Batty_VariationalFluids/) is relevant to that boundary treatment. Preserve the near-surface particle representation until that coupling is validated.
