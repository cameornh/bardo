# Asset and material studio

Status: first isolated authoring test, 2026-11-16. URL: `/?scene=asset-studio` (also `/tests/asset-studio.html` during development). This is independent of the beach and historical snapshots. The current native host still launches the beach; native studio hosting is a follow-up. Shared browser features are identical on both branches.

## Authoring contract

One versioned editable definition owns each asset. It contains named parts, local pivots, ordered additive/subtractive/paint operations, material references and animation keys. World placements reference that definition and have independent transforms. Duplicating an asset makes it independent; editing a shared definition updates every placement.

The Gaussian surface is a disposable rendering cache, not the save format. Future collision meshes, distance fields, thumbnails and distant representations should be derived from the same definition. Keep collision and physical state independent of camera position or visual detail. Never save transient lighting into the editable base color.

This first version includes:

- Sphere/ellipsoid, box and capsule stamps; smooth union/subtraction; continuous mouse strokes; material painting on the selected part.
- Named parts, local pivots and move/rotate/scale gizmos plus numeric entry.
- Per-part position, rotation and scale keys, eased interpolation, shortest-axis Euler rotations, timeline scrubbing and looping playback. These are rigid part transforms; there is no skinning, IK or simulated soft-body animation yet.
- Asset and material duplication, shared library placement, undo/redo and an unbounded ground material preview. The ground follows the camera's covered region without changing its world-space coordinates or material. There are no beach boundary walls.
- Seven editable starter materials and three sample assets, including an animated two-part object.

The ground and placed liquid/granular/gas materials are **appearance previews**, not a general material simulator. There is no physics speed claim for this editor. The physical property schema is ready for coupling, but fire, phase changes, fluids and mechanical deformation are not implemented here.

## Materials

All parameters are continuous numeric properties, not hardcoded dry/wet behavior levels. Phase describes a material's initial state, not a new behavior branch. Color, roughness, metalness, opacity and emission affect this preview. Opacity is a Gaussian surface approximation; it is not full refractive glass or water optics.

Stored physical properties have explicit SI units where applicable:

| Area | Properties |
| --- | --- |
| Mechanics | Density; friction; restitution; elastic modulus; Poisson ratio; yield and tensile strength; cohesion; adhesion; dynamic viscosity |
| Thermal | Specific heat; thermal conductivity; emissivity; expansion; melting and boiling temperatures; latent heat of fusion |
| Combustion | Ignition temperature; fuel energy (zero means inert); burn rate; smoke yield |
| Electrical | Electrical conductivity |
| Moisture | Initial water mass fraction; porosity; permeability; water affinity |
| Optics | Refractive index; bulk absorption |

Later: distinguish bulk material definitions from per-parcel temperature, moisture, damage and phase state. Add property curves versus temperature/moisture with unit-aware interpolation. Preserve dried sand's residual adhesion and shape history. Introduce thermal/electrical transport, combustion and elastic/yield response only with numerical fixtures and explicit conservation budgets. Avoid suggesting that setting ignition temperature already enables fire.

## Local ownership and repository path

The Vite development/preview server writes to `.local/asset-studio/library.json`, ignored by Git, with a previous-file backup and atomic replacement. The endpoint has one fixed path, requires same-origin JSON writes, validates the full document, and limits payload size. Browser autosave is an additional fallback using a dedicated versioned key; it never reads or overwrites beach/clay saves. Save operations serialize. Export/import provides a portable editable JSON library; import validates references, bounds, units and version before replacing the library, and replacement is undoable.

An exported, reviewed library can later be committed under `assets/library/` with stable asset/material IDs, source attribution, thumbnails and versioned migrations. Keep local working drafts out of ordinary pushes. Do not auto-publish user creations. Future selective export should collect material dependencies, animation clips and collision settings for one asset or collection.

## Rendering and bounded work

Assets use tangent-oriented 3D covariance matrices, projected through the perspective Jacobian into screen-space Gaussian ellipses. A small depth prepass rejects hidden surfaces and a color pass blends nearby splats. Lighting uses nine real spherical-harmonic environment coefficients plus a direct light. The infinite ground preview is an analytic plane; editor gizmos are conventional meshes. Rendering is WebGL 2 and capped at 60 FPS.

WebGPU compute evaluates the sculpt distance/material grid. Before automatic use, four fixtures (including cross-batch carry-over) compare all distances and material IDs against the independent CPU sampler. Batches contain at most 16 operations, use at most 140,000 grid vertices, submit sequentially, and have bounded completion timeouts. CPU surface extraction runs in a worker. A checkbox selects the CPU reference. Animation transforms are CPU-side and do not rebuild geometry. No beach physics shaders are imported.

This first editor deliberately limits a part to 512 stamps, 24,000 surface samples and 24 parts per asset. Larger bounds gradually increase sample spacing to stay within the bake budget; diagnostics report the actual spacing. A long-term authoring tool should bake old operations into editable sparse field bricks with an archival undo stream, instead of growing a per-frame CSG history. Do not lift limits without replacing that work first. Only the current workspace’s assets are baked and retained. The world preview is capped at 32 placed parts (including repeated instances); additional assets stay in the library. Larger collections need progressive loading/visibility management before lifting this bound.

## Next priorities

1. Validate daily sculpt/paint/keyframe workflow with the user's assets. Improve surface smoothing/coverage, small-feature resolution and selection as needed; add mirror/symmetry, pressure/strength and a smooth brush.
2. Selective asset export/import, thumbnails, categories/tags, provenance, migration tests and repo promotion tooling. Keep browser and disk recovery transparent.
3. Derive cached collision meshes/SDF bricks from authored shapes and apply the same material definitions to the existing sandbox. Start with static rigid assets and contact tests, then granular/wet material coupling. No replacement of working beach features without parity checks.
4. Sparse editable field bricks, incremental brush updates, demand-loaded library caches and GPU instance transforms. These should remove operation-history limits and lower save/undo memory while retaining the original editable definition.
5. Part hierarchy, reusable animation clips, quaternion rotations, bones/skin weights and deformation cages. Preserve local pivots and covariance transforms under deformation.
6. Native wgpu studio integration and portable renderer, using the same authoring schema and controls. Existing beach performance work remains in DEVELOPMENT_BACKLOG.md and is paused at the user's request.
7. Physically meaningful temperature/moisture-dependent property curves; elasticity, fracture, combustion, conduction and phase changes. Each needs its own conservation and stability tests, not only extra sliders.

## Inspiration and reuse

The user confirmed permission to borrow the author's code from [Shapeshift Labs Ink Studio](https://github.com/siliconjungle/shapeshift-labs-ink-studio). Its editable SDF-to-Gaussian workflow, templates and named-part rig metadata informed this design. This first implementation does not copy its baked-palette lighting or replace Bardo's physics stack; the authoring/sampling code here is new.

Dreams informed the separate assembly/sculpt/paint workflows, stamp-versus-smear interaction and part animation. Primary references: [sculpt modes](https://docs.indreams.me/en-US/create/resources/videos/motion-controller-gestures/modes), [stamp and smear](https://docs.indreams.me/en/create/resources/videos/motion-controller-gestures/modes/toggle-stamp-and-smear), [flecks](https://docs.indreams.me/en/create/resources/edit-mode-guide/sculpt/flecks), and [assembly modes](https://docs.indreams.me/en/create/resources/edit-mode-guide/assembly/modes). This is a small authoring foundation, not a recreation of Dreams.
