# RTX GPU test branch

Branch: `codex/rtx-5070-ti-gpu`. Intended for the separate RTX 5070 Ti computer.
The `main` branch and its existing local server retain the CPU-pressure recovery.

## Run on the test computer

In an existing checkout:

```sh
git fetch origin
git switch --track origin/codex/rtx-5070-ti-gpu
npm ci
npm run dev
```

Open `http://localhost:5173/?scene=sand-lab&paused=1`. The experiment validates
GPU pressure against CPU results on three 175-sample fixtures, then enables the
full GPU path if they pass. Click Resume to run the scene. The default root URL
also opens this experiment. Diagnostics show the browser's actual adapter,
selected backend and numerical validation results; confirm that the reported
adapter is the intended NVIDIA card. The browser must have graphics acceleration
enabled and expose WebGL 2 floating-point render targets
([Khronos specification](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/)).
This uses WebGL fragment-shader compute; it does not use CUDA or WebGPU.

For a small check before opening the scene, visit
`http://localhost:5173/tests/rtx-gpu.html` and click **Run GPU checks**. That page
does not create a graphics context until clicked. It compares free water,
held samples, beach/boulder/cup/player contacts, and edited sand with the CPU
reference. Each fixture reports its maximum error and tolerance.

## Enabled work

- GPU water density constraints and collision projection, including objects and
  edited sand. The live CPU restriction is bypassed only by this experiment.
- GPU water transport/chemistry, packed neighbor reads, boundary reuse, batched
  result readback, and spray-emission exposure/contact queries.
- Existing GPU air field, fine spray/bubbles/mist motion, airborne sand grains,
  sea-foam transport, rain object-contact map, water reconstruction, medium
  lighting, atmosphere and exposure, plus the existing renderer.
- Shader specialization and object-program precompilation.
- All existing compatible optimization checkboxes start enabled. Display is
  capped at 60 FPS instead of 15; physics timestep and requested realtime rate
  are unchanged. Physics receives a 12 ms inter-step budget, with at least one
  due step allowed, to avoid consuming an entire display frame on catch-up.

Sand stock/adhesion, rigid bodies, player, rain mass, condensation bookkeeping,
tides and neighbor construction still run on the CPU. Their existing compiled
and spatial-cache optimizations remain enabled. This change does not introduce
new GPU implementations for those systems.

## Alternative backends

The Diagnostics backend control selects one pressure solver at a time:

| Setting | Behavior |
| --- | --- |
| Full GPU pressure / contacts | Default; the original GPU constraint shader also evaluates objects and edited sand. Small CPU comparison must pass first. |
| Split GPU pressure | Alternative bounded experiment. Separate pressure and simple-contact shaders; no CPU-versus-GPU speed gate. Requires its own numeric checks. Edited/complex geometry or workloads beyond its supported bounds retain the CPU fallback. |
| CPU pressure / GPU transport | Compiled CPU constraints while keeping the other GPU paths. |
| CPU reference | CPU simulation references where available; scene drawing still uses the GPU. |

The split solver and full solver are alternatives, as are batched and legacy
asynchronous stepping. They are not stacked. To bypass GPU pressure checks at
startup, append `&backend=safe` or `&backend=cpu`. The unchanged original safe
entry is `/?scene=sand-lab&profile=safe&paused=1`.

Validation failures retain CPU pressure and report the reason. Context/shader
failures stop further submissions; they are not retried automatically. A small
numerical pass establishes arithmetic agreement, not full-scene driver safety
or a performance guarantee. The historical Mac graphics failure is why this
branch was prepared separately and not launched on that machine.

## Validation status

All 71 targeted CPU routing/reference regression checks passed, and `npm run
build` passed. The check page was visually inspected without submitting graphics
work. Actual GPU arithmetic, stability and throughput on the RTX 5070 Ti must
be measured on that computer; no RTX measurements are claimed here. The existing
QA controls include matched beach benchmarks and the active backend diagnostics.
