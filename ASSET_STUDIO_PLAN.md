# Asset and material studio

Status: first isolated authoring test, 2026-11-16. URL: `/?scene=asset-studio` (also `/tests/asset-studio.html` during development). This is independent of the beach and historical snapshots. The current native host still launches the beach; native studio hosting is a follow-up. Shared browser features are identical on both branches.

## Authoring contract

One versioned editable definition owns each asset. It contains named parts, local pivots, ordered additive/subtractive/paint operations, material references and animation keys. World placements reference that definition and have independent transforms. Duplicating an asset makes it independent; editing a shared definition updates every placement.

The Gaussian surface is a disposable rendering cache, not the save format. Future collision meshes, distance fields, thumbnails and distant representations should be derived from the same definition. Keep collision and physical state independent of camera position or visual detail. Never save transient lighting into the editable base color.

This first version includes:

- Sphere/ellipsoid, box and capsule stamps; smooth union/subtraction; continuous mouse strokes; material painting on the selected part.
- Named parts, local pivots and move/rotate/scale gizmos plus numeric entry.
- Authored rest transforms and pivots plus looping force/torque keys applied to physical joints. Older position/rotation/scale keys remain saved as pose guides; they no longer drive playback. There is no skinning, IK or soft-body animation yet.
- Asset and material duplication, shared library placement, undo/redo and an unbounded ground material preview. The ground follows the camera's covered region without changing its world-space coordinates or material. There are no beach boundary walls.
- Seven editable starter materials and three sample assets, including an animated two-part object.

The studio now includes a bounded CPU rigid-body/joint preview. Density, friction, restitution and joint retention affect it. The ground always remains a solid support plane even when its selected material is water. Freely flowing parts remain visual previews without rigid contacts or joints. Fire, phase changes, fluids and soft-body deformation are not implemented here.

## Materials

All parameters are continuous numeric properties, not hardcoded dry/wet behavior levels. Phase presets initialize liquidity; the numeric liquidity and strength properties control joint retention continuously. Color, roughness, metalness, opacity and emission affect this preview. Opacity is a Gaussian surface approximation; it is not full refractive glass or water optics.

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

WebGPU compute evaluates the sculpt distance/material grid. Before automatic use, four fixtures (including cross-batch carry-over) compare all distances and material IDs against the independent CPU sampler. Batches contain at most 16 operations, use at most 140,000 grid vertices, submit sequentially, and have bounded completion timeouts. CPU surface extraction runs in a worker. A checkbox selects the CPU reference. Physics transforms are CPU-side and do not rebuild visual geometry. No beach physics shaders are imported.

This first editor deliberately limits a part to 512 stamps, 24,000 surface samples and 24 parts per asset. Larger bounds gradually increase sample spacing to stay within the bake budget; diagnostics report the actual spacing. A long-term authoring tool should bake old operations into editable sparse field bricks with an archival undo stream, instead of growing a per-frame CSG history. Do not lift limits without replacing that work first. Only the current workspace’s assets are baked and retained. The world preview is capped at 32 placed parts (including repeated instances); additional assets stay in the library. Larger collections need progressive loading/visibility management before lifting this bound.

## Next priorities

1. Validate daily sculpt/paint/keyframe workflow with the user's assets. Improve surface smoothing/coverage, small-feature resolution and selection as needed; add mirror/symmetry, pressure/strength and a smooth brush.
2. Selective asset export/import, thumbnails, categories/tags, provenance, migration tests and repo promotion tooling. Keep browser and disk recovery transparent.
3. Refine the bounded collision proxies now used in the studio (exact primitives and greedy occupied boxes for CSG), then apply the same material definitions to the existing sandbox. Add collision visualization, smaller-feature error control and granular/wet material coupling. No replacement of working beach features without parity checks.
4. Sparse editable field bricks, incremental brush updates, demand-loaded library caches and GPU instance transforms. These should remove operation-history limits and lower save/undo memory while retaining the original editable definition.
5. Reusable force clips, optional inverse-dynamics authoring from pose guides, joint limits/breakage, quaternion rig editing, bones/skin weights and deformation cages. Preserve local pivots and covariance transforms under deformation.
6. Native wgpu studio integration and portable renderer, using the same authoring schema and controls. Existing beach performance work remains in DEVELOPMENT_BACKLOG.md and is paused at the user's request.
7. Physically meaningful temperature/moisture-dependent property curves; elasticity, fracture, combustion, conduction and phase changes. Each needs its own conservation and stability tests, not only extra sliders.

## Inspiration and reuse

The user confirmed permission to borrow the author's code from [Shapeshift Labs Ink Studio](https://github.com/siliconjungle/shapeshift-labs-ink-studio). Its editable SDF-to-Gaussian workflow, templates and named-part rig metadata informed this design. This first implementation does not copy its baked-palette lighting or replace Bardo's physics stack; the authoring/sampling code here is new.

Dreams informed the separate assembly/sculpt/paint workflows, stamp-versus-smear interaction and part animation. Primary references: [sculpt modes](https://docs.indreams.me/en-US/create/resources/videos/motion-controller-gestures/modes), [stamp and smear](https://docs.indreams.me/en/create/resources/videos/motion-controller-gestures/modes/toggle-stamp-and-smear), [flecks](https://docs.indreams.me/en/create/resources/edit-mode-guide/sculpt/flecks), and [assembly modes](https://docs.indreams.me/en/create/resources/edit-mode-guide/assembly/modes). This is a small authoring foundation, not a recreation of Dreams.

## Force-driven physics preview — November 16

`Play physics` starts a fresh simulation of the visible workspace. `Pause` retains its state; `Reset physics` returns to the saved arrangement. Authoring edits discard transient simulation state and never bake movement into saved transforms. `Add joint test` creates a two-part pendulum with an anchored support and a signed torque track. The beach remains separate.

- `Nudge`: drag on a part to apply force at that point. Direction is the drag in a camera-facing plane; distance multiplies the chosen N/m strength. Holding sustains force; a duration setting controls continuation after release. The force is not a cursor position constraint and does not chase the moving object. Off-centre loads create torque. Forces cap at 100,000 N; durations cap at five seconds, with at most 64 pending pulses.
- Ball, hinge, stretchable spring and fixed joints connect parts or the world. Anchors are authored in asset coordinates and transformed into each body's frame. Hinge axes respect authored rotations. Linked bodies suppress mutual contacts; other bodies collide normally. `Fixed` bodies are intentionally anchored.
- Angular looseness is a spring dead zone. Angular elasticity and damping define passive restoring torque around the authored rest orientation, reduced by material retention. The stretchable type adds a translational spring. Fixed joints ignore these free-axis settings.
- Force and torque tracks interpolate in parent-local axes and apply equal/opposite loads to the connected bodies. They never read a target pose or use a position motor. Contacts and nudges can permanently change the motion. Passive elasticity is separate from animation and may naturally return a displaced joint toward its rest orientation. Saved pose keys are retained, not silently converted into an unreliable inverse-dynamics approximation.
- Joint retention scales continuously with `(1 − liquidity)²`, elastic modulus and tensile/cohesive support. Effectively zero support disables the joint; freely flowing parts do not become rigid bodies. Existing joint definitions can remain dormant after material changes, but no active attachment is created. No liquid or granular simulation is implied.

The isolated preview uses Rapier 0.21 CPU WebAssembly for contacts, constraints and CCD, at fixed 120 Hz, with at most 12 earned steps per displayed frame and no accumulated background catch-up. Rendering remains capped at 60 FPS. GPU sculpt sampling and its independent CPU reference are unchanged. Small rigid articulations do not add GPU workloads or new beach shaders.

Collision preparation runs in serial CPU workers with six-second timeouts, with the same direct CPU reference used by numerical tests. Collision geometry is independent of the camera and Gaussian bake spacing. Single boxes, spheres and capsules use exact shapes (scaled round shapes use bounded convex hulls when needed). General CSG is sampled into merged occupied boxes, at most 10,000 cells and 128 boxes per part, with a reported approximation spacing; openings wider than that spacing remain open, but small features and contact silhouettes can differ. A shear-producing nonuniform placement scale is explicitly rejected. Preview bodies remain capped at 32. Low-speed sleeping is disabled in this small force-testing world so tiny free-flight nudges do not disappear into a sleep threshold.

Validation: [numerical and visual evidence](tests/results/studio-joints-2026-11-16/report.md). Sources: [Rapier joints](https://rapier.rs/docs/user_guides/javascript/joints/), [forces and impulses](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/), and [colliders](https://rapier.rs/docs/user_guides/javascript/colliders/). This uses explicit forces rather than Rapier's target-position motors.
