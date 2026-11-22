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
- Nineteen editable starter materials and three sample assets, including an animated two-part object.

The studio now includes a bounded CPU rigid-body/joint preview. Density, friction, restitution and joint retention affect it. In the world workspace, liquid ground supplies wind waves, displaced-volume buoyancy and drag. The asset editor uses a solid work plane. Freely flowing parts release mobile material when physics starts. Surface temperature, moisture, electrical potential and combustion evolve during physics playback. A hot skin weakens contacts and joints. Once a connected material region has absorbed enough energy to melt through its interior, it releases flowing material and any attachments it supported. Cold regions of the same sculpt remain physical.

### Melting a sculpt

In the material workbench, select **Beeswax** under **Placed object**. Choose **Heat material volume** and **Apply to selected part**. At the default intensity, this adds 400 kJ/kg throughout each connected region of the selected part. **Point at surface** targets just the region you click. Use **Heat pulse** to heat only the skin and watch conduction into the interior. The probe shows both temperatures, and the **Liquid fraction** overlay shows where the surface is melting.

Liquid starts inside the occupied collision geometry and inherits the motion of the material it came from. As parcels land and spread, the receiving cells carry their share of the remaining mass, enthalpy, moisture and fuel. Cold deposits flow more slowly and stop when fully solid. A saturated parcel pool defers release until space becomes available. Reset physics restores the authored sculpt. [Thermal and mass conservation tests](tests/studio-bulk-melt.test.js)

## Materials

A material definition supplies starting conditions and coefficients. Each placement has its own transient state. A custom material goes through the same calculations as a preset. The twelve additional presets are copper, aluminium, graphite, porcelain, cork, cotton felt, cellulose sponge, beeswax, ice, salt water, vegetable oil and pumice.

| Material controls | What changes during playback |
| --- | --- |
| Density, friction, restitution, liquidity and viscosity | Mass, buoyancy, resistance to sliding, rebound, fluid movement and whether a joint can hold. |
| Elastic modulus, Poisson ratio, yield stress, tensile strength, cohesion and adhesion | Elastic recovery, deformation, transfer of loads and fracture within and between materials. Local melting and fuel loss weaken connections. |
| Fracture grain and overload time | Negative grain favours flakes with a part-local Y normal. Zero gives irregular chips. Positive grain favours splinters along local X. Grain also biases the strength of connections across those directions. Overload time controls how rapidly damage accumulates under excess stress. |
| Starting temperature, heat capacity, thermal conductivity, emissivity and expansion | Initial temperature, heating per joule, heat flow across touching surfaces, radiative exchange with air and changes to both visible and collision dimensions. |
| Melting and boiling temperatures, latent heat of fusion and bulk water content | Energy goes into changing phase at the transition temperature. Heat conducts between the surface and interior. Fully melted sculpt regions become liquid parcels. Boiling transfers mass to the air, where the aqueous fraction contributes to humidity and the rest becomes a separate vapour. |
| Initial moisture, porosity, permeability and water affinity | Water storage and uptake, wicking at contacts, wet friction, evaporative cooling and resistance to ignition. Cold surfaces collect condensate from humid air. |
| Electrical conductivity | Potential and current through connected material regions. Damp surfaces can conduct better. Resistance dissipates electrical energy as heat. |
| Ignition temperature, fuel energy, burn rate and smoke yield | Hot fuel consumes local oxygen, heats the surface and the air, emits smoke, chars and weakens. Moisture inhibits burning. Wind carries smoke, heat and humidity. |
| Color, opacity, roughness, metalness, emission, refractive index, absorption and scattering | Surface appearance, directional highlights, reflection and transmission. Liquid ground uses depth-dependent absorption and in-scattering. |
| Fibre length, grain relief, elongation and spacing, organic load | Surface fibres and textured Gaussian grains. Organic load changes the tint and persistence/coverage of sea foam. |

Open **Material interactions** to probe an object or a spot on the ground. Attach a supply and a return to distinct points on a conducting path. Inspect the potential and local heating, then separate the contacts to open the circuit. Heat or wet a piece of cotton to compare how it burns. The material workbench at `/tests/studio-material-fields.html` opens an isolated, in-memory library.

The CPU updates connected surface samples and a sparse world-space atmosphere eight times per simulated second. Each connected sculpt material has two surface samples along its longest axis. Thick regions also have two interior reservoirs. The collider mass is divided between them, so the phase change consumes its latent heat once. Painted Gaussian details have individual samples connected to their roots. Ground uses up to 150 active surface tiles and air uses up to 384 one-cubic-metre cells. The outer boundary exchanges with ambient air. Melting is resolved region by region. A finer melt front within a homogeneous region, load-bearing solidification of a cooled pool and calibration against measurements are open work. Field overlays show sampled values, and the surface keeps its wet or charred finish during the run. Reset physics restores the authored starting state.

## Local ownership and repository path

The Vite development/preview server writes to `.local/asset-studio/library.json`, ignored by Git, with a previous-file backup and atomic replacement. The endpoint has one fixed path, requires same-origin JSON writes, validates the full document, and limits payload size. Browser autosave is an additional fallback using a dedicated versioned key; it never reads or overwrites beach/clay saves. Save operations serialize. Export/import provides a portable editable JSON library; import validates references, bounds, units and version before replacing the library, and replacement is undoable.

An exported, reviewed library can later be committed under `assets/library/` with stable asset/material IDs, source attribution, thumbnails and versioned migrations. Keep local working drafts out of ordinary pushes. Do not auto-publish user creations. Use **Export asset** to save one sculpt with its materials, part settings, joints and animation. **Add asset from file** merges it as an editable asset. If an existing material ID has different properties, the import keeps both definitions. **Place selected asset** adds a world placement.

## Rendering and bounded work

Composite, painted, translucent and fibrous surfaces use 3D covariance matrices, projected through the perspective Jacobian into screen-space Gaussian ellipses. A small depth prepass rejects hidden surfaces and a color pass blends nearby splats. Lighting uses nine real spherical-harmonic environment coefficients plus a direct light. Solid ground uses an analytic plane. Liquid ground uses a graded grid sampling a periodic wave spectrum; editor gizmos are conventional meshes. Rendering is WebGL 2 and capped at 60 FPS.

WebGPU compute evaluates the sculpt distance/material grid. Before automatic use, four fixtures (including cross-batch carry-over) compare all distances and material IDs against the independent CPU sampler. Batches contain at most 16 operations, use at most 140,000 grid vertices, submit sequentially, and have bounded completion timeouts. CPU surface extraction runs in a worker. A checkbox selects the CPU reference. Physics transforms are CPU-side and do not rebuild visual geometry. No beach physics shaders are imported.

This first editor deliberately limits a part to 512 stamps, 24,000 surface samples and 24 parts per asset. Larger bounds gradually increase sample spacing to stay within the bake budget; diagnostics report the actual spacing. A long-term authoring tool should bake old operations into editable sparse field bricks with an archival undo stream, instead of growing a per-frame CSG history. Do not lift limits without replacing that work first. Only the current workspace’s assets are baked and retained. The world preview is capped at 32 placed parts (including repeated instances); additional assets stay in the library. Larger collections need progressive loading/visibility management before lifting this bound.

## Next priorities

1. Validate daily sculpt/paint/keyframe workflow with the user's assets. Improve surface smoothing/coverage, small-feature resolution and selection as needed; add mirror/symmetry, pressure/strength and a smooth brush.
2. Collection export, thumbnails, categories/tags, provenance, file migration tests and repo promotion tooling. Keep browser and disk recovery transparent.
3. Refine the bounded collision proxies now used in the studio (exact primitives and greedy occupied boxes for CSG), then apply the same material definitions to the existing sandbox. Add collision visualization, smaller-feature error control and granular/wet material coupling. No replacement of working beach features without parity checks.
4. Sparse editable field bricks, incremental brush updates, demand-loaded library caches and GPU instance transforms. These should remove operation-history limits and lower save/undo memory while retaining the original editable definition.
5. Reusable force clips, optional inverse-dynamics authoring from pose guides, joint limits/breakage, quaternion rig editing, bones/skin weights and deformation cages. Preserve local pivots and covariance transforms under deformation.
6. Native wgpu studio integration and portable renderer, using the same authoring schema and controls. Existing beach performance work remains in DEVELOPMENT_BACKLOG.md and is paused at the user's request.
7. Resolve progressive melt fronts within one homogeneous region and solidification of load-bearing deposits. Extend spatial heat transport to ordinary scoops and grains. Calibrate material responses against measurements and profile larger connected circuits.

## Inspiration and reuse

The user confirmed permission to borrow the author's code from [Shapeshift Labs Ink Studio](https://github.com/siliconjungle/shapeshift-labs-ink-studio). Its editable SDF-to-Gaussian workflow, templates and named-part rig metadata informed this design. This first implementation does not copy its baked-palette lighting or replace Bardo's physics stack; the authoring/sampling code here is new.

Dreams informed the separate assembly/sculpt/paint workflows, stamp-versus-smear interaction and part animation. Primary references: [sculpt modes](https://docs.indreams.me/en-US/create/resources/videos/motion-controller-gestures/modes), [stamp and smear](https://docs.indreams.me/en/create/resources/videos/motion-controller-gestures/modes/toggle-stamp-and-smear), [flecks](https://docs.indreams.me/en/create/resources/edit-mode-guide/sculpt/flecks), and [assembly modes](https://docs.indreams.me/en/create/resources/edit-mode-guide/assembly/modes). This is a small authoring foundation, not a recreation of Dreams.

## Force-driven physics preview — November 16

`Play physics` starts a fresh simulation of the visible workspace. `Pause` retains its state; `Reset physics` returns to the saved arrangement. Authoring edits discard transient simulation state and never bake movement into saved transforms. **Studio test → Joint forces** opens an isolated two-part pendulum with an anchored support and a signed torque track. The beach remains separate.

- `Nudge`: drag on a part to apply force at that point. Direction is the drag in a camera-facing plane; distance multiplies the chosen N/m strength. Holding sustains force; a duration setting controls continuation after release. The force is not a cursor position constraint and does not chase the moving object. Off-centre loads create torque. Forces cap at 100,000 N; durations cap at five seconds, with at most 64 pending pulses.
- Ball, hinge, stretchable spring and fixed joints connect parts or the world. Anchors are authored in asset coordinates and transformed into each body's frame. Hinge axes respect authored rotations. Linked bodies suppress mutual contacts; other bodies collide normally. `Fixed` bodies are intentionally anchored.
- Angular looseness is a spring dead zone. Angular elasticity and damping define passive restoring torque around the authored rest orientation, reduced by material retention. The stretchable type adds a translational spring. Fixed joints ignore these free-axis settings.
- Force and torque tracks interpolate in parent-local axes and apply equal/opposite loads to the connected bodies. They never read a target pose or use a position motor. Contacts and nudges can permanently change the motion. Passive elasticity is separate from animation and may naturally return a displaced joint toward its rest orientation. Saved pose keys are retained, not silently converted into an unreliable inverse-dynamics approximation.
- Joint retention scales continuously with `(1 − liquidity)²`, elastic modulus and tensile/cohesive support. Effectively zero support disables the joint; freely flowing parts do not become rigid bodies. Existing joint definitions can remain dormant after material changes, but no active attachment is created. Loose material in playback is described below.

The isolated preview uses Rapier 0.21 CPU WebAssembly for contacts, constraints and CCD, at fixed 120 Hz, with at most 12 earned steps per displayed frame and no accumulated background catch-up. Rendering remains capped at 60 FPS. GPU sculpt sampling and its independent CPU reference are unchanged. Small rigid articulations do not add GPU workloads or new beach shaders.

Collision preparation runs in serial CPU workers with six-second timeouts, with the same direct CPU reference used by numerical tests. Collision geometry is independent of the camera and Gaussian bake spacing. Single boxes, spheres and capsules use exact shapes (scaled round shapes use bounded convex hulls when needed). General CSG is sampled into merged occupied boxes, at most 10,000 cells and 128 boxes per part, with a reported approximation spacing; openings wider than that spacing remain open, but small features and contact silhouettes can differ. A shear-producing nonuniform placement scale is explicitly rejected. Preview bodies remain capped at 32. Low-speed sleeping is disabled in this small force-testing world so tiny free-flight nudges do not disappear into a sleep threshold.

Validation: [numerical and visual evidence](tests/results/studio-joints-2026-11-16/report.md). Sources: [Rapier joints](https://rapier.rs/docs/user_guides/javascript/joints/), [forces and impulses](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/), and [colliders](https://rapier.rs/docs/user_guides/javascript/colliders/). This uses explicit forces rather than Rapier's target-position motors.

## Wind, surfaces and controls · November 20

In the world workspace, select a liquid ground material and adjust wind speed and heading. A 40 m periodic tile contains a deterministic directional spectrum. A 32 × 32 inverse FFT supplies two bracketing height fields at 20 Hz. The CPU samples the interpolated field for buoyancy. WebGL samples the same pair for displacement and smoothly filters distant slopes. Local ripples and up to 96 droplets handle impacts, splashing and dragging a handful of water. This surface model approximates deep water. [Ocean simulation course](https://jtessen.people.clemson.edu/reports/papers_files/waterslides2001.pdf)

Automatic rendering draws eligible opaque, single-stamp ellipsoids and boxes in batches sharing shape and material. Ellipsoids use direct ray intersection and boxes rasterize their exact faces. Both use the studio lighting. Fibre length adds normal-aligned Gaussian strands. Surface rendering can also be set to Gaussian explicitly, independently of roughness.

Joint breaking load is specified in newtons at full material retention. The preview estimates transmitted force and bending load from changes in momentum, external loads and normal contact impulses. Torque is converted to an equivalent force using the part's characteristic radius. Breakage releases the runtime joint. Reset restores its authored connection.

Left drag uses the selected tool. Drag a gizmo handle to transform, or click another object to select it. Right drag or the Camera tool orbits. Middle drag or Shift + right drag pans. The wheel zooms.

## Studio water and wind · November 21

The studio captures object colour and depth before shading the ocean. A half-resolution mirrored view supplies object reflections. Refraction traces the visible depth buffer within the bounds of authored geometry. The liquid material supplies colour, refractive index, roughness, opacity and absorption. Transmission falls with distance through the water, with a single-scattering approximation for light reaching the eye along that path. Detached water samples the shaded ocean behind it.

Nearby lift, impact and crest parcels contribute to a common Gaussian density surface. Their axes stretch with velocity while preserving ellipsoid volume. The surface field joins the wave tile across a narrow band. A crest launches its lip in stages. Impacts sample windward solid geometry, including fixed supports and carved openings. During editing this uses the authored distance field. During playback swept spray and obstacle probes use the rigid colliders. Bulk waves continue to use a periodic deep-water spectrum. The local parcels approximate overturning and spray, without a conservative three-dimensional bulk solver.

Wind ranges from 0 to 100 m/s. Air loads exposed parts at points on the body and can transmit torque or break a joint. Loose granular ground has a periodic mobile surface layer. Grain packets remove material at takeoff, travel under wind and gravity, and return their load at landing. Density, moisture, cohesion and adhesion affect entrainment. The later material update below supplies dune-shaped contacts. Water, rigid forces and grain transport run on the CPU. The GPU reconstructs the liquid surface, shades the optical paths and projects the airborne sand Gaussians.

## Breaking surf, loose material and surface grain

Breakers grow along a curved, tapering lip and spill at different times along its length. Local breaking supplies windblown spray, short-lived aeration and floating foam. Organic load increases foam formation and persistence. Clean water still breaks. These particles use projected three-dimensional Gaussian footprints with directional environment lighting.

Playback releases the loose portion of a sculpt from its carved volume. Loose grains and liquid parcels collide on the way down. A connected Gaussian-density surface follows them in flight. Settled material transfers by volume to a sparse world-space layer. Sand moves downhill until friction supports the slope, while liquid spreads into a thin pool. Wind removes grains from deposits and the ground and carries their volume to a new location. Finite liquid provides buoyancy, and a matching liquid dropped into the ocean joins its volume tally. The ocean spectrum continues to prescribe the height of the infinite water surface.

Material grain has editable depth, length and scale. Ground, implicit shapes, sculpted Gaussian surfaces and loose deposits share signed Gaussian relief. A reusable filtered atlas stores the Gaussian heights and derivatives. Their physical depth contributes to shading and surface parallax. Bronze ground uses a roughness-filtered scene reflection. Wood carries directional grain and sand uses finer, nearly isotropic relief. Dynamic simulation stays on the CPU. The GPU handles the water optics, drawing and material relief. [Material drop fixture](tests/studio-materials.html) · [Evidence and limits](tests/results/studio-materials-2026-11-21/report.md)


## Sculpt brushes and painted attachments

In the asset editor, drag the Gaussian brush from a point on a sculpt toward the desired tip, or click to grow along the local surface normal. Choose **Ellipsoid** for one Gaussian or **Curved ribbon** for a stroke with an editable width curve and taper. Both have length, width, curl, twist, material and hinge flexibility. Pick a stroke with **Edit detail** to change it. Mirror across local X or choose 2–32 radial copies around local Y. One gesture is one undo step.

**Assemble from library** inserts a whole asset, a named part, a sampled part, or an individual painted detail. **Add from file** makes a portable asset or family available as a source. In **Asset families**, group existing assets by name and assign relative selection weights. A family inserts a whole member or a painted detail from a member. Family export includes every member and its material dependencies. Insert at a pivot or click a sculpted surface. Surface placement supports free placement and the same four joint types as the physics editor. A painted detail mounts directly to the host. Copies keep internal joints and map animation keys to the destination timeline. Scene anchors are released when copying. An asset’s **Variation on reuse** travels in its file. Size and rotation can vary on world placements. Editable insertions can also vary the width and curl of each detail. Uniform and center-weighted distributions accept a reproducible seed that advances on each successful use. World placements reference their library asset, while copies inserted into another sculpt are independent.

Use **Studio test** to switch between the saved personal library and fresh test worlds for material interactions, water, ground materials, joint forces and example sculpts. Test changes last for that visit. Export an asset to take it back to the library. All six material workbench samples are free bodies. The copper and graphite initially touch, and a nudge can physically open their circuit.

Each attachment stores its root and rest frame in the sculpted part’s coordinates. The renderer projects the covariance of each lobe and shades the batch with the studio’s spherical-harmonic environment. During playback, fixed-step CPU spring hinges respond to wind, gravity, part motion and cursor forces. A hinge follows the fragment supporting its root after fracture. Contacts use the host’s collision geometry. Carving away a root hides its detail until support returns. Each part can hold 128 attachments. They travel with the sculpt and their materials in exported assets. [Brush and physics tests](tests/studio-gaussian-brush.test.js) · [Flower in the editor](tests/results/studio-gaussian-brush-2026-11-21/flower.jpg)
