# Live sand editing, moon metering, and camera input

The shared live sand lab uses these changes on both machine profiles. Historical
SandBed fixtures retain their original editing path. Earlier moon snapshots keep
their previous radiance; the new disc response is explicitly enabled in the live
atmosphere.

## Moon

The live disc has 1/25,000 of the previous live radiance. Its bright rim now also
follows the continuous lunar phase response. Apparent size no longer changes
surface brightness. The direct sunlight / moonlight slider controls the visible
disc, lunar atmospheric scatter and existing direct surface illumination.

The isolated 256 × 128 production-shader check found a maximum exposure-target
change of 0.211% when looking toward the moon over illuminated fractions 0.005,
0.02, 0.1, 0.5 and 1. At 0.02 illumination the change was 0.014%. Slider zero
produced zero disc radiance, and slider three produced exactly triple radiance.
GPU atmospheric illumination matched the CPU reference within 0.000139%; exposure
targets matched within 0.000403%. The historical half-radiance snapshot remained
exactly 0.5. Raw results: `moon.json`; isolated preview: `moon.png`.

## Repeated editing

Previously every partial scoop inherited its parent's entire CSG cut history.
This grew the amount of collision, rendering and upload work with operation
count. The live policy now:

- Carries newly intersected scoops as rounded conserved portions instead of
  duplicating their source history. Whole-object pickups keep their shapes.
- Keeps at most 12 cuts per remaining portion. Older complicated remnants are
  reconstructed from occupied volume samples into at most 125 smooth portions.
- Recombines overlapping sub-cell settled portions with similar material
  properties, and returns small directly grounded matching deposits to the bed.
  Raised sculptures, held material and unlike wet/dry layers remain separate.
- Preserves mass, pore volume, moisture and retained adhesion memory when
  redistributing stock. All existing continuous material coefficients remain.
- Skips terrain and lighting invalidation for a stationary held sand selection.

This is an intentional geometry approximation: a complicated old cut can soften
when rebuilt, and a newly scooped fragment is rounder than its precise CSG
intersection. The large source shape is kept until its local history reaches
the budget. There is no camera-dependent simulation or change to world
resolution, and sand editing/settling still runs on the CPU.

`node tools/bench-sand-edits.mjs 400` compares the previous CPU reference with the
new live path after warming the common code. Each case makes 400 partial grabs
and places them in a small landing region; it also times 200 terrain queries
every 20 edits. A separate numerical soak runs actual dynamic settling.

| CPU editing benchmark | Previous | Live |
| --- | ---: | ---: |
| Mean edit | 20.31 ms | 5.17 ms |
| Mean edit, final 100 | 28.31 ms | 4.52 ms |
| Maximum cuts per portion after 400 edits | 230 | 12 |
| Total stored cuts after 400 edits | 26,795 | 367 |
| Remaining parcels | 231 | 111 |

Mean editing was 3.93× faster, late editing 6.26× faster, and sampled terrain
queries 1.82× faster. Packed shape storage was 98.03% smaller. Sand mass error
was below 5 × 10⁻¹⁴. These are CPU editing measurements, not whole-scene FPS,
realtime speed or RTX throughput measurements. Raw timings: `edit-soak.json`.

## Camera and validation

Outside first person, left or right dragging now orbits with a selected tool.
A short left click uses the tool. Wind keeps left-button painting and right-drag
orbit. Pointer-lock interaction in first person is unchanged.

The real OrbitControls input fixture verified eight camera updates with zero
tool actions during a drag, then one tool action on a click. Wind painting
increased the action count without moving the camera or leaving the wind stuck.
The fixture uses a 2D diagnostic drawing and creates no WebGL context.

74 relevant numerical tests passed, including 400 successive partial edits,
160 carving operations, 40 grab/drop/settling cycles, conserved material ledgers,
wet/dry layer separation, stationary held selections, moonlight controls and
input routing. `npm run build` passed. The isolated moon rendering was visually
inspected; no full-scene GPU stress or scene shader compilation was run on the
Mac for these checks.
