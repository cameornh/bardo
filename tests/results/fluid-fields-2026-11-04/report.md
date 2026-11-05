# Bulk fluid fields verification — 2026-11-04

Implementation: `src/fluid-fields`. Preview: `/?scene=fluid-fields`.

- 26 relevant numerical/startup tests passed: `node --test tests/fluid-fields.test.js tests/scene-startup.test.js tests/rtx-startup.test.js`.
- Production build passed (existing large-chunk advisory remains).
- Live WebGL 2 validation passed on Intel UHD Graphics 630 through ANGLE/Metal. Full machine output is in `gpu.json`.
- Two GPU fixtures cover two and four disconnected air/water regions. Maximum CPU/GPU potential difference: 1.60e-7 m²/s. Maximum velocity-correction difference: 2.65e-7 m/s, below the 2e-5 acceptance tolerance. Projection reduced divergence by more than 99.9999% in those fixtures.
- Final small-grid calibration: CPU pressure 7.0 ms; GPU pressure including CPU convergence correction 64.3 ms. Automatic mode selected CPU. These are bounded solver timings, not an end-to-end beach benchmark.
- The full small field fixture ran beyond 30 simulated seconds in the preview. Heat and vapour totals remained within floating-point roundoff. Warm CPU steps observed around 16 ms; performance varies with browser load.
- Visually inspected temperature, humidity, pressure, velocity arrows and a second slice direction. Applied a warming probe and inspected temperature, specific humidity, relative humidity and pressure at the affected air cell. Saved the final temperature/velocity inspection in `preview.jpg`.
- The beach rendering/physics, old snapshot implementations and saved terrain were not changed. The new experiment uses a fixed interface and does not yet exchange momentum with beach particles.

Future work: multigrid pressure and GPU-resident transport before scaling up; conservative particle/grid coupling and a moving liquid interface before replacing the beach solver.
