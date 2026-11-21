# Asset studio material playback

The material fixture starts with sand, water and wood blocks suspended beside a fixed stone arch. It uses an in-memory library. Press **Play physics** to watch them fall. The same fixture can start on [bronze](../../studio-materials.html), [wood](../../studio-materials.html?ground=wood), [sand in 32 m/s wind](../../studio-materials.html?ground=sand) or [water in 18 m/s wind](../../studio-materials.html?ground=water). The water fixture sets organic load to 0.72.

The local preview showed the sand block sliding into a pile, water spreading into a puddle, bronze reflecting the arch and wood block, and aligned wood grain on the floor and block. With sustained wind, the sand developed smooth ridges. Breaking water shed short-lived whitewater and finer spray around the floating block. [Bronze](bronze.jpg) · [Wood](wood.jpg) · [Sand](sand.jpg) · [Surf](surf.jpg).

## Dense studio playback

The full 640 × 360 studio comparison used 24 floating wooden objects, 8 m/s wind, six warm-up frames and 72 completed frames per block. The order was Gaussian, automatic, automatic, Gaussian. The Gaussian-only mode submitted 56,832 surface samples per asset pass. Each frame completed on the GPU before it was counted. [Run the comparison](../../studio-surface-cost.html?dense=1).

| Surface mode | FPS | Simulation / wall time | Mean completed frame |
| --- | ---: | ---: | ---: |
| Gaussian | 8.47 | 0.760× | 110.55 ms |
| Automatic | 19.26 | 0.938× | 47.26 ms |
| Automatic | 20.57 | 0.950× | 43.97 ms |
| Gaussian | 11.02 | 0.917× | 84.75 ms |

The earlier automatic runs reached 17.01–17.54 FPS and 0.978–0.981× realtime. The previous Gaussian-only runs reached 11.93–12.26 FPS and 0.900–0.955×. These are separate sessions. Automatic rendering presented more frames in this run, though simulation throughput was lower. Forced Gaussian rendering remains expensive across several optical views. The dense studio run finished with its graphics context intact. [Earlier results](../studio-water-wind-2026-11-21/report.md).

The separate beach regression stopped during atmosphere shader compilation at the existing 15-second deadline. It produced zero measured blocks and no new beach performance result. The source changes are confined to the studio. [Beach fixture](../../scene-performance.html?cycles=1).

## Checks and scope

All 74 focused studio and adaptive-detail tests passed, as did the production web build. Checks include conservation of transferred volume, a wider footprint for liquid than sand, motion of submerged loose material at different densities, wind entrainment and redeposition, smooth dune growth under sustained wind, varied crest emission, and zero persistent foam at zero organic load.

The 480 × 300 GPU optics regression passed for reflection, transmission, refraction, scattering and a connected lifted handful. The five comparisons changed 1,519, 1,748, 4,386, 3,111 and 236 pixels respectively. The handful used one bounding box. The graphics context remained intact. [Optics check](../../studio-water-optics.html).

Dune transport runs on a repeating 12 m tile. Finite deposits keep world coordinates and transfer volume among 20 cm cells, with a maximum of 6,144 occupied cells per material. Material arriving at capacity stays in its existing representation. A single deposit surface per material cannot resolve stacked shelves or narrow channels below the cell spacing. The ocean uses a prescribed spectrum with local curved breaking lips and a budget of 384 secondary particles. It records the volume of matching liquid that joins it. Physical simulation runs on the CPU, while projected particles, material microrelief, wave displacement and optical shading draw on the GPU.
