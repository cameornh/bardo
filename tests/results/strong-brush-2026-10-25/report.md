# Stronger live wind brush

Both live machine profiles now use default brush speed **2,400 m/s** and maximum
**9,000 m/s**, ten times their previous values of 240 and 900. CPU/GPU air paths
receive the same existing speed parameter; no new graphics programs were added.

The previous sand erosion law flattened above 170 m/s of excess forcing. The
live brush now continues increasing above that point with a smooth bounded
response, approaching an effective excess of 2,000 m/s. Per-pass stock transfer
limits rise continuously with excess forcing, from 2% to at most 10% of a bed
column and from 8% to at most 40% of an explicit parcel. Existing 32-packet brush
and 8,192-fine-grain budgets remain unchanged, as do water travel limits.

The brush-only erosion policy applies to air. Ambient wind, underwater-current
erosion, material cohesion, and historical SandBed snapshots keep their previous
responses. No camera-dependent simulation or change in world resolution was made.

40 relevant numerical tests passed, including:

- Ten times the sampled brush velocity and 100 times the aerodynamic load on
  the same stationary test portion.
- Increasing high-speed erosion, continuous response at the former plateau,
  and finite bounded transfers at extreme speeds.
- Actual sand removal exceeding the former capped response, conserved sand
  stock and the unchanged packet budget.
- Exact agreement with the reference for ambient-air and underwater erosion.
- Existing carved-object contacts, live scheduling and material-particle checks.

`npm run build` passed. Sand erosion and the force checks run on the CPU. This
change adds no rendering work; no full-scene GPU stress test was run on the Mac.
