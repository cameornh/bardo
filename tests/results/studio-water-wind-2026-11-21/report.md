# Asset studio water and wind

The existing in-memory 24-body water fixture ran four blocks of 72 completed frames at 640 × 360 with 8 m/s wind, using a 60 FPS presentation cap. The renderer waits for each submitted frame before counting it. Simulation speed is simulated seconds per wall-clock second. [Run the fixture](../../studio-surface-cost.html?dense=1).

| Surface renderer | FPS | Simulation speed | Mean completed frame |
| --- | ---: | ---: | ---: |
| Gaussian | 12.26 | 0.955× | 77.18 ms |
| Automatic | 17.01 | 0.978× | 54.47 ms |
| Automatic | 17.54 | 0.981× | 53.62 ms |
| Gaussian | 11.93 | 0.900× | 78.97 ms |

Both automatic blocks finished close to realtime. The earlier opaque-water studio recorded 30.03–32.21 FPS in the same automatic fixture on a separate run. The extra views, optical reconstruction and spray carry a visible frame-rate cost. [Previous measurements](../studio-wind-water-2026-11-20/measurements.json).

The 480 × 300 optical check drew a red block above and another below calm water. It compared cropped pixel regions after removing geometry, changing the refractive index, increasing absorption and lifting ten touching parcels. Reflection, transmission, refraction, attenuation and the lifted-water checks all passed. The lifted handful rendered through one connected bounding box. Neither studio test lost its graphics context. [Run the optical check](../../studio-water-optics.html).

The CPU regressions cover contact spray at the upstream face of a fixed wall, clearance over a raised collider, spray against solids, open-water breaking, retention and re-entry of dragged liquid, fracture of a weak anchor under wind, and conservation of mobile sand during transport and deposition.

The separate beach regression completed all four blocks with 3,024 markers and 48 edits. The reference reached 5.55 FPS and 0.711× realtime. The optimized beach reached 5.73 FPS and 0.735×. Both used the existing beach implementation and finished with an intact graphics context. [Beach fixture](../../scene-performance.html?cycles=1).
