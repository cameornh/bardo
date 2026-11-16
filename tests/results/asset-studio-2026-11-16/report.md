# Asset / material studio — 2026-11-16

Implemented as a new isolated browser scene: `/?scene=asset-studio`. It does not import the beach simulation. The native host remains unchanged.

## Validation

- **21 numerical/integration tests pass**, including analytic primitive/CSG boundaries, paint material IDs, surface normals and error, bounded grids, keyframe interpolation/recording, schema/reference validation, undo/redo, namespace isolation, local disk backup/atomic replacement, browser quota fallback and editing while the compute backend initializes.
- `npm run build` and `npm run build:native` pass. The browser build retains the existing large-bundle advisory.
- The real WebGPU sampler matched the CPU reference on **3,121 grid points across four fixtures**, including a 19-operation fixture crossing the 16-stamp dispatch boundary: maximum distance difference **2.384185791015625e-7 m**, zero material-ID mismatches. See `gpu-validation.json`.
- A later preview startup timed out while requesting a GPU device. It fell back to CPU sampling and remained editable/rendering; no graphics-context loss or shader error was observed. This availability failure is retained in `startup-fallback.json`, not described as a passing GPU startup. A startup race found while editing before validation completed was repaired; only a fully validated device is published to baking jobs. Late device creation after cancellation is disposed. There is no automatic retry loop.

## Browser workflow exercised

- Added and carved clay, painted bronze, and created a new sculpt from an empty part with a continuous stroke.
- Edited a named stem part's rotation from 22° to 35°, recorded the 1.5 s key, scrubbed to 0 s and back, and played its animation. The exported JSON independently contained the 35° key.
- Disabled GPU sampling and rebuilt through the CPU worker reference.
- Placed an arch, dragged its move handle (X changed to 1.482 m), undid the move, and removed the extra placement.
- Duplicated bronze, renamed it Brushed bronze, changed roughness to .5, and applied it to the whole ground; also previewed water and sand ground materials.
- Exported a library, validated the downloaded file, imported a fresh starter library, saved and reloaded local files. The prior edited export remains a local file, not an uploaded asset.
- Inspected rendering at the preview's wide and narrow sizes; added a working Show/Hide controls button for the narrower view. No errors/warnings were captured in the finished preview's console.

## Limits and interpretation

This is a first authoring tool, not a full sandbox material simulation. Mechanical, thermal, electrical, moisture and combustion properties are editable saved data. Opacity is an approximate Gaussian surface blend; it does not provide the beach's glass/water refraction. Animation is rigid part transforms, not skinning or IK. Ground/gizmos use conventional geometry; authored surfaces use projected 3D Gaussian covariance and SH environment lighting.

There is no performance improvement claim. Informal HUD readings varied from about 17–46 FPS across different viewport sizes, scene details and development conditions; they are not a controlled benchmark. No physics runs in this test. Rendering is capped at 60 FPS, and compute is bounded/serialized. Surface resolution, stamp and placed-part caps are documented in `ASSET_STUDIO_PLAN.md`. Long sessions, maximum library sizes, native studio integration and Windows/RTX authoring remain untested.

Local drafts stay under `.local/asset-studio/`, excluded from Git. Portable exports are the first step toward reviewed repository asset bundles. Beach/clay storage and historical scene implementations were not modified.
