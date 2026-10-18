# Bardo engine experiments

Local SDF/Gaussian sandbox experiments. The interface is a viewport and collapsible functional controls. Test 01 contains material objects and clay carving; test 02 adds streamed, editable terrain and a physics probe; test 03 fills that terrain with interactive Gaussian grass; test 04 adds a bounded water solver in a carved basin; test 05 compares gravel, sand, and a cohesive mud proxy; test 06 compares fur and hair; test 07 compares deformable fabrics; test 08 compares subsurface transport and transparent materials; test 09 traces refraction, reflection, and photon caustics through nested glass/water/air volumes; test 10 combines a traversable beach, shared water/sand materials, wind, wet sand, Gaussian grass, and floating glass shells. The browser is a development harness, not a commitment to a browser-based final engine.

## Run

Run **npm install**, then **npm run dev**. Open the local Vite URL. A desktop browser with accelerated WebGL 2 and floating-point render targets is required. **npm test** runs numerical and streaming checks; **npm run build** builds the harness. No account or backend is involved. Earlier mesh_to_splats.py, synthetic_splats.json, and test_cube.obj files remain untouched and are not runtime inputs.

## Gaussian renderer and motion detail

The old renderer used Gaussian-weighted attributes but reconstructed an opaque surface through a hard depth prepass. It did not contain spherical harmonics. That path has been replaced.

Each solid/terrain primitive stores a 3D center, a full symmetric positive-definite covariance, optical density, a normal/material reference, and **degree-3 RGB spherical harmonics: 16 coefficients per channel**. The perspective Jacobian projects the covariance into an elliptical Gaussian. Gaussian density is exp(−q/2), and opacity is 1 − exp(−density × optical depth). Premultiplied color is blended back to front. This optical-depth formulation allows parent/child density interpolation without a sudden opacity switch. It differs from the original 3DGS formula that multiplies a bounded opacity directly by the Gaussian.

The screen footprint extends until its opacity is negligible, including for dense merged parents. It is not an opaque ellipse. A pixel reconstruction filter broadens subpixel covariance with determinant compensation to preserve integrated density. No motion-blur shader, screen smear, frame accumulation, or blur overlay is used.

SH coefficients are projected from a procedural environment response and material properties. They are **real directional radiance coefficients, not photo-trained coefficients**. Moving direct lights remain a separate GGX/diffuse term, with field shadows evaluated per Gaussian. Degree 0 removes directional SH terms for comparison. SH is a compact angular color representation; it does not itself implement refraction, diffraction, pressure, or subsurface transport. The moving probe carries its fitted environment response with its rotation; fully relightable dynamic SH remains future work.

Glass keeps an approximate two-interface Snell/Beer model and rough transmission. This shading is calculated once per covered pixel in a cache, then sampled by overlapping Gaussians. Repeating secondary rays for every overlapping kernel was prohibitively expensive. Wax backlighting and wool sheen remain appearance approximations.

### LOD policy

- Camera translation and rotation produce an estimated screen-motion speed in render-target pixels per second. A first-order projection at the camera's focus distance is a proxy, not per-pixel optical flow.
- Motion raises the target Gaussian footprint linearly with estimated screen speed: multiplier = 1 + speed / 160, with speed measured in render pixels/second. Thus 160, 320, and 640 px/s target 2×, 3×, and 5× coarsening. The onset uses a small fast shoulder (15% of the response), followed by a broader ramp for the remaining 85%. For a step to 640 px/s, coarsening reaches 90% in about 0.70 s instead of 0.19 s, with about 31% lower peak slope in the 240 Hz regression. The initial response starts earlier and recovery remains continuous; there is no dwell timer. Refinement does not change physics.
- Each object/chunk owns a stable Gaussian hierarchy. Parents merge optical mass, position means, and covariance second moments. Normal groups avoid merging opposite-facing surfaces. Parent/child density blends continuously between adjacent levels.
- Projected size includes distance, focal length, and render resolution. A small distant object therefore uses fewer, broader Gaussians; the wax test hierarchy goes from 1,850 leaf Gaussians to 24 coarse Gaussians.
- The base pixel sigma is a hierarchy-selection target, not an instruction to enlarge every individual splat to a fixed minimum diameter. Flat terrain receives lower detail priority than curved objects; edited terrain gets intermediate priority.
- A global active-splat budget counts both levels during transitions. It raises the footprint target until the conservative visible count fits. It does not randomly discard individual splats. Conservative accounting can leave some budget unused.
- Terrain chunks retain the same 0.5 m base sampling grid throughout their residency. Moving across a distance ring no longer replaces an entire sampling grid. Drawing changes hierarchy level each frame instead.

For comparison, choose **01 · Materials / carving**, select Wax, and enable **Repeatable orbit test**. Watch Camera motion, Motion coarsening, Selected material splats, and the bottom count. Disable **Coarsen during camera motion** to isolate screen-size LOD. Adjust **Base Gaussian sigma**, **Surface splat budget**, or **SH degree**. All of these controls affect rendering.

### Visibility limitations

Objects use center-depth sorting, which is an approximation for intersecting or very large Gaussians. Solid ground is rendered as a separate Gaussian support layer with depth, so a broad ground footprint cannot paint the floor through a foreground object. Gaussian object colors remain alpha-composited rather than writing opaque splat disks. This is an SDF/material-aware hybrid, not an exact reproduction of the original 3DGS rasterizer.

Edited splat support is constrained against the field along the viewing ray. Extra samples preserve both faces of cut rims. Coarse levels can still soften silhouettes, lose tiny cuts, expose residual cut-edge artifacts, or show sorting changes. These merged levels have not undergone the image-based optimization used by trained hierarchical 3DGS. Detailed chunk arrival remains asynchronous; coarse proxies now cover loading and distant chunks, with a 0.45 s optical-density handover.

## Tests 06–07: fabric, fur, and hair

Choose **07 · Fabrics**. Four swatches, left to right, compare silk-like cloth (blue), canvas (tan), knit (red), and leather-like material (brown). They are test presets, not measured material fits. Each has a 14 × 18 cell lattice, 285 physical nodes, two fixed upper corners, and slightly gathered clamps. Gravity and a small constant air load produce the drape; there is no animation path. The four cloths total 1,140 physical nodes and 1,008 finest-level surface Gaussians.

Use **Gust all** for the same applied pressure across the materials; **Ball at swatch (R)** for contact; **Pull hem / Release hem** for a controlled extension/recoil test; and **Release pins** to drop a sheet. **Inspect selected** brings the camera close, while **Reset camera** returns to the comparison. **Reset all** rebuilds the scene with the currently edited parameters; **Restore preset** resets the selected material's parameters and physical state. Pause applies to all simulation; camera and lighting remain usable.

- **Stretch resistance** controls distance-constraint compliance; **Bend resistance** independently controls second-difference bending constraints. Both sliders use a logarithmic compliance mapping.
- **Damping** changes energy loss: low values retain more oscillation, high values settle faster. Springiness comes from stiffness, mass, and damping together.
- **Areal density** sets nodal mass. **Weave anisotropy** changes the relative horizontal and vertical stretch compliance, with separate diagonal shear constraints.
- **Tear strain** is the tensile strain threshold. Enable **Allow strain tearing**, then pull the hem. The grip starts at the currently deformed hem and remains above the floor. Fracture is evaluated after constraint relaxation, so grabbing the cloth does not itself create a rest-position snap and false tear. Broken lattice links also disable crossing bend constraints; cells with a broken perimeter edge disappear. **Show strain** colors current tensile strain from blue toward red. Tearing is disabled by default.

The common CPU solver uses XPBD compliance and accumulated constraint multipliers. It advances at 60 Hz with three 1/180 s substeps, three constraint iterations per substep, gravity, and exponential velocity damping. Sphere contact divides positional correction by mass and returns a linear impulse to the 1.5 kg probe; its rigid-body integrator remains at 120 Hz. Physical state is independent of camera motion and render LOD. Fixed anchors and fixtures absorb external reaction. The floor is a flat plane in these tests, so terrain carving is disabled here; saved terrain/clay edits remain in their original scenes.

The bending model is a discrete vector second-difference approximation, not a calibrated shell/dihedral model. Tearing is lattice-link failure, not remeshed fracture. There is no fabric self-collision, cloth–cloth collision, plasticity, yarn simulation, or high-speed continuous collision detection. Extremely soft settings or large loads can stretch the lattice substantially. Solver iteration error remains, so the maximum resistance is not perfectly inextensible. Detached cloth may fold through itself.

**06 · Fur / hair** compares short plush, stiff bristles, curly wool, and long hair. Plush, bristles, and long hair each have 36 simulated guide curves with 6, 8, and 12 segments respectively. Wool uses 24 guides with 20 segments to resolve its curls. That totals 1,548 physical nodes across the scene. Two root nodes per guide are pinned to an analytic spherical fixture. Guide length constraints resist extension. Low-curl grooms (curl below 0.15) use zero-curvature vector rod constraints with rest-length-normalized, constant gradients. These relax the small initial curl toward a straight rest shape without the near-180° angular singularity or redundant chord constraints that made stiff bristles explode after ball contact. More curled grooms keep two- and three-segment rest-length chords to preserve bend/twist preference, with angular hinges only on their nearly straight sections. All of these constraints are rotation-invariant. This replaces unstable world-space curvature-vector constraints that pumped energy into the wool. The same three substeps/three iterations handle gravity, damping, gusts, floor/fixture contact, and two-way probe contact. **Brush selected** applies a velocity impulse increasing toward each tip. **Ball at groom (R)** launches the physical sphere; there is no scripted bending animation.

Length, curl, stiffness, damping, fiber radius, and roughness can be varied. Changing length or curl rebuilds only the selected groom; the other properties update it in place. **Rendered strands / guide** changes visual density without changing guide physics. Six follower strands per guide are the default; they inherit guide deformation and stable offsets. Followers do not have independent contacts. Roots on the spherical fixtures occupy the upper hemisphere, so these are small coat/groom samples rather than complete furry creatures.

Fabric cells become thin full-covariance Gaussians; each fiber segment becomes a long, narrow 3D Gaussian aligned to its current tangent. The visible fixtures are also Gaussian samples. No triangle cloth or hair mesh is drawn. Shared RGB degree-3 environment SH is evaluated against the deformed normal/reflection direction, alongside a cloth GGX/sheen approximation and a tangent-dependent fiber highlight. This is procedural relightable shading, not fitted per-strand radiance, spectral fiber scattering, a full Marschner BSDF, or multiple scattering through dense fur. Directional highlights and roughness are present; shadowing within the grooms needs further work.

Stable material-space groups merge optical mass and covariance moments for LOD. The renderer blends adjacent levels and uses projected size plus the existing smooth, speed-proportional camera multiplier. It has a separate **12,000-splat** cap including both transition levels and 640 fixture splats. A torn cloth stays at its finest level so a broad parent cannot bridge the opening. Coarse hair bundles can soften curls and silhouettes. The renderer accumulates bundle moments directly to avoid creating a fine object hierarchy every frame. Simulation resolution does not change during motion.

These are bounded CPU experiments, not open-world deformable streaming. Tests cover independent stretch/bend response, damping, fixed anchors, optional tearing and reset, equal/opposite isolated contact impulses, bounded hair extension, curl/brush response, optical-mass preservation, and the draw cap. A 30-second wool settling regression applies a brush impulse at 12 seconds and requires RMS node speed below 2 mm/s over the final five seconds; the current run decayed to roughly 0.07 mm/s at 30 seconds. A separate 30-second bristle regression settles for five seconds, launches the real probe with the UI velocity, and requires the same 2 mm/s late-speed limit. The fixed bristles reached a late peak near 0.11 mm/s and final segment strain below 1%; the failing solver sustained roughly 53 m/s. The live **Selected groom RMS speed** diagnostic exposes this motion directly. These measurements concern stability, not material calibration. Numerical compliance and parameters still need calibration. Next steps are calibrated rod/shell bending and torsion, self-collision, fiber friction and entanglement, better scattering/shadows, GPU simulation and submission, and distance-based simulation residency with preserved state. Wetting, cloth absorption, mud adhesion, and hair–water coupling are later experiments.

## Test 04: water and pressure

Choose **04 · Water / pressure**. **Test controls → Water** contains **Reset pool**, **Dam break**, **Stir centre**, and **Heat centre**. **Drop probe here** (or Space with the viewport focused) drops the rigid sphere into the water. Choose **Stir water** or **Heat water** in the Tool menu to act at a clicked water particle. Heat automatically selects the temperature visualization. **Pause** freezes the simulation; the camera remains usable. Reset pool reseeds water inside the current basin; reload restores the original bowl.

The basin is a separate, session-only terrain field with a 3 m spherical subtraction. It uses the same terrain/contact queries as the other tests. Subtract/add tools can change the basin while water is running. These edits never overwrite the saved terrain experiment. Water retains a fixed safety box (x/z ±5 m, y −4…6 m), including after carving an outlet. This is a bounded solver test, not fluid streaming across an open world. Only nine detailed terrain chunks are resident in this scene, in addition to the coarse proxies; no grass roots are generated.

The default pool has **346 equal-mass particles** at a 0.45 m initial spacing. A CPU position-based fluid solver advances at a fixed **30 Hz**, independently of display refresh rate and render LOD. It predicts gravity-driven motion, finds neighbors through a spatial grid, relaxes excess density with two Jacobi constraint iterations, enforces terrain/body contact, and recovers velocity from corrected positions. The viscosity control applies symmetric pairwise velocity mixing. Pressure iterations trades CPU work for density convergence. **Peak compression** reports the maximum density excess before the final correction; it is not pressure in pascals. Particle mass stays constant, but this coarse discretization does not guarantee an exact visible water volume.

The sphere advances at 120 Hz and has a mass of 180 kg in this test. Water/body penetration corrections are split by mass and converted into equal-and-opposite linear impulses. The ball displaces water and receives a reaction. This coupling is approximate: it has no calibrated buoyancy, tangential fluid drag, or viscous torque. SDF boundaries absorb momentum. The fluid's boundary density estimate, free surface, splashes, and angular-momentum behavior need further work.

Temperature starts at 20°C, follows each particle, and diffuses symmetrically between neighbors. Heat clicks add a local temperature pulse; the temperature view maps 20–55°C from blue to red. Equal particle masses and a constant assumed heat capacity make summed temperature a heat-conservation proxy. Temperature is **passive**: it does not yet change density or viscosity, produce convection, boil water, or exchange heat with terrain or air. The viscosity slider is a dimensionless mixing strength, not a calibrated SI viscosity.

Water still projects full-covariance 3D Gaussians. Its optical view now accumulates Gaussian depth moments, thickness, and foam, then reconstructs one smooth interface per pixel. Normals come from spatial differences of that reconstructed surface. This is an optical reconstruction from splats, with no triangle water mesh, animated normal map, or imposed wave motion. Density/speed/temperature views retain direct Gaussian compositing.

The interface uses water IOR 1.333, Fresnel reflection, a GGX sun highlight, and shared degree-3 sky SH. Refracted rays march into the SDF basin; their path length drives wavelength-dependent RGB Beer absorption and an approximate single-scattering term. Terrain color is sampled from the opaque image at the refracted hit, with a fallback when the hit is offscreen. **Surface roughness** controls the specular response; **Turbidity** controls the scattering/extinction approximation. This single-interface screen-space reconstruction cannot faithfully handle overlapping sheets, underwater viewpoints, offscreen reflection, or full multi-bounce transport. It is not yet a calibrated spectral or multiple-scattering model.

Foam is an advected scalar generated near the free surface from weighted relative particle velocity, with a 1.8 s exponential decay timescale. It raises roughness and adds white scattering. This is an entrainment heuristic, not a resolved turbulence, air, spray, or bubble simulation. Waves/sloshing follow the existing fluid dynamics and are visible in the optical interface; fine capillary waves and breakers are unresolved. **No caustic texture or animated light pattern is applied.**

Water render LOD groups particles into coarser spatial cells using projected footprint and the same continuous camera-speed multiplier as other tests. It merges center/covariance moments and blends optical density between neighboring levels. Both levels count as submitted water splats during transitions; simulation particles are unchanged. Moving particles can still change coarse cell membership. The draw buffer accommodates both levels and is independent of the surface budget.

Tests cover a contained pool, dam collapse, fixed particle mass, equal/opposite ball impulses, a falling rigid sphere, heat conservation, fixed stepping across display rates, and LOD isolation/optical blending. The earlier direct-volume preview was approximately **9–12 FPS**, with roughly **9–10 ms per fluid step** and **3 ms of water draw CPU work**; those are local observations, not a GPU profile or hardware guarantee. These older timings predate the new optical interface and shared terrain visibility. There is still substantial terrain/render cost. Dropped catch-up time is reported, so slow frames can make simulated time fall behind wall time. GPU simulation and a measured frame budget are prerequisites for expanding this beyond a small experiment.

## Terrain coverage and cut visibility

Terrain color Gaussians now share one cached first-hit SDF depth and normal per pixel. A cavity-wall Gaussian cannot Newton-project onto the outer rim and carry its wall lighting across the cut. Field-normal agreement and normal-offset support reject incompatible kernels; Gaussian density still determines coverage. Terrain direct diffuse shading uses that common normal, removing per-kernel sun-lighting seams; its existing SH environment term remains. This intentionally trades the old per-splat terrain shadow approximation for consistent field-based lighting; richer terrain shadowing is still pending. The other material objects retain their SH/material shading.

**377 coarse proxy chunks** cover a circular region around the camera, independently of the 9/49 detailed chunk cache. Each proxy samples the upper terrain field at 4 m spacing and owns a Gaussian hierarchy. Proxies are immediately available for loading regions; they crossfade to detailed chunks over 0.45 s. Edits invalidate only affected proxies. Outer terrain fades continuously over **112–152 m** horizontally from the camera, before reaching the proxy-cache boundary. Fog also reduces horizon contrast. Surface splat budgeting includes proxies and handover layers. This avoids a blank ring outside the detailed cache, but is not infinite rendering: distant cave walls, fine cuts, silhouettes, and long rays remain approximate.

## Test 05: gravel, sand, and mud

Choose **05 · Gravel / sand / mud**. The three piles run left to right: **110 gravel particles**, **364 sand parcels**, and **222 mud parcels**. **Reset piles**, **Disturb all piles**, and **Roll ball (R)** exercise settling and displacement; Space drops the probe. The test has its own editable, session-only terrain, preserving saved terrain and basin edits. The camera reset frames all three piles.

The CPU solver advances at 60 Hz with four contact iterations. A spatial grid finds nearby particles. Mass-weighted normal corrections prevent overlap; tangential position corrections approximate Coulomb friction. Gravel uses larger radii/high friction, sand smaller parcels/moderate friction, and mud short-range cohesion, stronger dissipation, and a wetter specular appearance. The 40 kg probe exchanges normal contact impulses with the particles. The visual treatment is material-specific:

- **Gravel** uses anisotropic 3D Gaussians inside deterministic, world-oriented 14-plane stone supports. Ray/support intersections provide facet normals, support clipping, and surface depth. Rough dielectric shading and SH illumination replace camera-facing sphere normals. Individual stone identities remain intact at every visual LOD (110 stones in this bounded test); rotations and irregularity are visual presets, not new rigid-body angular dynamics.
- **Sand** represents its many small grains as a continuous matte pile surface reconstructed from overlapping parcel Gaussians. Fine pigment and normal variation fade when the projected pixel footprint cannot resolve them, so a physical parcel no longer appears as one large bead. This procedural fine-grain texture is not individually simulated grain geometry.
- **Mud** reconstructs a separate, wider connected skin. Surface normals come from the depth field, then a rough dielectric GGX lobe, Fresnel response, and roughness-filtered SH environment shade that skin. There is no independent Phong highlight per parcel. **Mud wetness** changes substrate darkening and surface roughness only; it does not change cohesion, viscosity, or simulated water content.

The bulk-material GPU pipeline first finds per-pixel front depths, then adds Gaussian density/depth moments separately for sand and mud. Three bilateral depth-field passes suppress parcel-scale normal spikes while retaining silhouettes. This filters geometric reconstruction, not the finished image or camera motion. A depth-aware resolve handles terrain, the probe, gravel, and sand/mud overlap. The fields are capped at 300,000 optical pixels and reused when simulation, view, and LOD are unchanged. Gaussian contact absorption darkens the terrain near resting parcels; this is approximate contact occlusion, not a directional shadow or global illumination solve. CPU work still prepares/sorts the particle attributes; reconstruction and material shading execute on the GPU.

Bulk render coarsening blends adjacent moment-preserving levels without merging materials or removing simulated parcels. Gravel orientation and pigment remain attached to parcel identity. The **Gravel**, **Sand**, and **Mud** buttons inspect each pile; **Reset camera** restores the comparison view. Normals and splat-coverage views also cover these materials. Saved terrain and clay edits remain separate.

These are **coarse material experiments**, not calibrated geotechnical models. Sand parcels represent many grains. Gravel contacts are still spherical rather than interlocking angular stones, despite the irregular visual supports; grain rotation/torque is absent. Mud is cohesive damped soil, with no pore-water pressure, drainage, saturation, yield-stress constitutive solve, or water–soil exchange yet. Momentum lost to terrain, friction, damping, and safety bounds is intentional; energy and angular momentum are not fully conserved. The safety box is x ±7 m, z ±4 m. Piles may creep or slump with this low iteration count. The sand/mud optical skin is a single front-layer approximation per material, not an exact 3D isosurface or volume-preserving reconstruction. Overhangs, thin separated streams, coarse LOD, and grazing silhouettes can expose its limits. Fine procedural texture is evaluated in world space and does not yet advect with the soil.

Appearance checks cover positive full covariance, deterministic stone frames, unchanged stone identities across coarsening, material separation, and unchanged physical positions, velocities, and mass. GPU visual checks exercise close-ups, wet/dry mud, moving lights/camera, disturbed piles, the rolling probe, and the shared water-renderer regression. See `src/grain-appearance.js` and `src/grain-optics.js`.

Numerical checks cover deterministic resets, settling/containment, distinct spread and retained height, probe contact, and material-preserving render LOD. The updated local preview at 489 × 745 and 85% render scale ran around 24–28 FPS with about 7 ms per granular step. This bounded scene is not an open-world performance result.

## Water and mixed-material roadmap

The aim is a shared physical state that drives appearance and interaction. Low visual detail should reduce sampling cost without inventing different material laws. Render LOD can be aggressive; simulation changes must preserve mass, momentum, heat, and material fractions at region boundaries.

| Pass | Scope and acceptance test |
| --- | --- |
| Present prototype | Coarse pressure relaxation, SDF contact, particle sloshing, passive heat diffusion, Gaussian optical interface, Fresnel/GGX, one-interface refraction, absorption, approximate in-scattering, heuristic foam. Compare optical and diagnostic views of exactly the same simulation. |
| Hydrostatics and rigid coupling | Boundary volume/density correction, pressure-force integration, displaced volume, buoyancy, drag, and torque in a unified solve. Floating objects must displace their weight of fluid; sealed pools must conserve mass and settle to a stable level. Avoid adding an independent upward buoyancy force on top of an already complete pressure force. |
| Waves and interfaces | Improved free-surface reconstruction, resolution convergence, vorticity handling, surface tension, wetting/contact angles, and breaking waves. Resolve macroscopic waves physically; aggregate only subpixel capillary detail. Test wave speed, damping, obstacle wakes, and energy loss. |
| Light transport and emergent caustics | First provide a view-independent Gaussian density/interface query (the current screen-space surface is insufficient). Trace energy packets from the sun/lights through that shared water interface using Snell/Fresnel; deposit refracted energy on SDF receivers. A bounded photon/beam cache can share estimates across frames and spatial levels. Splats reconstruct the estimate; they do not prescribe a caustic pattern. Test a flat interface, a focusing wave, moving lights, energy conservation, and convergence. Multiple interfaces and offscreen visibility must precede claiming general caustics. |
| Participating media / subsurface appearance | Wavelength-dependent absorption and scattering, phase functions, optical path length, multiple scattering/diffusion where optically thick, and consistent underwater views. Use molecular/Rayleigh terms where appropriate, plus particulate and bubble scattering; a blue tint alone is not Rayleigh scattering. Test clear/shallow, deep, turbid, backlit, and submerged cases. |
| White water and air | Couple entrainment to breaking/shear/curvature evidence; evolve separate spray, bubbles, and surface foam with drag, rise, lifetime, and water/air mass accounting. The current foam scalar is only a preview of this system. |
| Heat, diffusion, and phase change | Calibrated heat capacity/conductivity, heat exchange with terrain and air, temperature-dependent viscosity/density, convection, freezing/melting, and latent heat/boiling. Keep molecular diffusion distinct from turbulent mixing. Test equilibrium, diffusion rate, buoyant convection, and energy budgets. |
| Sand, gravel, and mud coupling | Angular/frictional grain response, repose and compaction, water saturation/permeability, pore pressure, cohesion/yield behavior, sediment suspension/settling, erosion/deposition, and drying. Test wet/dry transitions and mixture mass conservation before presenting mud as water plus soil. |
| Open-world scale | GPU neighbor search/solves, sparse active regions, sleeping grains and settled sediment, coarse far-field water, conservative transfers between resolutions, optical cache LOD, named-hardware CPU/GPU budgets, and worst-case interaction tests. Camera coarsening must not silently delete fluid/soil mass or heat. |

Sequence the hydrostatic/interface tests before caustics: otherwise the light system would faithfully amplify an unstable or wrong water surface. Keep gravel/sand/mud isolated until the coupling is validated, then add a shared wet bank/shoreline scene. Full diffraction is a separate wave-optics milestone; geometric Snell rays cannot produce it.

## Test 03: grass interaction

Choose **03 · Grass interaction**. Open **Test controls → Grass → Roll ball (R)**, or focus the viewport and press **R**. The existing rigid sphere starts with rolling velocity and spin, then gravity and field contact determine its path. **Drop probe here** and **Impulse probe** also affect the grass. **Show bending** colors displaced grass orange/red; **Reset bends**, **Recovery**, and **Pause** help inspect contact and regrowth. There is no animated wind or scripted ball path.

The worker generates deterministic roots on the upper exposed terrain surface. On unedited ground, the 49 resident chunks contain 78,400 finest-level roots. Near blades use three elongated 3D Gaussians along a curved centerline. Both their centers and covariance axes bend; their roots stay attached. Coarser levels use wider clump representatives. Grass uses Gaussian optical-depth alpha and a shared degree-3 material SH response, plus direct light and approximate backlighting. It does not allocate individual SDFs, rigid bodies, or unique SH coefficients for every blade.

A sparse 0.5 m lattice stores horizontal deflection and flattening. The physical sphere's swept path presses nearby nodes; critically damped springs restore them. That field advances at the same fixed 120 Hz timestep as physics, independently of drawing detail. The recovery slider controls a characteristic spring timescale, not an exact deadline. Nearby blades interpolate the field on the GPU. An airborne sphere above blade height does not press grass. Contacts agree across shared chunk boundaries.

Grass LOD is selected in 4 m patches using projected size and the camera motion multiplier. Parent/child levels crossfade in density. The separate grass budget defaults to 12,000 submitted Gaussians and counts both levels during transitions. The bottom total includes surface, grass, water, and granular draws. Static draw lists are reused after the camera and detail settle; changed deformation texture rows still update. Terrain depth is ray traced and cached until the camera, resolution, or relevant fields change, so broad terrain kernels do not cut thin blades into bands. The ball occludes grass analytically without turning each grass splat into an opaque depth disk.

This is **one-way body-to-grass coupling**: grass does not exert drag or torque on the ball. The bend field is a coarse vegetation response, not individual elastic rods or blade-to-blade collisions. Roots avoid steep walls; exposed surfaces regenerate after edits, including new cut floors. Regenerating or evicting a chunk resets its bends. Coarse clumps and visibility transitions remain approximate, and refraction/reflection rays do not trace grass. There is no durable vegetation state yet.

Tests cover deterministic roots on edited surfaces, an actual rolling physics sphere, airborne rejection, recovery, chunk seams, draw budgets, deformation updates with cached draw lists, and clean regeneration. Rendering cost remains substantial; the grass test has not established a 60 FPS hardware target.

## Terrain and physics

Drag to orbit and scroll to approach. WASD travels, Q/E descends/ascends, and Shift accelerates. This is a free camera, not a walking character. Keyboard controls require focus in the viewport. Right-drag orbits while editing; P toggles controls, C resets the camera, and Space drops the probe.

1. Select **Subtract material** or **Add terrain** and click the terrain. Enable **Chunk boundaries** to inspect edits across a 16 m border.
2. **Save location**, then **Move +128 m**. Resident geometry stays bounded at 49 chunks while generated/evicted counts increase.
3. **Go to location** restores the camera target. **Return to edit** centers on the last edited point. Edits survive regeneration and page reload.
4. **Undo edit** reverses the latest operation. Terrain permits 64 edits, radii 0.25–3 m, and sphere extents inside y = −11…11 m. Clay permits 12 cuts, stored separately.
5. **Drop probe here** and **Impulse probe** exercise field contact, gravity, linear velocity, and angular velocity independently of render detail.

The terrain field is (y − height(x,z)) / 2 with ordered sphere unions/subtractions. It is a conservative distance bound, not an exact Euclidean SDF. Local gradient magnitude converts it to approximate contact distance. One worker builds chunks and their hierarchies; edit signatures reject stale worker results. Each chunk has a sampling halo and owns its fragment bounds.

Only edit logs persist in browser local storage. Bookmarks last for the session; body state and material changes are not saved. The single dynamic sphere uses a fixed 120 Hz timestep, restitution, friction impulses, sphere inertia, and angular integration. Static terrain absorbs reaction impulses. Free-flight angular momentum is preserved; high-speed continuous collision detection is not implemented.

## Measurements

Diagnostics report active Gaussians, pixel target, estimated motion, selected-material count, CPU sort time, frame spacing/p95, worker time, residency, edit count, and dropped physics catch-up time. Frame spacing includes browser scheduling and startup/compilation stalls; it is not a GPU timer.

SH and hierarchy storage cost substantially more than the original center/normal samples. Chunk attributes report resident records; GPU Gaussian pool reports allocated record capacity. CPU mirrors, framebuffers, worker scratch memory, and driver overhead are additional. The pool reuses evicted slots and updates changed texture rows rather than uploading the entire pool on every chunk arrival.

Local material-scene inspections at 85% resolution measured 12,655–14,295 active splats and 1,850 wax splats while settled, versus about 3,000 active splats and 72–192 wax splats during continuous orbit. Frame rate varied substantially: earlier views reached 44–45 FPS, but the final carved-scene checks were around 17–21 FPS; loaded terrain views were around 17–20 FPS. Reducing submitted splats has not yet removed the other rendering bottlenecks. These are observations from this preview, not a consumer-hardware or 60 FPS guarantee. Cuts, loading, camera angle, and glass coverage change the cost. Render DPR is capped at 1.5 and target area at 1.4 million pixels.

Automated checks cover fields, carving, contact/torque, fixed stepping, persistence, chunk boundaries, eviction/stale worker results, SH reconstruction, covariance moment preservation, hierarchy reduction, negligible Gaussian tails, screen-size selection, budgets including transition layers, and immediate motion response with smooth recovery.

## Source map

| File | Responsibility |
| --- | --- |
| src/world.js | Materials, analytic fields, ray and contact queries |
| src/terrain.js | Terrain field, edits, serialization, chunk selection |
| src/terrain-worker.js | Background sampling and hierarchy generation |
| src/streaming.js | Detailed residency, invalidation, eviction, stale results |
| src/terrain-proxy.js | Coarse far/loading chunks and distance fade |
| src/sampling.js | Field surface samples and crease support |
| src/gaussians.js | Covariance, moment merging, hierarchy records |
| src/sh.js | Degree-3 SH basis, projection, material radiance fitting |
| src/lod.js | Motion response, projected size, conservative budget |
| src/grass.js | Terrain roots, clump levels, sparse contact and spring field |
| src/grass-renderer.js | Deformed Gaussian grass, patch LOD, bend atlas |
| src/fluid.js | Bounded position-based fluid, field/body contact, passive heat |
| src/fluid-renderer.js | Gaussian water/grain submission, blended LOD, optical buffers |
| src/water-optics.js | Gaussian interface reconstruction, refraction, scattering, reflection |
| src/granular.js | Gravel/sand/mud parcels, friction, cohesion, probe contact |
| src/deformable.js | XPBD length/bend constraints, damping, sphere/floor contact |
| src/fabric.js | Cloth presets, weave compliance, pins, controlled pull, tearing |
| src/fibers.js | Hair guides, rest curls, fixtures, brush/gust forces |
| src/soft-splats.js | Material-space Gaussian moments for cloth/fiber LOD |
| src/soft-renderer.js | Dynamic covariance projection, SH, cloth/fiber lighting |
| src/renderer.js | Record pool, culling, sorting, Gaussian render passes |
| src/shaders.js | Covariance projection, SH evaluation, Gaussian alpha, glass cache |
| src/reference-shader.js | Independent SDF comparison and secondary-lighting helpers |
| src/physics.js | Dynamic probe and fixed-step accumulator |
| src/main.js | Input, diagnostics, persistence |

CPU and GLSL fields are manually mirrored. Geometry/field uniforms still use 32-bit coordinates; planetary precision is not supported. Further work includes optimized coarse representations, more accurate visibility, GPU selection/sorting, and a named-hardware frame budget. Large-scale water, calibrated pressure and thermal coupling, calibrated granular/wet-soil behavior, air, diffraction, erosion, and fracture remain later milestones.

## Technical references

The representation is informed by [3D Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/), the screen-filtering discussion in [Mip-Splatting](https://niujinshuchong.github.io/mip-splatting/), and the LOD approach in [Hierarchical 3D Gaussians](https://repo-sam.inria.fr/fungraph/hierarchical-3d-gaussians/). This procedural prototype does not implement their training systems or claim their measured quality/performance.

The fluid constraint solve is based on [Position Based Fluids](https://mmacklin.com/pbf_sig_preprint.pdf), with neighbor kernels and particle-property smoothing informed by [Particle-Based Fluid Simulation for Interactive Applications](https://matthias-research.github.io/pages/publications/sca03.pdf). This simplified CPU implementation does not reproduce either paper’s complete solver or performance results.

Granular position-level contact/friction is informed by [Unified Particle Physics](https://matthias-research.github.io/pages/publications/flex.pdf). The caustic work is informed by [Stochastic Progressive Photon Mapping](https://www.pbr-book.org/3ed-2018/Light_Transport_III_Bidirectional_Methods/Stochastic_Progressive_Photon_Mapping); participating-media work follows [Volume Scattering](https://www.pbr-book.org/3ed-2018/Volume_Scattering). These are implementation references, not claims that the current prototype implements those complete methods.

The deformable constraint formulation follows [XPBD: Position-Based Simulation of Compliant Constrained Dynamics](https://matthias-research.github.io/pages/publications/XPBD.pdf). The prototype uses simplified bending and collision models. [Light Scattering from Human Hair Fibers](https://www.cs.cornell.edu/~srm/publications/SG03-hair-lr.pdf) is a reference for a future full fiber-scattering model; the current tangent highlight does not implement that model.


## Test 08: subsurface scattering and transmission

Choose **08 · Subsurface / transmission**. Nine isolated optical samples are arranged in rows: **marble, leaf, skin; water, clear glass, amber glass; emerald, cobalt, ruby glass**. The names below the samples are functional inspect buttons. Open **Test controls** to select/isolate a sample, restore its preset, change thickness, scattering, absorption, suspended scatterers, or surface roughness. **Reset camera** restores the overview (or the selected view while isolated).

**Front light**, **Back light**, and **Half-shadow illumination** exercise different transport paths. With half-shadow enabled, turn **Subsurface transport** off/on: the opaque-material baseline shades locally, while diffusion lets light spread into the unilluminated half. Backlighting makes the leaf transmit green and skin transmit red more readily than blue. Increase thickness to reduce transmission. The optical dimensions are deliberately separate from the enlarged display: **one scene unit represents 25 mm**, with the selected centre thickness and index of refraction displayed in the controls. Material coefficients are **artistic homogeneous presets in m⁻¹, not measured biological or geological fits**. These are optical swatches, not anatomical models or detailed leaf/marble assets.

For transparent samples, the checker cards are calibration targets. Enable **Transmission lineup** to place marble behind water, a leaf behind clear glass, and skin behind amber glass. The refracted rays trace the other sample boundaries and materials in scene space, including hidden/offscreen samples; they do not simply read the screen background. Orbiting also tests arbitrary overlaps and glass behind glass. Clear water is almost colorless at these centimetre path lengths; add suspended scatterers to test turbidity. Different glasses use different RGB absorption coefficients. Set scattering to zero to verify that colored glass still absorbs and refracts. Increasing surface roughness spreads the transmitted directions, frosting the grid independently of the volume's scattering. The thickness and straight-path RGB-transmittance views help separate geometry from shading.

### Transport and Gaussian reconstruction

- Marble, leaf, and skin solve `−div(D grad(phi)) + sigma_a phi = sigma_s′ L_direct` inside each bounded ellipsoid. `sigma_s′ = (1 − g) sigma_s`, `D = 1 / (3 sigma_t′)`. A 24 × 28 × 16 cell grid uses a Robin escape boundary and a diagonally preconditioned conjugate-gradient solve for each RGB channel. Direct illumination is attenuated to each cell; the half-shadow mask is evaluated at its light-entry point. The field therefore spreads light spatially; it is not a wrapped diffuse lobe or screen blur.
- A worker rebuilds the three view-independent diffusion fields only when their optical parameters or lighting change. Requests coalesce while it is busy. Camera motion, visual LOD, and surface roughness do not change the transport solve. The controls expose cache readiness and build time. The last completed field remains visible during updates; moving lights can therefore lag by one cache build. The first build uses local shading until the field is ready.
- The visible samples use perspective covariance-projected **3D Gaussian surface primitives**, with additive Gaussian normal/density moments and optical coverage `1 − exp(−sum(tau × Gaussian))`. Mass-preserving hierarchical merges and adjacent-level blending obey the existing screen footprint, camera-speed, and splat-budget controls. No solid mesh is drawn for a sample. An analytic ellipsoid boundary supplies optical path lengths, Snell normals, per-pixel visibility/depth, and clips support spilling beyond the sample. Thus the Gaussians reconstruct the visible coverage and shading normal; the invisible support field stabilizes refraction.
- The surface pass combines cached RGB diffuse escape, ballistic transmission, dielectric Fresnel/GGX reflection, and **degree-3 RGB SH environment radiance**. Water/glass use entry/exit Snell refraction, Beer–Lambert extinction, a 12-point single-scattering integral with a Henyey–Greenstein phase function, and one additional internal reflection. Rough transmission averages 16 deterministic microfacet directions; an approximate ray-cone footprint analytically filters the calibration checker and its edges. There is no temporal random noise, finished-image blur, or prescribed caustic texture.

This is a **bounded approximation**, not a general BSSRDF/path tracer. Reduced-transport diffusion is least reliable for very thin or weakly scattering materials (especially leaves); the boundary grid and surface flux reconstruction have resolution error. The opaque-material diffusion and ballistic terms are an approximate combination, not a rigorously matched diffusion/single-scattering solution. The energy test verifies the discrete diffusion solve, not conservation of the complete rendered image. Water/glass use single scattering, so high turbidity still needs a multiple-scattering solver. Transparent rays can traverse up to five additional sample objects, including subsequent transparent samples; opaque hits use their cached diffusion fields. Secondary transparent hits use smooth interfaces and a growing approximate roughness footprint, plus an 8-point scattering integral, rather than branching into another full microfacet sample tree. Unresolved paths at the bound terminate dark. This visibility query is restricted to the nine optical swatches, calibration cards, and SH environment; it does not yet query other engine scenes or reconstruct secondary-ray Gaussian LOD coverage. The cards themselves are analytic test targets, not Gaussian assets. Cards do not shadow the samples. Camera-inside-medium rendering, spectral dispersion, Rayleigh wavelength dependence, layered skin, veins/heterogeneous interiors, full multiple internal reflections, global shadows and emergent caustics remain future work. These swatches do not run fluid or deformable physics; tests 04, 06, and 07 remain available.

The local overview and transmission-lineup checks ran around 29–30 FPS, with isolated clear/frosted glass around 28–37 FPS; these are preview observations, not a hardware performance guarantee. The initial diffusion cache build was about 0.8 s and a subsequent half-shadow rebuild about 0.26 s on this run.

Numerical checks cover ray/ellipsoid boundary cases, optical thickness scaling, Beer composition and glass colors, Fresnel/TIR, HG normalization, positivity and energy balance of bounded RGB diffusion, transport into a half-shadow, absorption response, red/blue skin transmission, thickness response, Gaussian covariance/mass preservation, and budget limits across camera speeds. The existing simulation and persistence checks remain in the suite. Saved clay and terrain edit logs are preserved when switching to this isolated test.

References for the transport approximation: [PBRT: diffusion and its assumptions](https://www.pbr-book.org/3ed-2018/Light_Transport_II_Volume_Rendering/Subsurface_Scattering_Using_the_Diffusion_Equation), [PBRT: the BSSRDF](https://www.pbr-book.org/3ed-2018/Volume_Scattering/The_BSSRDF). This implementation uses a bounded finite-volume solve rather than PBRT's semi-infinite photon-beam diffusion profile.

Files: `src/optics.js` (presets, boundaries, Gaussian hierarchy), `src/subsurface.js` and `src/subsurface-worker.js` (diffusion), `src/optics-renderer.js` and `src/optics-shaders.js` (Gaussian reconstruction and optical resolve), `tests/optics.test.js` (numerical checks).


## Test 09: refraction, mirrors, and photon caustics

The preview opens in **09 · Refraction / caustics**, initially a glass tank containing water and three sealed hollow glass balls. **Experiment** selects a glass sphere, convex lens, concave lens, adjustable triangular prism, water surface, flat mirror, concave parabolic mirror, or the combined tank. All dimensions in this test are metres. The floor and wall checker patterns are diffuse calibration receivers, making displacement, inversion, reflection, and light concentration visible. **Inspect receiver** changes the camera to inspect the light distribution; **Reset camera** restores the preset overview.

**Source** selects a broad collimated beam, a finite-width laser, or three offset RGB lasers. Change color, total emitted power, divergence, or tilt. Lens curvature, prism apex angle (40–90°), and mirror focal length change the actual boundaries. The prism uses a narrow slit for the broad source and initially enables dispersion. At 60° it separates white light into approximate RGB bands; increasing the angle also exercises total internal reflection. Toggle dispersion off to compare against a common refractive index. Water amplitude/phase/level and glass-ball shell thickness rebuild the medium layout and light solution. **Receiver lighting** separates direct light from the caustic irradiance; direct-only removes deposits from paths that underwent specular interaction. **RGB dispersion** uses three approximate refractive indices rather than a continuous spectrum. **Trace overlay** shows a bounded sample of actual photon paths as elongated covariance Gaussians. It is an explicitly unoccluded x-ray diagnostic, **not physical visibility of a laser in clear air**. It includes Fresnel-reflected branches as well as the main beam.

### Transport

- Deterministic, stratified photon packets sample the source aperture and divergence cone. **GPU when available** is the default: a WebGL 2 fragment pass follows the packets in parallel, with up to 28 boundary encounters each. CPU code prepares the common emitter samples; ray traversal, interface physics, irradiance deposition, filtering, and diagnostic reduction run on the GPU. Packets carry power; their total equals the selected source power independent of photon count. Glass/water use Beer absorption, Snell refraction, exact unpolarized dielectric Fresnel probabilities, and total internal reflection. Mirrors reflect with 95% power reflectance. Common random numbers across RGB packets reduce false color noise in white illumination. Specular paths deposit their remaining energy into a separate caustic map when they reach a diffuse receiver. There is **no prescribed caustic texture, animated brightness pattern, or screen-space light decal**.
- The floor and wall share a 256 × 512 RGB irradiance atlas, with distinct direct and caustic maps. Bilinear deposits divide by each receiver's texel area. A conservative Gaussian gather preserves integrated deposited flux, including at receiver borders. Increasing gather radius trades spatial detail for lower photon sampling noise. This is a fixed-radius photon density estimate, not progressive photon mapping with a convergent shrinking radius.
- Glass/air cavities and water occupy explicit, ordered volumes. Both the worker and GPU use the same scene parameters and equivalent boundary equations. The tank can produce the sequence air → tank glass → water → ball glass → trapped air and back out again. At coincident receiver/glass roots, the diffuse receiver takes precedence within a small tolerance; otherwise roundoff can invent an air gap and produce speckled TIR.
- Camera rays query scene-space receivers and optical objects, including objects hidden behind other transparent objects. They accumulate Beer attenuation, Fresnel transmission/reflection, and TIR. Each camera wavelength has a transmitted path plus one scene-traced dielectric reflection branch, at most 32 boundary encounters per branch. Later reflection branches approximate their incident radiance with the degree-3 RGB SH environment; unresolved path-limit energy terminates dark. Mirrors continue to trace the scene. This bounded camera model does not reproduce every multiply reflected path.
- The visible optical boundaries and receivers are **3D covariance-projected Gaussian surface samples** with optical-depth alpha, pixel-filter determinant compensation, moment-preserving hierarchy merges, and smooth adjacent-level blending. No solid object mesh is drawn. An invisible boundary cache supplies radiance and primary visibility and clips Gaussian support to the corresponding interface. SH represents procedural environment radiance, not photo-trained splat coefficients. The cache uses at most 180,000 optical pixels, dropping toward 45,000 during fast camera motion; Gaussian detail retains the shared projected-size, speed, and budget controls. Cache filtering and coarse silhouettes remain visible at low resolution. Secondary transport queries analytic boundaries, not a separate Gaussian hierarchy along each ray.

The GPU produces the selected 4,096 / 16,384 / 65,536 solution directly. Three float attachments hold endpoints and energy accounting; four additive point deposits per received packet reproduce the normalized bilinear estimator. Two separable GPU passes apply the conservative Gaussian gather, normalizing by the source texel at receiver edges. Irradiance textures remain resident on the GPU. A reduction tree sends only eight ledger values back asynchronously; the bounded trace overlay separately reads back up to 36 GPU-traced paths. Shader programs are retained between solves. The CPU worker remains a selectable reference and automatic fallback when float targets, float blending, or sufficient MRT support are missing, or when GPU compilation/energy checks fail. Recognized software graphics devices also select the CPU reference and disclose the reason. In CPU mode the worker publishes a 2,048-packet preview before refinement. New settings debounce and discard stale results; already-submitted GPU work finishes before the latest queued solve. Geometry, medium layout, and irradiance replace the prior completed solution together. Camera movement and visual coarsening do not change the photon result. A stationary camera reuses its optical cache and Gaussian buffers. Photon readiness, selected backend, browser-reported graphics device, build/readback wall time, receiver/absorption/escape fractions, TIR events, and path-limit remainder are exposed. **GPU transport time** uses a disjoint-safe GPU timer query when available and covers tracing, deposition, filtering, and ledger reduction. It excludes emitter preparation, shader compilation, diagnostic path reconstruction/readback, and camera rendering. It is not a total-frame time. Browser privacy may hide the device identity. The power ledger measures the finite source's traced packets; it does not include the separate SH environment, the small ambient baseline, or tone mapping.

### Scope and checks

This is a **static optical experiment**, not a coupled real-time water simulation. Wave shapes are prescribed analytic surfaces; phase changes explicitly rebuild them. Hollow-ball positions solve hydrostatic equilibrium from glass-shell mass (2,500 kg/m³) and displaced water (1,000 kg/m³), or rest on the bottom. Shell thickness can make a ball sink. Surface tension, contact between balls, bobbing dynamics, water displacement by the balls, and a spatially varying equilibrium under waves are not solved. The air cavities remain sealed. Test 04 still contains the dynamic fluid solver; connecting its changing surface to an incrementally updated photon cache is a subsequent step.

The finite beam has no explicit emitter geometry in camera reflections. Interfaces here are smooth; test 08 remains the roughness/subsurface-scattering test. There is no volumetric laser scattering, polarization, diffraction/interference, spectral colorimetry, or full global illumination. Photon noise, fixed gather bias, finite receiver coverage, and bounded ray paths are visible limitations. These isolated scenes do not establish an open-world frame budget. Before the GPU transport pass, local verification observed roughly 19–30 FPS with multiple preview tabs open; CPU tank refinement took roughly 2–3 seconds and the lens laser case roughly 1 second. GPU photon transport does not remove camera-cache, Gaussian submission, or browser scheduling costs. These isolated measurements do not establish a fully dynamic caustics frame rate.

Numerical checks verify Snell/reflection laws, adjacent-medium TIR, nested boundary ordering, a slab's outgoing direction and lateral shift, the coincident-floor regression, lens convergence/divergence, prism wavelength separation and TIR, mirror focusing, photon power balance in every preset, conservative gather, curvature-dependent water irradiance, color isolation, photon-count normalization, dispersion ordering, hollow-shell buoyancy, and Gaussian mass/budget preservation. At the default receiver distance a parallel test bundle has RMS radius about 0.068 m after the convex lens versus 0.977 m after the concave lens; the plane mirror preserves 0.432 m while the parabolic mirror concentrates it to about 0.0019 m before finite photon gathering. These tests measure the transport geometry, not the display's blurred spot size.

**Compare GPU / CPU** reruns the selected scene with identical 1,536 emitter samples and a 64 × 128 atlas. It compares the largest power-ledger difference, area-weighted irradiance-map L1 difference, and integrated GPU flux against the GPU receiver ledger. Pass tolerances are 1.5% of emitted power, 12% of received power, and 0.1% of emitted power respectively; FP32 normals and grazing/TIR choices need not match the double-precision CPU tracer bit for bit. Blank or nonconserving GPU ledgers also trigger automatic fallback during normal operation. All eight presets passed on the browser-reported AMD Radeon Pro 560X: the largest ledger difference was 0.19% of emitted power, the largest map difference 1.37%, and flux errors below 0.001%. The comparison exposed and fixed cancellation in near-collimated parabolic-mirror intersections using stable quadratic roots shared by photon and camera paths. These device checks complement the Node numerical suite, which cannot execute WebGL shaders.

All tests already use WebGL GPU passes for covariance projection, Gaussian shading/compositing, and optical reconstruction. **Physics has not all moved to the GPU**: rigid contacts, the test 04 particle fluid, test 05 grains, cloth/hair constraints, and test 08 diffusion still run on the CPU or workers; test 10 adds GPU field simulation; terrain hierarchy construction, LOD selection, and submission also remain CPU work. Next compute migrations are particle neighbor grids/Jacobi solves, deformable constraint batches, and diffusion fields, each retaining a numerical reference and independent simulation timestep.

Files: `src/photon-gpu.js` (GPU orchestration and capability fallback), `src/photon-gpu-shaders.js` (transport, deposits, gather, reduction), `src/photon-gpu-data.js` (emitter/kernel preparation and ledger validation), `tests/photon-gpu.test.js` (data/conservation/fallback checks), `src/light-transport.js` (media, geometry, interfaces, floating equilibrium), `src/photon-map.js` and `src/photon-worker.js` (forward light tracing and irradiance), `src/light-gaussians.js` (surface/path covariance hierarchies), `src/light-transport-renderer.js` and `src/light-transport-shaders.js` (camera transport cache and Gaussian rendering), `tests/light-transport.test.js` (numerical regressions).

References: [PBRT: dielectric interfaces](https://www.pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF), [Jensen: a practical guide to photon mapping](https://www.cs.princeton.edu/courses/archive/fall12/cos526/papers/jensen01.pdf). This prototype implements a bounded geometric-optics photon experiment, not those references' complete rendering systems.

GPU implementation references: [Khronos EXT_float_blend](https://registry.khronos.org/webgl/extensions/EXT_float_blend/), [Three.js asynchronous render-target readback](https://threejs.org/docs/pages/WebGLRenderer.html#readRenderTargetPixelsAsync).


## First-person inspection

Every test except **08** has a **First person** checkbox. Click the viewport to capture the mouse; WASD walks, Shift runs, the wheel cycles scene-specific interactions, and clicking uses the selected interaction at the crosshair. Escape releases the mouse. If the host refuses pointer capture, the viewport falls back to right-drag mouse look with the same walking and interaction controls. The HUD reports the selected tool, grounded/sinking/buoyant state, and position.

A capsule queries each test's existing solid field, including the beach's carved volumes and the optical test's glass shells. Gravity keeps the player on the ground. Press Space on dry ground to jump; airborne presses cannot double-jump. The player sinks in water normally; holding Space increases buoyancy, releasing it restores sinking. Space does not spawn a ball in this mode. Test 04 uses particle-kernel water occupancy, test 09 uses its nested optical media, and the beach samples the active liquid field. The player controller is kinematic; two-way character forces on fluids, grains, cloth, and hair are not implemented.

`?scene=terrain&pov=first-person` opens a test directly. Scene names follow the selector values; test 08 always keeps its inspection camera.

## Test 10: Open beach

The default scene is **10 · Open beach**. **Shore**, **Isolated pool**, **Grass**, **Sand**, **Rock obstacles**, and **Inspect latest ball** provide inspection positions. WASD travels, Q/E changes height, Shift moves faster, and **Move +128 m** exercises residency. Select a surface brush and click/drag; right-drag orbits. **Nudge loose sand** mobilizes grains, while **Mound sand** and **Dig sand** redistribute the resting bed. **Wind brush (hold)** emits a cone along the cursor ray. **Space** spawns a hollow glass ball at the view target in orbit mode; in first-person mode use the glass-ball interaction. There is no gameplay ball limit; memory and rendering/physics cost still grow with the count.

**Wind turbulence** ranges from 0 (steady wind), through 1 (default gust variation), to 2 (twice that variation). Speed, direction, and turbulence feed one shared, advected noise field for the water, grass, loose sand, and balls. Zero wind produces no atmospheric forcing. The wind brush adds a local three-dimensional air velocity, including vertical drag and pressure on water. Wind does not directly prescribe water height or animate it with sine offsets.

### Shared materials and continuous surfaces

`water-material.js` supplies density, IOR, absorption/scattering, roughness, and turbidity to this scene and test 04. Ocean water and isolated water use the same optical model and local solver. Blue depth attenuation, Fresnel reflection, refraction, volume in-scattering, specular sunlight/moonlight, and foam supply the appearance. There is no separate ocean material.

`sand-material.js` supplies the albedo and wet roughness shared with test 05. Inundation raises saturation; exposed cells dry gradually. Mobilized sand parcels interpolate test 05's dry-sand and mud friction, cohesion, and damping. Dry nudges lift and scatter; wet nudges produce lower, cohesive clumps. Each parcel borrows volume from the bed and returns it when settled. Spray likewise withdraws water and deposits it with impact momentum. Parcels outside the active tile remain dormant rather than being deleted.

The beach now composes its continuous sediment base with analytic rock, reef, and arch distance fields, then applies the same sphere-union/subtraction semantics as tests 02 and 03. **Carve SDF volume**, **Add SDF volume**, and **Undo volume edit** create caves and overhangs; **SDF arch** provides a ready inspection site. Surface-net samples cover vertical walls and undersides with Gaussian primitives. Rays, player capsules, balls, and loose grains query the resulting 3D field. Sediment transport remains a surface layer; this is not yet a volumetric granular solver that collapses arbitrary unsupported sand roofs. The edit limit remains 64 spheres, with a maximum 3 m brush radius.

Cubic reconstruction keeps the resting sediment surface continuous across grid cells. Wet-weighted free-surface reconstruction excludes dry bed heights, preventing water caps over mounds. Ground and water support depths are compared during compositing so water behind a volumetric wall cannot draw over it.

All visible surface coverage, grass, ball shells, and mobile parcels use covariance-projected Gaussian density. Invisible fields provide support depths and optical interfaces; the renderer shades the supported surface once per pixel. Grass blends through five levels of stable world-space blades/clusters, then into distant meadow coverage. Three elongated Gaussians represent a nearby blade. A covariance-space ray test prevents near-camera quads from filling the screen. A foreground grass pass restores correct grass-over-glass occlusion. Camera-speed coarsening affects only rendering, not simulation.

### Water, sediment, and locality

The GPU runs a **128² local field at 0.65 m spacing and 75 Hz** (83.2 m across). A **128² periodic field at 4 m spacing and 25 Hz** supplies 512 m of coarser wind-driven water. Both use the same first-order hydrostatic reconstruction and Rusanov flux kernel. The local field resolves terrain, wet/dry fronts, brush pressure, ball wakes, and obstacle deflection. The distant field represents deep water; it is a repeated coarse approximation, not a globally simulated ocean. Incoming local boundaries relax toward its elevation and velocity. Rendering blends free-surface elevation across the overlap and fades the distant horizon instead of ending at a tile edge.

Wind shear and spatial pressure differences generate flow and waves from rest. Steepness, compression, and wakes produce advected foam; the coarse solver also emits spray parcels. Sand slopes relax through conservative neighboring transfers, with greater wet cohesion. Raising ground displaces water into surrounding wet cells; submerged soil slumping exchanges water in the opposite direction.

**3D water in local patch** enables a separate, more expensive free-surface test over the reef. Its 24 × 28 × 112 MAC grid has 0.3 m cells. Velocity occupies cell faces; liquid fraction, pressure, and solid distance occupy cell centres. GPU passes handle velocity advection, wind forcing, pressure projection, extrapolation into air, and geometric PLIC fraction transport. Gravity, the SDF obstacle mask, and wind pressure determine surface motion; no curve or sine displacement specifies a crest. The liquid is a volume, so an individual vertical column can contain water, air, and water again. Covariance Gaussians cover the reconstructed interface, including undersides; refraction and photon transport query that interface. Foam is an entrainment approximation, not a resolved two-phase air solver.

**Breaker reef** positions the camera. **Storm wind at reef** enables the volume and applies stronger wind. **Air gust at reef (2 s)** directs a short wind jet into the water; the wind brush has its own speed slider. **Move 3D water patch here** relocates it to the view target, retaining overlap and regenerating newly covered cells from the coastal field. This bounded experiment uses the same water material as the rest of the scene. The remainder of the ocean still uses the shallow-water approximation. The 3D test starts disabled because its pressure passes and surface traversal are expensive on the current consumer GPU. Its simulated-time counter exposes slowdown rather than claiming a fixed rendering rate. Open boundaries exchange liquid and momentum with the coastal field; coupling is one-way, and outgoing local waves are not yet fed back into the far ocean.

Glass balls have 12 mm walls, glass density 2,500 kg/m³, and radii 0.38–0.49 m. CPU rigid-body steps use displaced spherical-cap volume outside the 3D patch and sampled liquid occupancy inside it, gravity, water/air drag, waterline damping, ground friction, and spatially hashed ball contacts. Their positions and velocities feed GPU water/grass sources. CPU samples use the continuous reconstructed field with asynchronous GPU readback. Fluid/body momentum exchange is still approximate, and spin remains a rolling diagnostic rather than a complete torque/inertia solve.

The active field follows the camera on a world-aligned grid. Overlapping cells retain state; up to 131,072 dormant field cells are cached. Edited and relaxed soil is retained separately for the session, including pending parcel transfers when the tile moves. Dormant water stops evolving and may be regenerated after cache eviction. Beach edits reset on page reload; saved clay and terrain from other tests are untouched.

### Lighting and GPU work

Time of day moves the visible sun. The visible moon stays at a fixed world-space sky direction. The sky integrates single Rayleigh/Mie scattering through a spherical atmosphere into a 128 × 64 map, projected into degree-3 SH for directional environment lighting.

Caustics come from GPU forward photon tracing through the current water normals and hollow glass boundaries. 16,384 packets cover a moving 36 m emitter footprint, using Snell refraction, Fresnel loss, total internal reflection, and water absorption. Gaussian deposits gather into a local irradiance atlas. There is no painted or animated caustic texture. Transport is bounded to nine interface events and the dominant transmitted/TIR path; it is not full multiple-bounce GI. Camera reflection/refraction also uses bounded surface and screen-space reconstruction, with off-screen fallback approximations.

The GPU handles the two shallow-water fields and the optional 3D fluid passes, wetness, soil relaxation, grass bending, atmosphere, photon transport, surface reconstruction, ray intersections, and splat drawing. CPU work covers sparse sand/spray contacts, rigid bodies, brush/residency bookkeeping, and LOD/submission. **GPU pass times** use asynchronous timer queries when available; **Draw** remains CPU submission time. The explicit CPU field reference is available for comparison, but a full-resolution CPU run is expensive.

### Verification and remaining limits

**Compare GPU / CPU** checks both local and periodic 16² fields over eight timesteps, including wind, a ray jet, a brush, steep terrain, and a moving ball source. It compares depth, momentum, foam, saturation, grass bending, and soil displacement at tolerance **1e-4**. The AMD Radeon Pro 560X validation measured **7.30e-6** maximum component error. A separate 16,384-photon flat-water test compares refracted endpoints and Beer/Fresnel flux against an analytic reference: maximum endpoint error **4.9 mm** (20 mm tolerance), flux error **0.00024** (0.005 tolerance). Field disagreement switches to the CPU reference and pauses; photon disagreement disables caustics. `tests/beach-gpu.html` runs these GPU checks independently of the full scene, plus a 65,536-point water/rock reconstruction check. Its still-water case reports zero elevation error and no water leaks onto dry rock. The surface cache stores free-surface elevation and wet support separately. Dry terrain clips the water without changing that elevation. Floating-point field samplers explicitly use high precision.

The 3D GPU check compares closed and open boundaries against the CPU MAC reference, including wind and a ray jet, with a 0.003 component tolerance. The inspected GPU passed at a maximum component error of 1.95e-4. The current 0.3 m interactive grid is still too coarse/diffusive for convincing curling surf; a finer 0.125 m wind/reef diagnostic produced a small connected overhang, but this is not yet a validated sustained breaking-wave model. `tests/volume-gpu.html` also runs a wind/reef cross-section test and records connected sheets over air gaps, excluding detached spray and the outer boundary cells. Node tests cover jumping/landing without double jumps, hydrostatic rest, wind-forced volume drift, projected surface velocities, arch/CSG geometry, capsule contacts, and first-person buoyancy.

Node regressions cover water balance/positivity/conservation, wind-generated motion and zero-wind rest, turbulence scaling, periodic wind, obstacle flow, fixed rock beds, underwater mounds, soil/water displacement, parcel volume bookkeeping, recentering, more than 12 bodies, and ball momentum. The rendering checks include loose sand visibility, sun/moon directions, grass/glass compositing, and spawning beyond the old cap.

This pass is still an interactive prototype. At the inspected preview size, GPU splat compositing and ray traversal dominate; performance is not yet a locked 60 fps. Large ball or parcel counts increase cost. Remaining work includes conservative two-way coupling between the 3D patch, far water, and bodies; nested adaptive 3D tiles; improved crest preservation and breaking-wave validation; volumetric sediment collapse/drainage; stronger off-screen optical transport; and further overdraw reduction. Relocating the 3D patch retains overlap but does not cache departed 3D fluid detail.

References: [hydrostatic reconstruction](https://www.math.univ-paris13.fr/~audusse/reseng.html), [Bridson's fluid simulation materials](https://www.cs.ubc.ca/~rbridson/fluidsimulation/), [Jensen's photon mapping guide](https://www.cs.princeton.edu/courses/archive/fall12/cos526/papers/jensen01.pdf), and [atmospheric scattering](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering). The prototype uses bounded approximations, not complete implementations of those references.

### Beach material exchange and visibility pass

The beach **Grab / drop sand or water** tool lifts a scoop from the clicked material. Click again to release it. It is also in the first-person mouse-wheel tool list. Brush radius controls scoop size (capped at 1.4 m); the held-volume diagnostic reports cubic metres. The scoop subtracts column volume before creating mobile parcels, or subtracts occupancy when picking up water inside the enabled 3D patch. Held parcels follow the camera and suspend simulation until released. Dropped sand uses dry/wet test-05 contact properties and deposits when it settles; liquid parcels rejoin the coastal field with their horizontal momentum, or fill available cells in the 3D patch. These are coarse material parcels, not individual grains or a full SPH liquid solve.

The wind brush now starts at 80 m/s. Its surface stress and pressure act directly on the GPU water solver; multiple spatial scales of advected pressure generate shorter waves. No animated sine displacement is added to the surface. Sand entrainment removes terrain volume, wet clumps resist lifting, and wind-driven spray removes liquid before emission. Sparse exchanges synchronize once per affected step and commit before GPU transport; water withdrawals are reserved until that commit, and deposited sand displaces water into neighboring cells. Sparse parcel contacts remain on the CPU. The far/local/3D boundary couplings remain approximate; this is not a claim of globally conservative ocean transport.

Mobile sand and water now accumulate **world-space, volume-normalized 3D Gaussian density on the GPU**. Sparse 1.6 m bricks contain 24³ interior samples and a padded boundary (6.7 cm spacing); their resolution does not decrease when particles spread out. A hashed page table locates bricks. Covariance-projected Gaussians bound the affected pixels, and a ray query finds one connected isosurface and its gradient. Neighboring parcels form amorphous clumps rather than stacked sphere fronts. Tiny unresolved grains/droplets retain Gaussian optical coverage and blend into resolved aggregates. Sand uses the same dry/wet material as the landscape, without inheriting nearby rock coloring. Water retains the shared IOR, absorption, scattering, and Fresnel response; refraction behind mobile water still uses the screen image.

Deposition is gradual: every fixed step subtracts the deposited amount from each parcel's volume and shrinks its kernel. An implicit transition joins contacting clumps to the bulk surface while the finite-volume field receives that material. Both coastal and 3D water accept incremental returns. The transfer ledger uses compensated accumulation for small repeated contributions. The normalized density integral tracks parcel volume; a chosen visual isosurface is still a reconstruction approximation, not an exact volume boundary or a full particle pressure solve.

Grass keeps segmented blades through near and middle distances. Far clumps expand horizontally with their sampling cell, preserving area coverage, but retain their actual vertical height; the ground integrates the canopy at long range. The GPU bends grass using wind sampled at blade height, and bounds its target before temporal relaxation so a strong ray brush responds and recovers without a long saturated plateau. Terrain LOD bands overlap more broadly to avoid coverage gaps.

Water elevation is reconstructed independently of the solid floor and of wet/dry coverage. It is never replaced by the sum of a smoothed rock height and smoothed depth. SDF additions displace water beyond the whole new obstacle, rather than repeatedly filling neighboring cells covered by that same obstacle. Streaming retains the hydraulic offset with cached water. SDF cuts still update the first air interval above the solid, retaining passages under arches. The coastal solver has one water column per x/z location; stacked cave water and volumetric sediment collapse remain limitations.

The field diagnostic reports CPU contacts and GPU/CPU density reconstruction separately. **Compare GPU / CPU** also checks sparse Gaussian accumulation. `tests/parcel-gpu.html` checks density interpolation and gradients against the analytic reference, including growth from a few particles to a dense clump, and `tests/parcel-surface.html` provides a repeatable scoop and validates ray intersection residuals. Sparse brick allocation and particle contacts remain CPU work; density accumulation and surface queries run on the GPU by default.

Additional numerical checks cover scoop/hold/drop volume, 3D occupancy exchange, delayed-readback reservations, deposition displacing water, SDF-floor updates and undo, downhill thin-film drainage, and a strong jet moving bulk water while conserving closed-domain volume.

Regressions also cover flat water around curved solids, water displacement by multi-cell SDF obstacles, a narrow brush at blade height, gradual deposition with a per-step volume ledger, connected density surfaces, and negative-coordinate sparse-page lookups.

## Test 11 — bounded water laboratory

Open `/?scene=water-lab`. The station selector provides a pipe discharging onto a floor, a roughly 14.4 m waterfall, a pool with two submerged jets and three colored underwater lights, a movable open glass tank, a sediment-bearing river, a 12 cm wide drinking glass, and a bounded ocean basin. Direct links accept `&station=pipe|waterfall|pool|tank|river|glass|ocean`. `&paused=1` starts a stationary inspection. Switching/resetting a station resets only that station's finite test supply; it does not touch saved terrain or clay.

All seven stations run the **same particle constraint solver and water material**. There is no ocean-only water shader or prescribed animated wave surface. Coordinates are normalized for numerical conditioning; each station's scale converts gravity, volume, optical path length, and UI measurements to metres. Inlet and underwater jet velocities, gravity, moving SDF walls, and air stress drive motion. The laminar–turbulent slider changes inlet perturbations and wind fluctuations, not the water's identity. Pipe/waterfall/river pumps explicitly recirculate existing parcels, including their solutes, rather than creating an unlimited source or discarding outflow.

Controls:

- **Grab / drop water sphere** selects real parcels within the radius; click once to hold, move/look elsewhere, then click again to release. Held volume remains in the inventory. Radius is displayed in physical metres.
- **Wind brush** acts along the cursor ray while held; **Push water** gives a local impulse. Both are available in first person, alongside mouse-wheel tool selection, walking, jumping, and Space buoyancy.
- **Throw glass / mirror / rock** creates hollow glass with average density 220 kg/m³, a neutral-density mirror sphere at 1,000 kg/m³, or stone at 2,650 kg/m³. These use the same displaced-volume buoyancy and drag rules. There is no fixed body-count limit.
- **Tank / glass** offer x/y/z translation, tilt, signed axial rpm, and a sideways acceleration impulse. Position changes use damped motion; fluid contacts receive moving-wall velocity. Both vessels are open at the rim and can spill.
- **Dye** adds a strongly colored dissolved concentration locally; the river also has **Release dye at source**. Pairwise symmetric mixing preserves its inventory as it advects. **Tannins / organic load** is now a continuous material slider controlling amber absorption and volume scattering, including attenuation of underwater lights, caustics, and fine particles. River bed exchange changes the terrain, with a separate sediment ledger.
- **Ambient illumination** helps inspect the pool's underwater lights. **Pause**, **Reset station**, **CPU reference**, and **Compare GPU / CPU** are functional test controls.

The GPU evaluates three iterations of particle density constraints and wall projection, accumulates volume-normalized Gaussian density in a fixed bounded atlas, reconstructs connected optical surfaces, and traces refracted photon bundles to floor receivers. The implementation uses the position-based fluid constraint approach described by [Macklin and Müller](https://blog.mmacklin.com/project/pbf/). Projected Gaussian covariance bounds surface queries; low-order spherical harmonics provide directional environment lighting. Dense kernels blend together, while detached water and entrained air remain separate. The fixed atlas retains two density samples per parcel spacing, using instanced slice accumulation and hardware trilinear interpolation (manual interpolation where float filtering is unavailable). The beach keeps its separate sparse field. A speed-dependent render-resolution reduction uses the existing camera coarsening curve without changing the simulation.

CPU work currently includes spatial neighbor indexing, external-force prediction, readback and velocity updates, rigid-body coupling, solute mixing, and the sediment ledger. Neighbor lists are reciprocal so diffusion cannot silently create material. The **backend and timing diagnostics distinguish these paths**. Fine whitewater markers inherit the source flow, then follow lightweight GPU wind/drag, gravity or bubble-rise rules; they do not add liquid mass. Caustics are deposited by refracted light rays, not a scrolling texture. The current caustic receiver map covers the floor rather than arbitrary stacked surfaces.

`tests/water-lab.test.js` covers finite inventories, container transforms and rim openings, density convergence, reciprocal neighbors, solute conservation, buoyancy density classes, pickup/drop, pump recirculation, sediment exchange, local wind forcing, and solute placement. `tests/water-lab-gpu.html` compares GPU constraints against the CPU reference and runs every fixture, including moving/tilted/spinning vessels. It also checks the shared sparse density accumulator, protecting the beach renderer after its optional concentration-channel extension.

This is a focused **water development test**, not a declaration that water physics is complete. The default presets contain approximately 600–8,000 fluid parcels; waterfall/ocean spacing is coarse, and individual spray lobes can therefore be too large. Density projection, XSPH-style smoothing, and limited neighbor support are approximations, not a resolved Navier–Stokes turbulence model or a calibrated Reynolds-number control. Physical viscosity and a coarse capillary cohesion term now scale with physical spacing; calibration, richer vorticity, adaptive refinement, robust thin films, and continuous collision under extreme vessel motion remain work. Buoyancy uses a local free-surface estimate; body/fluid momentum exchange is approximate. Sediment erosion uses a simple shear/settling law, and solute mixing is a conservative numerical model rather than measured chemistry. Glass shells use a screen-space transmission approximation; underwater lighting and bubbles do not yet solve full multiple scattering. The current consumer-GPU preview remains below real-time in demanding stations, with CPU neighbor search, transport, and synchronous fluid readback still needing optimization. Simulated time and particle spacing are exposed so these limits are inspectable.

Local verification for this pass: 139 Node tests and the production build passed. The seven-station GPU fixture passed 100 steps per station with zero water-inventory drift and zero neighbor overflows; moving tank/glass cases used tilt and axial rotation. GPU density constraints differed from the CPU reference by at most `1.49e-7`, and the shared sparse accumulator differed by `7.34e-5` (tolerance `1e-4`). These are bounded regression checks, not long-run stability or physical-calibration guarantees.

### S-bend river and pond

The river occupies a bounded **24 × 80 m** footprint at default scale, with a long S-shaped channel feeding a wider pond. The banks slope gently into the basin. The fuller default contains **1,516.765 m³ in 5,786 parcels** at 0.64 m spacing, about 2.7× the water in the first long-channel revision. This remains within the default 8,192-parcel budget; increased scale/detail requests are capped by both that budget and a 0.18-unit atlas-spacing floor.

**Channel slope** ranges from 0–22%; changing it rebuilds the basin and resets the water and sediment. **Source water speed** ranges from 0–8 m/s and changes the initial velocity of future inlet parcels. Gravity drives downstream movement after injection; there is no continuous downstream force. **Pump flow** sets recirculation throughput, withdrawing parcels from the downstream pond without deleting their water or solutes. **View source**, **View pond**, and **Whole river** provide inspection positions.

Flow near the bed entrains material according to speed-dependent carrying capacity. Slower water releases suspended sediment. Every exchange removes/adds equal volume from/to a bilinearly sampled bed-stock field; the same displacement is used for GPU collision, CPU contact, shading and light occlusion. The diagnostics show cumulative eroded/deposited volume, current suspension and conservation error. This is an accelerated, empirical height-field sediment model, not calibrated river geomorphology or a volumetric bank-collapse solver.

The tannin control represents **dissolved and suspended organic load**, not a measured concentration of pure tannic acid. It increases amber absorption and scattering in the shared water material. A bounded single-scattering integration attenuates sunlight through water and tests terrain occlusion, allowing submerged light/shadow shafts where geometry and viewing direction support them. It does not paint rays over the image or simulate full multiple scattering. Higher concentrations eventually obscure the bottom and light shafts as absorption increases.

Verification: the 176-test Node suite and production build pass. `tests/water-lab-river-gpu.html` checks CPU/GPU terrain agreement at three slopes and an edited bed (maximum difference `5.73e-4`), the extended Gaussian density atlas (`4.04e-7`), dye/tannin render changes, and switching back to the pool's smaller bounds. A 240-step GPU run kept all 5,786 parcels finite with zero water-volume drift and zero neighbor overflows. Bed displacement ranged from −0.348 to +0.089 simulation units, with sediment balance error below `1.4e-7` model-volume units. The fuller live river still runs below real time on this preview hardware; the controls expose simulated time and frame/solver timings.

### Rain in Test 11

Every water-lab station has its own **Rain** toggle and **Rain rate** setting, remembered while switching stations. Rates are physical millimetres per simulated minute across all seven scene scales; the default is 5 mm/min, with accelerated stress-test rates up to 12,000 mm/min (100× the previous ceiling) for obvious accumulation and surface impacts. Rain pauses with the simulation. Switching rain off stops emission; water already falling continues to land, and deposited water remains.

Rain supplies fresh volume from the sky, rather than recycling the existing fluid. Falling packets use Gaussian splats and swept collision against the current SDF fixtures, moving vessels, rigid bodies, and water surface. An upright open vessel collects through its opening; an inverted bottom shields the interior. Contact transfers mass-weighted downward momentum into nearby fluid, so disturbances are simulated rather than drawn as ripple textures. Small wet deposits join the same Gaussian density field before enough water collects to create an ordinary GPU fluid parcel. Those parcels spread, pool, raise levels, and overflow using the shared solver. Water inventory now includes airborne rain and unresolved wet deposits, and the displayed drift subtracts measured rain input.

Falling rain now uses velocity-aligned Gaussian covariances with SH lighting and a narrow minimum pixel footprint, so distant drops remain readable. Emission rises with the requested rate (240 packets/second at 5 mm/min, capped at 1,200/second and 4,096 airborne packets), splitting the same physical input volume among more drops. Stable scattered sky samples avoid visible diagonal curtains. Rendering tests against actual water-surface depth instead of conservative splat bounds, and water along the view ray attenuates rain behind it. These packets are representative samples of precipitation, not individually resolved physical raindrops.

Precipitation packet transport, collision, and bookkeeping currently run on the CPU; Gaussian rendering and the resolved fluid remain on the GPU. Sub-grid deposits are a coarse wet-film approximation, and visible spreading/level change is limited by the existing fluid spacing. The parcel count grows with rainfall up to the configured water budget; further rain input then pauses. No evaporation or infiltration is modeled. `tests/water-lab-rain.test.js` checks station settings, physical rates, volume balance, dry-ground accumulation, impact momentum, and vessel shielding. `tests/water-lab-rain-gpu.html` exercises accumulation across GPU buffer-size changes and checks that new ground water remains finite and mass-balanced.

Rain verification: all 145 Node tests and the production build pass. The GPU rain fixture grew from 594 to 691 fluid parcels, crossed a buffer allocation boundary, and retained finite water with zero neighbor overflows and volume error below `1e-18 m³`. A live pool check with jets disabled confirmed impacts, local puddles, and growing resolved fluid inventory; long-run performance and thin-film fidelity remain limited by the coarse solver.


Rain visibility verification: all nine focused rain tests and the production build pass. The GPU on/off rendering fixture (`tests/water-lab-rain-visibility.html`) confirms visible airborne rain in the glass, pool and waterfall views, with finite output and physical-volume errors below `5e-14`. The accumulation fixture now runs 240 steps so the smaller, more distributed deposits cross the fluid buffer allocation boundary: 594 → 668 parcels, zero neighbor overflow, volume error `6.51e-19 m³`. The live waterfall was also inspected at the default 5 mm/min.

### Bounded resolution and fine whitewater stress tests

**Physical size** and **Water detail target** are coupled. Increasing a fixture's physical size requests proportionally finer normalized parcel spacing, preserving a physical minimum feature size instead of enlarging every blob. The target spacing is the smaller of the preset spacing in metres and 0.64 m, divided by the detail target. Small fixtures keep a sufficiently populated initial volume; the glass resolves millimetres, while large fixtures use coarse macroscopic parcels. The default waterfall is 14.4 m high and starts with roughly 7,000 bulk parcels (1.5× finer linear spacing than the original), with smaller mass-bearing blobs. Scaling changes optical depth as well as gravity: long paths preferentially absorb red light, whereas thin sheets remain clearer. Sky reflection contributes blue too; water material constants are shared.

Computation is bounded by **Bulk particle budget** (8,192 by default, up to 32,768 for stress tests) and a minimum normalized spacing of 0.11 for the bounded density atlas. Diagnostics report requested physical spacing, actual spacing, and an explicit limit when the requested refinement exceeds either budget. Rain stops supplying new volume when the same water budget is reserved, including airborne/deposited water; existing water is retained. Resolution changes reset the fixture and reseed its occupied volume on a finer lattice. Initialization has lattice quantization error; subsequent transport retains equal parcel volume and conserved inventories. Changing detail does not tune the material or simulation to the camera. Very small capillary time steps and high particle counts can advance slower than real time; the simulation/wall-time ratio is displayed.

**Fine spray / bubbles / foam** enables a separate 131,072-slot GPU particle pool. **Fine particle density** controls emission. Strong relative deformation and kinetic energy lost in the fluid constraint/contact solve trigger emission at exposed, disturbed water. Fast coherent translation, free fall, and rigid rotation alone emit none. The trigger scales its threshold with physical parcel spacing and rejects surfaces facing into the solid SDF. Source strength favors stronger events quadratically, with a short attack and release to retain coherent trails through momentary fluctuations. A small intense patch can consume more of the existing global emission budget; throttled marker debt is discarded so it cannot keep emitting after the event has ended. Falling interfaces shed ballistic spray; upward-facing interfaces favor surface foam and entrained bubbles. Emission concentrates at persistent, disturbed surface patches and samples their trajectories continuously, with a bounded rate of 65,000 markers per simulated second at 1×. These are small translucent white covariance-projected Gaussians with SH environment response. An additive screen-space optical-density field uses a tight, depth-aware 3×3 reconstruction kernel. The previous broad envelope and opacity boost are removed; connected shape comes from the moving emission sites and overlapping tiny Gaussians, without a broad glowing halo. Pump recirculation resets emitter history so it cannot draw a spray bridge across the fixture. This is a density field, not an SDF; opaque depth still clips the 3D markers. Surface markers and bubbles follow the local liquid; airborne spray responds to ambient wind and the cursor wind brush. They fade after roughly 0.05–2.0 seconds, with shorter lifetimes at small physical spacing. They remain visual tracers without added liquid mass; fluid advection and solid contacts are described below. At the largest scales a Gaussian represents a small patch of froth/mist rather than one resolved microscopic droplet. Marker radii normally remain below 8% of a resolved parcel spacing (with a microscopic size floor), screen filtering preserves Gaussian coverage, and the reconstructed optical surface determines underwater attenuation. The existing mass-bearing bulk and rain deposits still run through the water solver.

Per-frame physics work stops adding catch-up substeps after 12 ms (one expensive step can exceed that); fixed simulation time steps and the simulation/wall-time diagnostic remain separate from display FPS. Performance changes remove per-frame sparse-brick expansion from the bounded renderer, reuse the density atlas when simulation state is unchanged, combine transport/diffusion/whitewater metrics into one allocation-light CPU neighbor pass, and reuse neighbor lists until a conservative displacement margin is exhausted. Fine-particle motion and lifetime run on the GPU without per-particle readback; an explicit CPU reference remains available. This is still a coarse bulk-fluid stress test, not a resolved turbulence or droplet simulation, and a higher frame rate does not imply real-time simulated time at extreme scales.

Verification tools: `tests/water-lab-detail.test.js` covers size/resolution coupling, bounded refinement, conserved solutes, quiet/coherent/deforming/impacting flows, source persistence, rejection of solid boundaries, ballistic spray, bounded tracer counts, wind, lifetime, and neighbor-cache invalidation. `tests/water-lab-detail-visual.html` compares fine detail on/off and reports generation statistics by waterfall region. `tests/water-lab-detail-gpu.html` compares GPU tracer advection to its CPU reference, compares atlas density to analytical Gaussian sums, and checks the smallest/largest scale cases for finite positions and unchanged liquid volume. `tests/water-lab-performance.html` uses a fixed 480×450 render size, three substeps per measured frame, warm-up frames, GPU completion, and the original physical scales for comparison.

Current verification: 154 Node tests and the production build passed, followed by the focused water suite after the final visual tuning. GPU fine-particle advection matched the CPU reference within `7.58e-5`, including texture uploads crossing multiple rows and the ring-buffer boundary; the fixed density atlas matched analytical Gaussian sums within `1.49e-7` (both tolerance `1e-4`). Five scale/budget cases, including 29,140 fluid parcels, retained finite positions, zero inventory drift, and zero neighbor overflow over 75 steps. The seven-station fixture also passed 100 steps per station. The spray visibility fixture compares actual GPU particle state and rendered fine-detail on/off images.

Performance remains a limitation: the live finer waterfall measured around 9–10 fps at the inspected preview size, advancing roughly 0.16 simulated seconds per wall second. The fixed three-substep benchmark measured 466–518 ms median per frame across glass, pool, and waterfall in this session; it does not establish an overall speedup. Neighbor processing and synchronous GPU readback still dominate CPU frame time. The bounded budgets prevent unbounded refinement, but do not guarantee real-time operation.

Focused-emission verification: the full 156-test suite passed before the final per-source allocation change; the final 27 focused water tests and production build passed afterward, including a new check that 16 strongly disturbed parcels receive over 95% of emissions in a 1,024-parcel weak/strong comparison under the same global budget. Tests also reject coherent translation, free fall, rigid rotation and solid-facing sources, and verify impact/deformation response and source persistence. The GPU visual fixture produced 54,945 live markers matching its CPU inventory and a visible on/off difference after 120 waterfall steps. At step 30, 108 of 1,189 falling-sheet parcels met the revised eligibility threshold, compared with all 1,189 under the previous trigger in the corresponding CPU reference snapshot. These thresholds remain coarse aeration heuristics, not a resolved turbulence model.


### Detached liquid size variation

Detached water now has stable, downward-only reconstruction variation. Up to 384 isolated parcel families replace their single coarse kernel with four smaller Gaussian lobes, smoothly over simulated time. Fully separated lobe radii span roughly 16–82% of the previous isolated-kernel floor, with the largest share retained in one lobe and the remainder distributed among smaller ones. The five-kernel transition preserves the normalized density integral, solute concentration and center of mass; the coarse simulation still carries the same water volume. Dense or held parcels transition back to the connected bulk. Seeds are attached to parcel identity, not frames or the camera.

The GPU evaluates these small Gaussian sums analytically, avoiding a global atlas-resolution increase and sub-grid flicker. Their surfaces use the same absorption, refraction, Fresnel and SH lighting as bulk water, and share surface depth with the fine spray pass. The fixed family cap, five kernels per family and bounded ray queries keep this refinement finite. The diagnostics show the active family count. This is **surface reconstruction detail**, not independently simulated droplets: daughter lobes move with their parent, merging across separate refined families is approximate, and their tiny caustics are not included in the coarse photon atlas. `tests/water-lab-blobs.test.js` checks volume, center of mass, size bounds, gradients, stable seeds and bounded activation; `tests/water-lab-blobs-gpu.html` compares GPU density/gradients and renders isolated-liquid sizes before/after refinement.

Detached-liquid verification: all 161 Node tests and the production build passed. Across 4,096 sample points, analytic GPU density and gradients matched the CPU reference within `5.46e-6` (tolerance `1e-4`). The isolated rendering fixture retained finite surface depth and zero reconstruction-volume error, and the running waterfall was visually inspected with both liquid lobes and fine spray enabled.


### Whitewater scale, fluid motion and container contact

Emission now weights each active source by its **physical parcel volume** (`spacing × metres-per-unit`, cubed), local fluid support, exposed-air density and a capillary breakup gate using the existing water density/surface tension. The gate uses relative deformation or contact energy loss, not absolute travel speed. Sampling density outward along the surface normal suppresses buried turbulence under an intact surface. A finer discretization of the same physical volume therefore does not acquire an extra foam quota just because it has more parcels. Small volumes and already isolated parcels generate much less whitewater; quiet or surface-tension-dominated motion generates none. The fixed global emission/pool limits and focused source selection remain. No pool-, tank- or waterfall-specific foam multiplier is used.

Fine particles now query a GPU atlas of density and weighted liquid velocity at 0.75 parcel spacing. Bubbles follow the fluid with a small rise velocity; foam follows the free surface; dry particles become ballistic spray. New spray starts near the reconstructed interface and has a short release interval before reclassification, preventing the coarse density halo from immediately swallowing it. Spray keeps the existing wind response. Swept SDF contact stops fast particles crossing thin walls, and moving vessel transforms/velocities push contacting particles. Contact and a footprint clip also prevent Gaussian coverage leaking into solids. The CPU reference uses lazily sampled lattice values and the same contact/advection rules.

Particle shading integrates occupied water along the camera ray and samples the shared spectral light-transport atlas toward the sun and pool lamps, applying the shared water material's absorption/scattering extinction. Submerged particles consequently darken and lose red light with depth; empty air behind water is not counted as extra water thickness. Bubbles use dimmer lighting and opacity than surface froth, and the pool's colored lights illuminate submerged detail. The GPU computes these optical paths once per marker, rather than once per splat vertex. These remain bounded visual approximations: the flow grid is coarse, markers do not feed forces back into the water, and marker refraction/multiple scattering are not fully solved.

The separation of spray, foam and bubbles by their surrounding liquid and their differing advection follows the general approach in [Ihmsen et al., *Unified Spray, Foam and Bubbles for Particle-Based Fluids*](https://cg.informatik.uni-freiburg.de/publications/2012_CGI_sprayFoamBubbles.pdf); this implementation uses its own bounded grid, thresholds and scale weighting rather than reproducing that solver.

Verification: 169 Node tests and the production build pass. The GPU/CPU air-advection error remains `7.58e-5`; the wet-flow and moving-wall fixture differs by at most `1.06e-5` (tolerance `0.003`). A 75-step check of glass, pool, moving tank, pipe and waterfall retained finite states, zero liquid inventory drift and zero markers penetrating the solid SDF. The small moving glass emitted no whitewater in that short fixture; the large waterfall emitted 81,245 markers under the same material rules. These are bounded regression checks, not long-run physical calibration. `tests/water-lab-whitewater.test.js` covers scale/refinement, isolated-volume suppression, exposed-air generation, phase changes, flow sampling, fast/moving walls and spectral attenuation; `tests/water-lab-whitewater-gpu.html` exercises the GPU paths and renders all five scenes.

Fine whitewater now casts soft sunlight shadows on the ground, water, glass highlights and other fine particles. Overlapping Gaussian optical depths accumulate, so dense spray blocks more direct light while sparse mist has a weaker effect. Ambient SH lighting remains in shadow. The same attenuation reduces incoming caustic energy and directional volume scattering. Shadow density follows the live particle covariance, opacity and lifetime, including particles moved by wind; camera movement does not alter it.

The bounded sunlight deep-opacity map uses one GPU instanced draw into four 256×256 RGBA16F textures, packing 16 light-depth planes into 2 MiB. It reads the existing particle textures without CPU readback and reuses its result while particles are unchanged. A CPU reference/fallback implements the same footprint filtering and depth integration. The finite map and depth planes approximate light transport rather than solving full multiple scattering.

Shadow verification: all 179 Node tests and the production build pass. `tests/water-lab-spray-shadows-gpu.html` compares GPU optical depth with the CPU reference (maximum difference `0.00103`), verifies shadows only behind the cloud, checks clearing/disabling particles and camera invariance, and measures ground/water shading plus reduced caustic energy with shadows enabled. The running waterfall was visually inspected. The preview's active shadow-map pass measured roughly 8 ms; demanding water stations remain below real time.

The pool's three colored underwater lamps now have independent spray/foam/bubble shadows. Each wall-mounted lamp projects the live Gaussian covariance onto a 180° forward hemisphere, accumulating optical depth into 16 radial planes (more closely spaced near the light). Three 128×128 tiles share four RGBA16F targets, adding 1.5 MiB and one instanced GPU pass only when the pool lights and fine particles are active. Receivers on the floor, walls, water and other particles attenuate each lamp separately; blocking green can leave red and blue visible. Particle motion, expiry and disabling fine detail update or remove these shadows. The map is camera independent and cached while paused. A CPU reference/fallback uses the same projection and integration. This remains a finite-resolution, straight-ray shadow approximation, including for submerged bubbles; it does not refract light through individual air interfaces.

Balls cast sunlight shadows in every water-lab station and colored-light shadows in the pool, even with fine particles disabled. GPU analytic sphere queries use the existing body texture with no new ball limit. Rocks and mirrors block direct light; hollow glass transmits a Fresnel- and thickness-dependent fraction with weak spectral absorption. Shadows have a small filtered edge, retain ambient lighting, and also attenuate spray lighting and incoming caustic energy. Glass shadow transmission does not yet include focused caustics from the ball or multiple internal reflections. Moving, spawning or clearing bodies invalidates cached caustic lighting even while paused.

Mirror balls now reflect the actual colored lighting on the opaque pool receivers and the finite red/green/blue lamp disks. Small lamp reflections are filtered at pixel scale and share the particle/body visibility and water attenuation queries. This is a single reflected scene query; recursive mirror reflections and reflected fluid geometry are still approximated.

**Direct sunlight** is separate from **Ambient illumination**. Ambient controls the SH environment/sky fill; sunlight controls directional surface lighting, specular highlights, caustic illumination and the fine particles' solar contribution. Pool lamps remain independent of both. Foam now uses the reconstructed liquid normal for a broad microfacet reflection response to direct lights. Spray and bubbles use a view-dependent forward-scattering phase response. The GPU computes each foam normal once per marker alongside its optical paths. This is an aggregate shading approximation for unresolved droplets, not explicit microscopic bubble ray tracing. Turning ambient to zero no longer removes the direct lighting from whitewater.

Pool/ball shadow verification: all 184 Node tests and the production build pass. `tests/water-lab-pool-shadows-gpu.html` checks independent lamp visibility, disabled/expired markers, camera invariance, shaded ground/water, paused body motion, and ball sunlight shadows. A separate mirror-only pixel mask verifies colored reflections with the lamps on versus off; the whitewater checks compare its angular lighting with the CPU reference (maximum difference `1.64e-5`) and render sunlight-only/lamp-only foam with ambient set to zero. GPU Gaussian optical depth differs from its CPU reference by at most `0.00116`; sphere visibility differs by `8.35e-7`, including a blocker beyond the first body-texture row. The live pool was inspected with all three ball materials and roughly 35,000 fine markers. The additional active pool-shadow pass measured roughly 21 ms on this preview hardware; this adds rendering cost and does not resolve the existing real-time performance limit.

### Water-lab lighting and participating-medium shadows

The **Sky dome / ambient** control now uses the same procedural sky as reflections, with cosine-convolved SH for diffuse surfaces and foam. It contains no baked sun. **Direct sunlight** supplies the directional diffuse response, dielectric highlights and sunlight caustics. Pool lamps remain a third independent source, with the same color, distance falloff and visibility used by surfaces, volume scattering, whitewater and glass highlights. Rain follows these sources too. Setting all three source strengths to zero gives a black scene; combining them sums their linear contributions before tonemapping. Foam has a broad reflected lobe and a smaller transmitted lobe for submerged lamps; it no longer gets an unrelated constant direct fill.

Water and the moving glass containers now cast spectral, partially transmitting shadows. A camera-independent GPU atlas stores RGB optical depth toward the sun, each pool lamp and an eight-direction cosine-weighted sky hemisphere. Queries integrate actual occupied liquid and local dye/tannin/sediment, so air segments do not absorb light. Container SDF crossings add Fresnel loss and thickness-dependent glass absorption. Opaque fixture walls block light. The existing body and Gaussian spray shadows multiply this transport rather than replacing it. Receivers, volume scattering, submerged foam and incoming caustic energy all share it. Small refined liquid families retain a conserved parent-volume approximation in the shadow field, so removing them from the visible bulk atlas does not remove their shadows.

The atlas has 32 × 24 × 32 receiver samples for five light channels, packed into one 3840 × 32 RGBA16F texture (0.94 MiB), with at most 128 integration steps per ray. It updates with simulation/material/container changes, not camera motion. A second, coarser density atlas is used only when analytic liquid families are active. The CPU fallback samples the same density representation, and diagnostics explicitly report GPU or CPU medium transport. The sky channel averages transmitted radiance over eight fixed directions, weighted by sky color; it does not average optical depths or treat the dome as a single overhead lamp. This preserves side illumination around absorbing volumes. Lookup fades to clear transmission beyond the bounded atlas rather than extruding its edge shadow indefinitely. The extra sky rays add GPU work; the full simulation remains below real time on this preview hardware.

**Tannins / organic load** remains an artistic dissolved-plus-suspended organic-load control, not a chemical concentration calibration. It now increases absorption faster than scattering toward the upper end, giving tea-colored thin paths and dark, obscured deep water instead of an increasingly bright brown fill. The same coefficients govern view attenuation, volume scattering, colored-light paths, water shadows and caustic transmission. Scattering uses a normalized forward phase function and exponential segment integration, so dense water does not gain light from taking larger numerical steps. Background and fine-marker attenuation also include local solutes. This follows [Beer transmittance](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance) and [normalized phase functions](https://www.pbr-book.org/4ed/Volume_Scattering/Phase_Functions); the organic-color direction is motivated by [NASA's description of dissolved and suspended material in water](https://eospso.nasa.gov/sites/default/files/publications/Ocean%20Color%20Activity%20Brochure_Z_Card_508.pdf).

Submerged glass is shaded along the water's refracted ray before the water's foreground scattering, absorption and Fresnel reflection are composed. The final glass-shell pass only draws glass that is closer than the water. This prevents submerged balls from drawing highlights on top of the water surface. The water/glass interface also uses the lower index contrast of those two materials.

These remain bounded approximations: sky visibility uses eight directions and a world-up receiver hemisphere rather than a per-normal, fully converged visibility integral; shadow transport uses straight segments rather than refracted shadow rays; the filtered atlas softens small shadow features; volume rendering is single scattering; glass refraction and internal paths are approximate. Container-focused caustics and multiple internal reflections are not solved by this pass.

`tests/water-lab-lighting.test.js` checks Beer-law path lengths, physical scale, organic-load behavior, moving-vessel transmission, blockers, SH convolution, phase normalization and independent foam lighting. `tests/water-lab-lighting-gpu.html` compares GPU transport and the CPU reference, compares the complete small atlas fallback, isolates all three light sources, checks tinted water and empty-container shadows, and tests submerged-glass depth ordering. Existing pool/ball/foam/mirror GPU regressions also remain covered.

Lighting verification: all 190 Node tests and `npm run build` pass. The medium GPU/CPU ray comparison differs by at most `2.23e-6` optical-depth units; the complete small atlas differs by `8.42e-5` in transmission. Independent source sums differ from simultaneous lighting by less than `1e-6` in linear RGB. The submerged-glass regression checks 7,550 pixels with water in front of the ball and finds zero final-shell overwrite, while the refracted water pass still contains the glass. The existing pool/ball/mirror/whitewater GPU fixture passes. The live pool was inspected with all three ball types and about 47,000 visible primitives, and high-load river/tank views were inspected as well.

### Water-lab wall support and shoreline spray

Fluid pressure now includes the portion of its kernel support occupied by the nearest SDF boundary, using a locally planar poly6 integral and gradient in both GPU and CPU solvers. This removes the artificial density deficit that piled water up beside container walls. Wall velocity coupling uses the water viscosity and physical sampling distance instead of a constant drag that resisted drainage. The boundary treatment is local and approximate around tight corners and thin walls; it does not model glass wetting/contact angles or a physical meniscus.

Fine-marker generation uses slightly earlier impact/deformation thresholds across all lab stations. An exposed, actively breaking upward-facing surface retains its foam supply and emits up to 40% additional ballistic spray. Fractional emission accumulates, so small, repeated runback events are not rounded away. Existing air-exposure, neighborhood support, physical-volume and capillary gates remain active. There are no shore- or scene-specific emitters. The fine-particle density control now reaches **20×**, up from 3×, while keeping the same **131,072-marker** allocation and recycling oldest markers when saturated. High density can cost more rendering time; it does not increase liquid mass or solver resolution.

`tests/water-lab-boundaries-gpu.html` settles the tank at 44° and checks water inventory, solid clearance and edge height. The wall-edge rise fell from 0.223 m to 0.031 m after 560 identical simulation steps. The built-in CPU/GPU verification also exercises a tilted boundary and held parcels, with maximum position difference 0.000919 simulation units (tolerance 0.002).

Verification for this pass: all 193 Node tests and `npm run build` pass. The seven-station GPU run retained finite water, zero volume drift and zero neighbor overflows, including moving/rotating vessels. The lighting regression passes independent-source, tinted-shadow, outside-atlas and submerged-glass ordering checks; sky-atlas GPU/CPU transmission differs by at most `8.42e-5`. The live ocean was inspected with 61,000 fine markers at 1×, then with sunlight 0, ambient 1.5 and organic load 2.62. The live high-performance graphics context reports boundary agreement within `8.58e-6`; the standalone context reports `9.19e-4`, both below tolerance. Rendering remains below real time. The 20× control is a bounded stress setting, not a performance guarantee.


### Breakup-driven whitewater and submerged illumination

The shared transport pass now measures outward velocity relative to neighboring liquid at the free surface. This identifies stretching crests and sheets before they separate, with a speed threshold from surface tension and the resolved gravity scale. Contact activation also includes momentum turning, so redirecting a stream can aerate it even when its speed is unchanged. All parcels can supply this breakup signal; the original persistent sampled emitters still supply the existing impact/foam pattern. Birth rates retain physical-volume, capillary and air-exposure weighting, with the same fixed marker allocation and global rate limit.

A breakup event keeps its connected, exposed-air weight for a short 0.12-second decay as support falls away. Newly detached liquid therefore leaves a brief fine-spray trail. Coasting isolated blobs cannot start or indefinitely sustain this source. If water closes over a recently exposed source, its remaining burst becomes entrained bubbles. Held water, solid boundaries and recirculation teleports clear the history. This is a bounded unresolved-breakup model, not independently simulated or mass-bearing microscopic droplets. Bulk mass stays with the solver parcels. Detection and emission bookkeeping remain on the CPU alongside the existing neighbor transport; marker advection, collisions, optical-path integration and rendering run on the GPU when available.

Submerged markers now retain the light scattered through foreground water, instead of applying extinction alone over an already lit water image. Bubbles receive a larger transmitted direct-light response while remaining less reflective and less opaque than surface foam. A bounded diffusion term approximates light redistributed within dense whitewater clusters; it applies to both the sun and colored pool lamps, remains multiplied by water/body transmission, and creates no light when the sources are off. Water extinction and local solutes still darken and color particles with depth. These are straight-view-ray, single-scattering water paths plus approximate cluster diffusion, not full refracted or multiple-scattering transport.

The GPU computes lighting once per marker into three cached RGBA16F attachments, then projects and composites the covariance Gaussians. Moving shadow queries out of the splat fragment shader keeps both marker programs within the 16-sampler budget. Camera and simulation resolution remain independent. Very high fine-particle density can still saturate the fixed ring buffer and reduce frame rate.

Validation includes translating/rotating quiet flows, extending surfaces, equal-speed impact turns, pinch-off history, submerged air entrainment, clearing held/recycled sources, resolution scaling, direct-only submerged bubbles at two densities, and zero radiance with all lights disabled. The GPU water-path/diffusion reference differs by less than `9.3e-8`; air and wet-marker advection remain within `7.58e-5` and `1.06e-5` respectively. The live high-wind 20× stress check illuminated every active marker in the 131,072-marker pool. Cast shadows remain visible on the water when marker drawing is disabled; these are distinct from the former black-particle shading bug.

Final checks for this pass: **199 Node tests**, the production build, and the lighting/colored-pool GPU regressions pass. The two fine-marker shader programs use **15 and 10 samplers**. Six GPU fluid cases (including 240 steps of the windy ocean) retain finite state, zero water inventory drift and zero SDF penetrations. At normal density the short moving-glass run emits zero markers; the waterfall emits 81,361 under the same rules. The interactive ocean was also inspected after 6.68 simulated seconds, with direct sunlight 3, sky ambient 0 and wind 67 m/s.

### Weather, underwater visibility and surface wetting

The lab now includes **Movable glass pane / surface wetting**. It starts dry and shares the existing physical-size control, rain, water material, glass optics, gravity and wind with the other stations. Position, tilt, pitch, axial orientation and spin controls move its collision field and attached wet deposits. **Splash pane** adds a measured water pulse; its volume is included in the rain/input ledger. Rain and connected films become ordinary fluid parcels when enough volume collects. Smaller glass drops remain pinned below an approximate capillary threshold and drain more slowly as they grow. Turning or moving glass carries its wet patches. This is surface wetting, not temperature/humidity-driven vapor condensation.

Rain insertion now searches separated, low, neighboring surface locations, accounting for both existing and newly queued parcels. Deposits stay at impact patches instead of following the first rising particle. A spatial reservoir index joins nearby liquid or glass film without repeatedly injecting overlapping parcels. Incoming impulses are limited at unresolved packet scales. Fractional water stays in reservoirs, so the budget and rain-to-water volume ledger remain explicit. This is a coarse deposition scheme rather than a resolved thin-film solver; extreme rainfall remains an expensive stress setting.

**Wind turbulence** is independent of the inlet's laminar/turbulent forcing. A shared three-dimensional gust field drives exposed water, exposed balls, rain and airborne detail. A bounded 32 × 24 × 32 GPU air grid deflects the local flow tangent to visible solid surfaces and shelters downwind samples. It includes glass, terrain, balls and the pipe (whose previously missing fluid collision SDF is also restored). The CPU reference uses the same field and interpolation. This is local slip/shelter approximation, not a pressure-projected airflow simulation or a fully resolved wake.

**Airborne mist** has its own toggle and density slider. It is a fourth fine-Gaussian category with smaller covariance, stronger air drag, low settling speed and longer lifetime. Breaking/impacting exposed water and rain impacts supply it; the existing foam supply is retained. Mist shares the fixed 131,072-marker pool and lighting/shadow paths, and expires at the finite airborne bounds. Fine-marker motion, solid contacts, air-field evaluation, lighting and Gaussian rendering run on the GPU when available. Bulk neighbor/solute work, rain bookkeeping and a bounded sample of wetting trajectories remain on the CPU. Those sampled spray/mist trajectories create optical wet patches, not extra solver mass.

In first person, a kinematic player capsule now participates in the same GPU/CPU fluid collision constraints and transfers boundary motion into nearby water. The resulting disturbance feeds the existing breakup/splash detector. The walk controller excludes its own collider. The camera has a small virtual wet pane: rain, sampled splashes/mist, and emerging from water create coalescing, draining refractive drops. **Camera water droplets** toggles it and **Wipe camera** clears it. Lens bookkeeping is limited to 64 drops; a small GPU optical field supplies the final refraction. This is an optical overlay, not a thermodynamic condensation model.

An underwater camera now integrates occupied liquid to the exit or solid receiver instead of treating its eye as an air-to-water surface. Fine markers apply the occupied foreground-water absorption and scattering even when they are closer than the visible exit surface. The same material and solute coefficients therefore reduce underwater contrast with distance without a separate arbitrary blue fog color. Exit reflection/refraction and multiple scattering remain approximate.

`tests/water-lab-weather.test.js` checks wind controls, tangent flow, mist transport, separated rain deposition and conservation, glass adhesion/pooling, transformed pane geometry, player clearance, camera droplets and rain shelter. `tests/water-lab-weather-gpu.html` compares GPU air samples and fine-marker advection with their CPU references, checks underwater optical falloff, and supplies pane/rain, waterfall/mist, player-wake and maximum-rain stress views. Measured air-field agreement was within `3.25e-5` scene velocity units and free-marker agreement within `7.78e-5`. The 240-step maximum-rain tank remained finite, with volume drift below `7e-10 m³`; the player fixture preserved inventory and kept the liquid outside its capsule. These short bounded tests do not establish long-run physical accuracy or real-time performance at the extreme settings.

The final pass also runs the original free-fluid and tilted-wall GPU/CPU constraint comparison (maximum error below `9.2e-4`, tolerance `0.002`), all **208 Node tests**, the production build, and the material-lighting GPU regression. The preview reports the active GPU backend; CPU rain/wetting work remains explicitly listed.


### Rain accumulation, mist and frame pacing

The waterfall has a **Waterfall height (resets water)** slider. It moves the ledge, source and initial sheet together, with the displayed height in physical metres. At the default waterfall scale its range is 3.6–21.6 m. Rain transfers downward momentum into the liquid and redistributes it into an outward crown with zero additional net momentum. The same impact mechanism applies to every station, including still pools. All incoming water remains in airborne packets, wet reservoirs or bulk parcels; the existing finite bulk budget pauses further input when full.

Rain appearance uses short velocity-oriented covariance Gaussians, with round, highlighted droplets at miniature scales. Larger fixtures and finer water resolution receive more GPU appearance samples per mass-bearing packet (up to 64); these samples do not duplicate deposited mass. CPU precipitation is bounded at 480 packets per simulated second and 4,096 airborne packets. Surface columns reject irrelevant collision queries, deposit conversion runs in bounded batches, and sub-parcel deposits remain visible while waiting to join the bulk. This is accelerated, bounded precipitation rather than individually resolved meteorological raindrops.

Mist is emitted from the strongest exposed impact/breakup sources that already generate foam, using a stricter energy/activity gate. It starts just outside the liquid interface with reduced inherited water velocity, so wind can carry it away as a soft plume instead of immediately turning it into submerged foam. It retains its own toggle and density control. Ordinary small rain impacts generate spray rather than a fog source everywhere.

Fine-marker lifetime now depends on contact: airborne spray consumes lifetime at 2.2×, wet foam/bubbles at 0.12×, and wet foam near another foam/bubble marker at 0.025×. Mist keeps its separate lifetime until it joins the water. A camera-independent GPU proximity grid stores two representative IDs per cell and checks exact distances; this bounded approximation can miss contacts in very crowded cells. The CPU reference uses the same rule. The shared 131,072-marker ring remains fixed and can recycle persistent foam at high density. The displayed marker inventory is a conservative upper bound, not an exact GPU live-particle count.

The earlier interactive scheduling pass used fence-based asynchronous readback with one outstanding solve, guarded against station resets and backend changes. The current physics-priority default is described below; the async path remains available for numerical comparison. Rendering reuses unchanged views while a solve is pending; optical passes only visit populated marker rows. Spray/lamp shadows use at most 16,384 weighted representative markers per light, and water shadow transport updates at 15 Hz of simulated time. **Adapt image resolution to GPU load** bounds the water image between 50% and 100% of its requested dimensions independently of simulation resolution. This can soften the image; the checkbox disables it for inspection.

Validation: 216 Node tests and the production build pass. Async and synchronous GPU constraints agree exactly; the existing fluid CPU/GPU reference differs by at most 0.000919 (tolerance 0.002). Foam-contact decay agrees within 2.69e-9, wind within 3.25e-5, and fine-marker transport within 7.78e-5. In `tests/water-lab-precipitation-gpu.html`, 360 rain steps at 4,000 mm/min raised the pool surface by 0.104 m; the dry pane collected a roughly 0.041 m puddle with 124 bulk parcels above the pane. Water ledger drift stayed below 6e-10 m³. These are short accelerated tests, not unlimited-duration guarantees.

On this preview machine, the rainy-pool benchmark's median displayed frame time fell from 52.1 to 28.6 ms, its 95th percentile from 176.6 to 76.0 ms, and its worst observed frame from 221 to 116 ms after the scheduling/shadow changes. The final image scale in that run was 51%. The simulation completed only 48 fixed steps in 5.55 wall seconds, so displayed frame rate must not be confused with real-time physical progression. CPU neighbors/transport, rain and wetting remain costs; maximum rain, dense foam and large images can still stutter. The UI reports simulation speed, backend, image scale and pass timings explicitly.

The 240-step coarse-tank run at the 12,000 mm/min ceiling remained finite, with 1,225 impacts and mass drift below 2e-13 m³. The material-lighting, colored pool/ball/mirror and spray-shadow GPU regressions also pass after the shadow budget changes. The live 19.5 m waterfall was inspected with 6 m/s wind; it still showed substantial CPU prediction/transport stalls at dense foam settings, so the pool benchmark improvement should not be read as a blanket frame-rate guarantee.

### Water-lab timing, inlet flow, and sediment refinements

- Simulation speed is a 0.05–2× requested-time multiplier. Every foreground frame contributes elapsed time, including frames awaiting GPU results. Pending work can start between display frames. A bounded 0.5 s backlog prevents runaway catch-up after suspension; diagnostics distinguish achieved simulation speed from FPS and requested speed. Fixed physics steps are capped at 1/30 s (smaller at miniature scales / the capillary limit). Camera look remains immediate; walker physics and lens drainage use the speed control.
- GPU readback uses a pixel-pack buffer and fence, checked by frame updates as well as timers. Bulk wind forces reuse the asynchronously read GPU air lattice, with direct CPU evaluation retained as the reference/fallback. Lens-only changes composite over the cached world image instead of rerunning all water passes. CPU neighbor construction, bulk prediction, chemistry/sediment, bodies, rain accounting, and wetting still remain CPU work.
- Mist has a 7–12 s emitted lifetime with a fade spanning most of that lifetime. Fine particles collide with actual fixtures and bodies but can cross the invisible bulk-fluid boundary. Visible opacity and sun/pool-light shadow opacity use the same fade. Rain appearance samples occupy independent columns and fall phases rather than tight bundles around mass packets; individual births fade in briefly. Doused or glass-shed drops keep their local trajectories. Rain lighting and conserved mass accounting are unchanged.
- The pipe uses evenly spaced inlet stencils, a matching discharge rate, and coherent parallel velocities at zero forcing. Turbulence adds transverse velocity and small inlet perturbations; downstream aeration still follows the common deformation, breakup, and impact criteria. A 100-step comparison produced a connected zero-forcing jet and an irregular, wider stream at forcing 2 (5,426 versus 8,289 fine markers in that run).
- The river occupies a 24 × 240 m bounded basin at default SI scale, with more bends and 22 faceted SDF rocks. The bed has 2.4 simulation metres of movable stock. Suspended sediment transfers conservatively to lower liquid neighbors before bed exchange; low transport capacity and settling build deposits in the same collision/render field. Sediment-laden pond parcels wait before recirculation. Initial geometry supplies the basin only: there is no bend migration, cutoff, or oxbow script. Long-term oxbow formation has **not** been established by these tests; this is still a simplified sediment / erodible-height-field model.
- Player normal momentum coupling and nearby fine-particle generation are each reduced to 72% of their previous strength; the capsule still displaces its full volume.

Validation: 222 Node tests and the production build pass. Browser GPU comparisons passed for constraints, asynchronous versus synchronous readback (zero difference), wind / fine advection, sun and colored pool-light spray shadows, and river geometry. The 50-step river run both eroded and deposited sediment with a combined bed-plus-suspended drift of about 8.3e-8 simulation m³. The existing bundle-size warning remains.

Performance limit: correcting the clock is not a claim that every requested rate is attainable. On this preview's Intel UHD 630, the isolated quiet-pool run improved from roughly 0.22× to 0.25× simulated/wall time with the new readback path; median display interval was 16.5 ms, but readback/driver latency and heavy effects still limit simulation throughput. Sustained 1× simulation on this hardware remains unfinished. The speed control is a target; watch the achieved rate. A GPU-resident bulk pipeline that avoids per-step round trips is still needed to remove that remaining bottleneck.


### Physics-priority playback, wet surfaces, and foam shadow fill

The water lab now targets **15 displayed frames per second**, spending more of each interval on fixed GPU constraint steps. It uses synchronous bulk readback by default to avoid waiting a browser/driver round trip for every tiny step; the guarded async path and CPU reference remain available. Up to 48 steps share a 100 ms soft physics work limit, checked between steps. This prioritizes progression, so expensive frames can exceed 66.7 ms. The existing 0.05–2× speed slider, 0.5 s maximum backlog and achieved/requested-rate diagnostics remain. Image adaptation starts earlier, while simulation spacing stays independent of camera LOD.

The small cup's step now follows resolved physical spacing, gravity and capillary bounds rather than an arbitrary scale-only cap. At default size it advances in roughly 19.7 ms steps; genuinely microscopic scales still require much smaller steps. Cup/tank/pane diagnostics show actual RPM, and a narrow etched index on the circular cup makes rotation visible. The glass still transfers motion through its physical wall interaction, rather than directly rotating the liquid.

Holding Space supplies enough buoyancy at partial immersion to float. Occupancy is sampled around the capsule rather than in the cavity it displaces. Player momentum transfer is reduced to 18% of the original strength and local fine-marker emission to 20%; projection-added outward impulses are damped as well. The full geometric displacement remains. Walking and lens drainage keep elapsed time when displayed frames are slower.

Spray opacity is reduced by 35%, and rain by about 39%. Spray/foam opacity starts fading near 4% of its lifetime instead of 45%, making disappearance more gradual without extending its death time. Contact-dependent foam lifetimes are unchanged. The same opacity function drives rendering and sun/colored-light shadows.

Rain, splash, foam, bubbles, and mist now collect on the camera or test surfaces. Camera collection includes relative camera motion. The wetting sample reserves up to 64 trajectories per category (256 total), so abundant mist cannot evict every foam tracer. Tiny mist beads merge by volume and dense repeated hits build visible wet patches. Glass spots remain attached to the vessel; other solid patches produce wet sheen, and ball patches follow their centers. Limits are 64 glass patches, 32 other surface patches, and 64 camera beads. These are optical wetting tracers from unresolved fine water, not added bulk solver mass or thermodynamic condensation. Rain continues to use its conserved reservoir.

Foam shadows on the floor now include a bounded approximation of diffuse transmission through scattering whitewater, filtered over a footprint that expands with water optical distance. Water/glass absorption and body occlusion still attenuate that light. It operates on surface receivers only; volumetric extinction and the god-ray calculations are unchanged. This is a high-albedo diffusion approximation, not a complete multiple-scattering transport solver or a distance-field shadow mask.

Validation: **231 Node tests** and the production build pass. Browser checks cover floating then sinking, naturally collected camera rain, foam/mist wetting, and the new floor contribution. The floor diffusion GPU formula matches its CPU reference within 3.43e-8; its image comparison brightens over 10,000 affected floor pixels. GPU constraints match the CPU reference within 9.19e-4 (tolerance 0.002). Wind, fine advection, sunlight shadow maps and colored pool-light/ball/mirror regressions also pass. Collected surface beads change over 28,000 pixels in the close glass-pane comparison.

On the Intel UHD 630 preview at a 640 × 480 requested image (50% final adaptive image scale), the quiet pool advances at **0.994×** real time with a 67.3 ms median display interval. The 30 RPM cup advances at **0.989×**, with a 74.2 ms median interval and measured 30 RPM in simulation time. The rain-heavy pool at 1,000 mm/min and the full 131,072 fine-marker budget reaches only **0.616×**, with a 125 ms median interval. These bounded 90-frame checks retain finite state and water ledger error below 5e-10 m³. The larger live ocean (7,308 bulk parcels plus a full fine-marker pool) remained much slower, reporting roughly 0.16–0.22× progression and about 5 FPS during the visual check; the saved ocean screenshot is paused. Heavy effects still miss both realtime progression and the 15 FPS target; removing bulk CPU/GPU round trips remains the larger architectural task. The build retains its existing bundle-size warning.

### Test 12 — bounded sand / water beach

Open `/?scene=sand-lab`. Tests 01–11 are retained as development snapshots: their source files are unchanged, and `tests/scene-snapshots.json` records their hashes. Test 12 has a private copy of the water-lab pipeline under `src/sand-lab/`; it imports the same water material constants without modifying them. The new entry point routes into this scene without constructing the older experiments or touching their saved edits.

**Scale / resolution**, at the top of the controls, contains independent sliders for water resolution and beach width. The default is a 110 × 98 m footprint, a nominal 16.5 m deepest water column, and 12,852 bulk parcels (1.91 m sample spacing). Resolution ranges from 1–3× the base lattice, with a 32,768-parcel capacity and a minimum normalized spacing. Physical width ranges from 44–220 m and scales depth as well. Either slider resets only this test; the current count and physical spacing are shown alongside it. Increasing physical size alone does not secretly allocate more particles. The resolution slider changes the simulation and reconstructed surface, independently of camera coarsening.

Sand stores conserved solid-grain volume, packing fraction, moisture, and plastic memory on a 65 × 65 bed. Grab/drop sand removes that volume from the bed into mobile, unequal aggregates; settling gradually shrinks the aggregates as their material enters the bed. Push first compacts wet material toward a finite packing limit, then mobilizes it. Object impacts do the same. Dry aggregates begin with an effective density below water, progressively saturate, and sink; this is a porous-clump approximation, not a claim that individual quartz grains float. Wet sand has increased cohesion and retains its deposited/compacted structure as moisture dries over minutes. Slope transport carries moisture and packing with the grain mass. The bulk bed remains a height field evaluated as an implicit collision/render surface, with volumetric smooth-unioned loose aggregates: overhangs, enclosed caves, resolved pore pressure, and a full granular continuum solver are not implemented here.

The interaction menu offers push/compact sand, grab/drop sand, push water, grab/drop water, wind brush, spawn object, and grab/drop an existing object. Glass floats, mirrors are nominally neutral, rocks sink, and the neutral light material emits colored illumination. All four support spheres and open cups. The color picker changes the latest spawned body; tilt, pitch and spin affect the held/latest body. Hollow cups use their actual wall/bottom SDF against water and loose sand, and orientation-aware support against the bed. Cups enforce a minimum radius of 1.9 water spacings so the opening can be resolved. Body-to-body contacts and buoyancy remain approximate; cups are not a sealed trapped-air simulation. Object count is not artificially capped.

Water retains the ocean station's material, Gaussian density reconstruction, covariance-projected fine Gaussians, spherical-harmonic sky response, refraction, caustics, spray, mist, wetting and accumulated rain. Day/night controls move the sun while the moon stays fixed. Colored emissive objects light nearby sand, water and fine particles with water extinction and body occlusion. First person retains gravity, jump, Space-to-float, and a displacement capsule. The player and interaction sizes are converted using the selected physical scale.

GPU workloads include liquid density constraints, velocity/solute transport and breakup metrics, the obstacle-aware air field, fine-marker motion, density reconstruction, optical transport and drawing. CPU work includes neighbors, force prediction, sand exchange, rigid-body motion, rain bookkeeping and wetting. A CPU reference remains selectable. Metre-scale water can use steps up to 1/15 s, reduced by gravity and capillary bounds; the existing predictor limits travel per step. Camera motion and distance affect drawing only. Other bounded costs include 32,768 fine markers, coarse volumetric shadow transport, and less frequent caustic updates. Diagnostics report actual simulation/wall-time ratio separately from FPS.

Validation includes conservation through sand extraction/settling, finite wet compaction, slow drying and retained shape, wet/dry buoyancy, tilted cup support/contact, bounded resolution and snapshot integrity. **Verify GPU numerically** compares the copied PBF constraints, new sand/cup SDF, and GPU transport against CPU references. `?scene=sand-lab&paused=1&qa=1` additionally exposes sand and object fixtures plus a bounded 45-frame timing check.

Final checks: all 243 Node tests passed, including preservation of the previous scene modules, and the production build passed with its existing bundle-size warning. The GPU comparison measured a sand/cup SDF error of 2.72e-7, constraint-position error of 1.86e-4 (tolerance 0.002), and transport error of 1.53e-5 with identical neighbor counts. Live inspection covered the finer beach, extracted sand, hollow mirror-cup pickup, and recoloring an emissive cup with the reflected illumination changing accordingly.

**Performance limitation:** the larger default is a stress setting on this preview machine. A 45-frame run at 12,852 bulk parcels and 32,768 fine markers took 10.23 wall seconds to simulate 3.00 seconds; median displayed interval was 200 ms and the 95th percentile 333 ms. A released-sand run preserved grain volume within 2e-15 relative error but likewise did not reach realtime. Moving water transport to GPU, limiting shadow resolution/cadence, and using distance-dependent surface sampling do not remove the remaining CPU neighbor/emission cost and bulk GPU readback bottleneck. The high-detail default does **not** meet the 15 FPS / 1× physics target on this hardware. Lower resolution is available explicitly; camera LOD never silently lowers physical water resolution.

The rain stress check at 12,000 mm/min added 90 bulk parcels (626.21 m³ at the default spacing) in three simulated seconds, with sand-volume drift below 7e-15 relative. This confirms positive accumulation in the new fixture, not meteorological accuracy at that intentionally extreme input. The 3× resolution endpoint creates 29,808 water samples; a 220 m width produces a 220 × 196 m footprint and 33 m nominal depth while keeping that sample count bounded.

### Test 12 — shoreline, camera stability and carving follow-up

Near-camera spray/rain now fades continuously before the perspective footprint diverges. The fine-particle optical pass uses the projected support, rather than only the particle center, to decide visibility; uncomputed lighting is explicitly invalid and cannot composite as black. Empty density gradients have a finite normal fallback. Above-water and submerged 30-frame camera sweeps each produced zero non-finite samples and zero fully black sampled pixels. These are targeted regressions, not a claim that every possible camera/material combination has been exhausted.

At solid contact, water reconstructs with volume-normalized, tangent-aligned anisotropic Gaussians. Thin boundary sheets remain part of this continuous reconstruction instead of being mistaken for detached multi-blob droplets. The sand surface uses matching CPU/GPU cubic B-spline reconstruction; deposition spreads grain volume across a wider smooth footprint, and erosion emitters no longer sit on a recurring regular sampling pattern.

**Carve sand sphere** and **Carve water sphere** use the interaction-radius control. Sand carving removes a spherical intersection from the exposed column stock, records removed grain mass, and produces a surface crater. The height-field limitation still applies: this does not create underground sand tunnels or overhangs. Water carving removes the selected bulk samples and remaps surviving state/emitter histories; existing free spray persists. Water can subsequently flow into the opening. FPS and actual simulation/wall-time ratio are always shown with the lower-left interaction text, including when controls are collapsed. The realtime diagnostic now includes long frame intervals rather than using the capped physics interval as its denominator.

Optimizations include symmetric typed neighbor lists built by occupied cell pairs, reuse within the neighbor-list margin, skipping zero-support constraint gradients and inactive foam emitters, tighter anisotropic atlas bounds, fewer unused atlas slices, and reusing incident-light estimates along each fine-marker optical path. Distant water drawing uses larger optical integration steps; camera motion/distance still does not alter simulation resolution.

Validation: **249 Node tests** and production build pass (existing bundle-size warning). GPU comparisons pass: sand/cup SDF error 1.08e-7, constraint-position error 1.05e-3 (tolerance 0.002), transport error 7.63e-6 with identical counts, and anisotropic reconstruction error 6.42e-7 (tolerance 1e-4). Tests 01–11 remain byte-for-byte unchanged. Direct viewport clicks and the carving fixture were inspected; the fixture removed 142 water samples and balanced the sand ledger within 2e-13 normalized grain-volume units.

Performance remains limited at the large default. In the same 45-frame preview workload (12,852 bulk / 32,768 fine), median frame interval changed from 316.9 to 300.0 ms, p95 from 482.6 to 466.6 ms, and three simulation seconds took 14.54 wall seconds (~0.206×). A separate four-run neighbor benchmark at 12,852 samples improved from 80–109 ms to 45–75 ms, with zero neighbor overflow. These gains do not achieve 15 FPS or realtime physics on the Intel UHD 630 preview; the full bulk/fine GPU workload and synchronous bulk readbacks still dominate. Water resolution and particle budgets were not secretly lowered to improve these numbers.

### Test 12 — atmospheric sky

The sky now integrates wavelength-dependent Rayleigh single scattering and a small forward aerosol contribution in a spherical, exponential atmosphere. Earth occlusion produces twilight and night; solar-path extinction colors the direct sun, and the stationary moon supplies a dim night sky. The transport formulation follows the [atmospheric scattering reference](https://ebruneton.github.io/precomputed_atmospheric_scattering/), with bounded quadrature rather than its full multiple-scattering precomputation. This pass does not add weather, clouds, or aerial perspective through the local scene; the lower environment hemisphere uses approximate ground bounce.

A cached 192 × 96 GPU sky texture supplies the background and water/glass/mirror reflections. CPU projection of 64 directions updates the shared spherical harmonics for sand, objects, foam and rain only when the solar angle changes. Existing **Time of day**, **Day / night cycle**, **Sky ambient**, and **Direct sunlight** controls remain separate. Diagnostics show the sky backend; the CPU reference backend builds a smaller 48 × 24 sky texture with the same equations. Tests 01–11 remain unchanged.

All 254 Node tests and the production build pass. GPU/CPU comparison across 18 daytime, grazing-angle and twilight rays measured maximum linear-radiance error 2.27e-6 (tolerance 1e-4). Daylight, sunset, night, reflected sky and the CPU sky fallback were checked in the local preview, with no shader errors.

### Test 12 — air-supported cups and player splashes

Cup buoyancy now integrates the submerged outer volume at its current orientation and includes the mass of water actually inside the cavity. The surrounding surface is estimated from nearby bulk-water parcels outside the cup; it is not inferred from the empty interior. Filling replaces buoyant air space with carried water, and draining releases that load. Parcel mass is neither created nor deleted. This is a local hydrostatic buoyancy approximation with a planar exterior surface, not a compressible gas-pressure or sealed diving-bell solver. Body buoyancy and sampling run on the CPU against the existing local fluid index; water constraints and transport remain on the GPU.

Rock density is now 1.30 times water density in this test. Rock spheres remain negatively buoyant, while the empty cup's outer-volume/shell-volume ratio (~1.65) provides enough displacement to float. A flooded rock cup sinks. The latest cup's air and water volumes appear in diagnostics. Numerical tests cover dry equilibrium with the rim above water, flooding, rotated displacement, scale invariance, and interior/exterior parcel sampling. In the live six-second release, the cup retained its dry cavity and remained 0.39 simulation units above the bed; tilting it 80° subsequently flooded the cavity and the cup sank. The bulk count stayed at 12,852.

Player contact transfers slightly more momentum and allows more nearby spray: incoming push weight is 0.22 (previously 0.18), residual outward projection velocity is 25% (previously 20%), and the local spray weight is 0.30 (previously 0.20). Earlier test snapshots retain their original tuning.

All 259 numerical tests and the production build pass. The GPU sky comparison, dry-cup release and subsequent flooding were checked in the local preview with no console errors.

### Test 12 — irregular sand clumps, surface picking and retained wetness

Extracted and pushed sand now receives fixed, seeded position offsets and unequal clump sizes. Nearby clumps exchange grain stock before the offset is applied; grain mass, carried moisture and occupied volume are conserved. The variation is generated once, not every frame. Clump wetness now travels in the existing parcel texture and blends with the same smooth union used for the surface, so airborne/held sand no longer takes its color and wet highlights from the ground underneath. Deposits retain the mass-weighted moisture exchange and slow drying. Loose clumps can also be picked up again.

Sand and object grabs trace from the camera to the first solid surface, including loose sand and hollow cup walls. Water grabs intersect parcel supports along the ray and stop at solid obstructions. The sand tool can still reach the bed through transparent water. Held selections use their actual extent plus nearby camera clearance (at least one physical metre), replacing the fixed 20-metre minimum at the default beach scale. Water, sand and object holding all use the same distance rule. These CPU interaction queries only run on interaction; sand physics remains on the CPU and the existing GPU water solvers are unchanged. Earlier scenes remain byte-for-byte snapshots.

All 264 tests and the production build pass. New numerical coverage checks stable irregularity, conservation of grain stock/moisture/volume, wet pickup/drop/re-grab/deposition, ray occlusion and carrying distance across scales. The GPU/CPU sand-material comparison measured moisture error 4.30e-8 and distance error 5.46e-7 across 32 probes; the existing water, transport, reconstruction and atmosphere comparisons also pass. In the local preview, all 24 grabbed wet clumps retained approximately 0.95 moisture after release and remained visibly wet over dry land. Pushed and settling shapes were inspected at successive simulation steps.

### Test 12 — scroll wheel holding distance

While holding sand, water or a solid object, wheel-up moves it farther along the camera ray and wheel-down brings it closer. The wheel is consumed before orbit zoom or first-person tool cycling; empty hands keep the previous navigation/tool behavior. Pixel, line and page wheel input are normalized, camera clearance is bounded by the held selection's size, and diagnostics report holding distance in metres. The same rule works in orbit and first-person mode. Relevant numerical tests and the build pass.

### Test 12 — bonded wet sand and wetting while held

Wet chunks now land as persistent smooth-union additions to the terrain SDF, retaining their own moisture, packing and shape. They no longer shrink into the underlying dry column or dilute their wet appearance on contact. Connected pieces fall together and bond to the bed or another deposit; disconnected pieces continue falling. Wet terrain does not repose, and retained plastic memory preserves its form after drying. Dry grains transfer completely into the reconstructed bed on contact, then settle through the bed's conservative repose step. Sand stock is conserved in both paths. The base beach still uses column stock; wet deposits remain volumetric SDF additions.

Held sand now exchanges moisture with water and rain. Surface probes sample outside the cavity the sand displaces, and exposed grains wet the porous held selection. Wetting takes seconds; drying retains the existing ten-minute time constant. Deposits can be picked up with their moisture intact or deliberately pushed away; free objects collide with them as terrain. Sand mechanics and moisture exchange remain CPU work, while the existing GPU SDF rendering and water collision/compute paths consume the updated field.

All 275 numerical tests and the production build pass, including previous-scene snapshot checks. The GPU sand-material comparison passes with maximum moisture error 2.30e-6 and distance error 3.19e-7; water, transport, reconstruction and atmosphere checks pass as well. In the local preview a dropped wet selection retained 0.901 moisture after 31.5 simulated seconds, with zero shape drift over the final 30 seconds. Held dry sand reached approximately 0.67 moisture after 5.5 seconds in the running water simulation. QA controls provide landing, long-term bonding and held-soaking fixtures.

### Test 12 — camera droplet drying

Camera droplets now fade smoothly over roughly 4–8 simulation seconds after their last wetting, with larger merged beads lasting longer. Fresh rain or spray refreshes the affected bead without restarting its appearance fade-in. The bounded CPU droplet update feeds the existing GPU lens effect; surface wetting elsewhere and earlier test snapshots are unchanged.

All 21 relevant numerical tests and the production build pass. The local preview verified a 51-drop camera splash clearing after eight seconds, with no console errors. QA controls can apply a camera splash and advance its drying in two-second steps.

### Test 12 — resting shoreline and shared material resolution

Water contact and boundary-density completion now use the local metric distance of the conservative terrain field. The contact skin is smaller, and boundary Gaussians spread tangentially while preserving their covariance determinant and peak density, reducing the raised contact bead. Water tracing also rejects intervals already behind the opaque sand. The original initial volume and startup sloshing remain unchanged. Coarse samples still limit the smoothness of the resting edge; this is not an exact hydrostatic free-surface solve.

**Water / sand resolution** now controls both materials, based on the actual budget-limited water spacing. At 1×, 2.2× and 3×, the sand has 31×31, 66×66 and 89×89 nodes respectively; the grid is capped at 129×129. The GPU reads texture dimensions dynamically. The interaction-radius minimum scales with water spacing, down to about 4.7 cm at the default 110 m beach. Small sand tools remove conserved subcell stock while retaining its moisture; the resulting bed depression is still limited by the sand grid. Water tools smaller than a parcel select one existing parcel and do not silently increase simulation resolution.

**Water highlight roughness** controls the width of direct sun and lamp highlights. It does not change waves, blur refraction, or blur the sky reflection. The UI now names that limited behavior explicitly.

All 285 numerical tests and the production build pass. Live GPU checks pass against the CPU reference: maximum sand/cup constraint error 1.37e-6, transport error 7.63e-6, and sand material errors below 3.67e-6 across 33×33, 65×65 and 97×97 grids. Preview checks covered the calm shoreline, both resolution endpoints, and the smaller brush range. Previous test implementations remain unchanged.

### Test 12 — shoreline support, partial clay cuts and physical player contact

The visible water reconstruction now completes missing shoreline kernel support with horizontal image Gaussians at the same elevation as the real samples. This replaces tangent flattening, which bent the reconstructed surface down beside the bank and left a trough. Image kernels affect reconstruction and light attenuation only; they add no simulation particles or water stock. The terrain clips them. The original initial water volume and startup collapse/slosh remain unchanged. Coarse particle spacing still limits surface smoothness; this is a boundary reconstruction correction, not a new hydrostatic solver.

Grabbing or carving a placed sand clump now intersects the tool sphere with the clump's existing solid field. Small tools cut a small piece and leave the matching cavity instead of selecting the entire overlapping clump. Both sides retain moisture and packing. First cuts use exact sphere-intersection volumes; repeated overlapping cuts use bounded deterministic quadrature while conserving the stock ledger. Cut operations travel with each shape and are packed into the existing GPU sand texture. Bonded deposits recheck connectivity to supported sand and release unsupported components to gravity when their support is removed. This is support connectivity, not a structural stress/fracture solver.

The test's isolated first-person capsule now exchanges linear impulses with movable objects using an 80 kg player mass and the object's material/volume mass. Spheres and cups can be spawned down to a **1 cm radius**, with size-relative ray picking and rendering tolerances. Tiny cups still require adequate water resolution to resolve liquid inside; spawning them no longer silently enlarges them. Sand, body and player mechanics run on the CPU; water constraints/transport and field reconstruction retain their GPU paths and CPU reference.

All 290 numerical tests and the production build pass. GPU comparisons pass, including cut sand at three grid resolutions (maximum distance error 6.52e-7 and moisture error 3.67e-6), water constraints, transport, reconstruction and atmosphere. The preview checked the shoreline after 30 simulated seconds of the original initialization, partial wet-clay pickup with zero stock error, loss of support, and the 1 cm size control. Tests 01–11 remain unchanged.

### Test 12 — research-guided performance pass

This pass is isolated to `src/sand-lab/`. Tests 01–11 remain development snapshots. Simulation step size, water inventory, brush behavior, camera coarsening and Gaussian/SH appearance are not reduced to obtain the gains.

Implemented adaptations:

| Change | Implementation and reference path |
| --- | --- |
| Batched GPU results | Dispatch density constraints and transport consecutively, gather their five outputs into one GPU atlas, then perform one synchronous readback instead of five. Reuse two CPU readback buffers and avoid redundant position uploads. The sequential reference and CPU fallback remain available. This removes intermediate waits, **not all CPU/GPU synchronization**. |
| Compact neighbor storage | Reusable typed cell ranges and an open-address hash replace per-cell arrays and repeated neighbor-buffer allocations. Particle identity, neighbor order, symmetric acceptance and the existing overflow rule are preserved. Existing motion-based neighbor reuse remains active. |
| Nearby contact searches | Conservative spatial bounds filter body/body, sand/body and bonded-sand support candidates. Large objects fall back to a separate list; corrections update bounds before subsequent contacts. Narrow-phase mechanics and contact order remain unchanged. |
| Settled-sand caches | Separate geometry/support revisions from moisture. Drying updates material data without rebuilding unchanged shape bins or support connectivity. Movement, reindexing, cuts, compaction, bed changes and removal invalidate the relevant cache. |
| Empty-space traversal | GPU-reduced maxima over blocks of the reconstructed density atlas bound trilinear water density. Surface rays preserve their original sample sequence while skipping density fetches in empty blocks. Lighting rays also skip empty spans, bounded by distance to solids/glass. The CPU builds the same maxima for comparison. |
| Opacity-aware Gaussian bounds | Tighten covariance-projected spray/mist/rain rectangles to their existing fragment cutoff; skip expired or already-invisible lighting samples. No new opacity threshold, blur or particle-size change. Directional SH response remains intact. |
| Staggered medium lighting | Refresh rows of the world-space optical-depth cache over a bounded sweep, with a short history blend. Paused edits, lighting changes, geometry interactions, resets and changed bounds reject history. This affects cached lighting only, not fluid timing. |

Research sources: GPU residency in [Goswami et al., SCA 2010](https://www.ifi.uzh.ch/vmml/publications/interactive-sph/InteractiveSPH.pdf); compact particle data in [Ihmsen et al., CGF 2011](https://cg.informatik.uni-freiburg.de/publications/2011_CGF_dataStructuresSPH.pdf); collision broad phases in [Teschner et al., VMV 2003](https://cg.informatik.uni-freiburg.de/publications/2003_VMV_collisionDetectionHashing.pdf); volume empty-space skipping in [Krüger and Westermann, IEEE Visualization 2003](https://www.cs.cit.tum.de/cg/research/publications/2003/acceleration-techniques-for-gpu-based-volume-rendering/); opacity-dependent splat bounds in [Speedy-Splat, CVPR 2025](https://speedysplat.github.io/); and lighting-history reuse in [SVGF, HPG 2017](https://research.nvidia.com/labs/rtr/publication/schied2017spatiotemporal/). These are limited adaptations, not reproductions of the complete papers or their reported speedups. In particular, the lighting cache is not a full SVGF denoiser.

Reproduce the checks with `npm test`, `npm run build`, and `node tests/sand-performance-benchmark.mjs`. In `?scene=sand-lab&paused=1&qa=1`, **Performance comparison mode** selects all/reference paths or disables one optimization. **Benchmark matched beach** resets the fixture, warms up for 15 frames, and measures 45 frames with two fixed 1/30 s steps, fixed half-size drawing and explicit GPU completion. **Compare optimized rendering** checks both paths at the same paused state. The ordinary 45-frame benchmark instead exercises the live simulation budget and adaptive drawing.

Initial measurements on the local Mac/browser, 2026-10-16 (the final GPU run reports ANGLE Metal on AMD Radeon Pro 560X):

| Isolated CPU workload (median of 20 runs) | Reference | Optimized |
| --- | ---: | ---: |
| Rebuild neighbors, 12,852 water samples | 89.8 ms | 65.0 ms |
| Body contacts, 1,000 separated bodies | 157.6 ms | 10.2 ms |
| Moisture update/support/render packing, 250 settled clumps | 4.70 ms | 1.96 ms |

The body result is deliberately a sparse stress case: 499,500 possible pairs become zero narrow-phase candidates. Dense piles still require their actual contacts. Packed storage gave a smaller and workload-dependent gain; the end-to-end run's mean neighbor timing was nearly unchanged. Its reduced allocation churn and exact ordering are useful, but it is not the main explanation for the total speedup.

The first matched beach comparison used 12,852 water samples, 32,768 fine markers, a 480×270 internal image, and three measured simulated seconds. Reference median/p95 work was **1,408/1,894 ms**; the initial optimized run was **558/915 ms**. A final run, including the conservative sampling correction, measured **666/886 ms** median/p95, with a maximum of **896 ms** versus the reference maximum of **1,972 ms**. Completion time fell from **69.48 to 31.89 seconds**, about **2.2× throughput**, while simulated/wall time rose from **0.043× to 0.094×**. A separate live-timing run improved median/p95 frame intervals from **966/1,367 ms** to **599/767 ms**, and simulated/wall time from **0.067× to 0.109×**. Absolute timings varied substantially during this session; these are local paired observations, not a hardware guarantee or a claim of reaching 15 fps / 1× realtime. Do not compare the older, differently sized preliminary baseline directly with these runs.

The strongest directions to invest in next:

- **Keep more of the fluid step resident on the GPU.** The batched path matches the old GPU outputs exactly in the verification fixtures and removes four intermediate readback calls, but a final blocking transfer still costs tens of milliseconds. Moving prediction and neighbor construction onto the GPU, followed by sparse CPU probes for interaction, is the larger opportunity. That is a separate architectural change and has not been attempted here.
- **Extend spatial indexing where busy scenes still scan all objects.** The contact microbenchmark shows a clear benefit. CPU field queries and GPU object-ray traversal still contain linear scans; compact variable-length sand bins could also avoid the existing overflow-to-full-scan path. These deserve profiling with dense sculptures and many cups.
- **Reduce fine-particle optical transport cost.** Surface and fine rendering remain substantial GPU costs. Tighter bounds preserve appearance but only help sufficiently faint kernels; they do little for bright/dense foam whose support still reaches three sigma. Reusing well-validated incident-light samples or a hierarchy of optical density is more promising than enlarging the visual cutoff.
- **Treat empty-space skipping and lighting tiles as workload-dependent.** The broad beach already has a front-surface bound and a cached low-resolution light field. Added occupancy construction can offset traversal savings in dense views; lighting tiles primarily spread refresh work, rather than guaranteeing lower total work. Sparse scenes, heavier volumes and moving-camera tests warrant separate tuning. Do not quote a standalone speedup for these changes from the aggregate measurement.

Validation: all **301 numerical tests** and the production build pass. Packed neighbor arrays match the reference exactly, including crowded overflow and buffer resizing; contact outcomes match across broad-phase paths. The batched GPU output has zero difference from the sequential GPU output across five particle counts, including held particles and allocation boundaries; maximum CPU-reference difference is **1.05e-4**. Coarse occupancy maxima match their CPU calculation exactly across **1,452 cells**. The existing sand/cup, transport, reconstruction, atmosphere and material-resolution GPU checks also pass. Geometry/support tests include moisture-only updates, support removal and movement before a collision query. Saved benchmark and image-comparison measurements accompany this pass under `tests/results/`.

The final fixed-state comparison of disturbed water and 32,768 fine markers found **zero missing water pixels**, **zero water-depth difference**, no nonfinite pixels, and mean linear RGB difference **6.91e-6** (maximum **0.00133**). Remaining color differences come from changed optical-depth integration through verified empty spans. These short checks do not establish long-run physical accuracy or stable realtime performance.

### Test 11 addition — ornate metal fountain (2026-10-17)

Open `?scene=water-lab&station=fountain`, or select **Ornate metal fountain** in
Water laboratory. This is an added station; the eight earlier water stations and
test 12 retain their prior settings and algorithms.

- Three scalloped catch basins (18.2 m across the lower basin by default), a
  fluted column, moulded collars, leaf brackets and repeated scrollwork. Metal
  tint, GGX roughness and patina are independent live controls. The stationary
  fixture uses an analytic SDF; the liquid and fine particles retain the lab's
  Gaussian density / covariance projection and SH lighting paths.
- Twenty-one pump outlets: one central aerated plume, eight upper arcs and
  twelve lower arcs. Each group has a strength control; ring elevation and air
  entrainment are adjustable. The laminar/turbulent control perturbs inlet
  momentum. Jet strength changes discharge and ballistic head, not gravity.
- Pumps withdraw unheld water from the bottom collection zone and return it to
  the nozzles, with a clearance test that prevents overlapping source parcels.
  Seeded arcs are live parcels, not animated geometry. Gravity, basin contacts,
  shared breakup/foam rules and wind determine their subsequent motion. Rain,
  pickup, dye and all three thrown ball materials remain available.
- Aerating nozzles seed small white Gaussian air/spray markers in proportion to
  discharge and the entrainment setting. Downstream impacts use the existing
  water detail generator. This station has a separate 32,768-marker pool; the
  previous stations keep their 131,072-marker pool. The bulk budget and physical
  scale controls remain available.
- GPU density constraints, reconstruction, fine-particle advection and shadow
  fields remain active when supported. Pump scheduling, neighbor lists, bulk
  transport/chemistry and rigid bodies still run on the CPU. The reference
  solver remains selectable. Jet-aware timesteps avoid silently clamping the
  strongest plume's launch velocity. Dense spray and high detail still cost
  frame time; this is not a guarantee of realtime at every setting.

`tests/water-lab-fountain-gpu.html` compares 4,096 CPU/GPU field samples (including
axis singularities), a compressed wall-contact solve and held particles. It also
runs 180 live steps to check recirculation, all three levels, finite positions,
penetration and inventory. The default circulation run conserved volume exactly
and reported no neighbor overflows. Existing-station regression fixtures record
the pre-addition water seeds, dimensions and CPU collision fields; the snapshot
hashes were updated only for the explicitly extended station dispatch/render files.

Initial limits (extended by the following lighting pass): metal reflects the sky and ground in one bounded environment bounce;
recursive fountain-to-fountain reflections are not traced. Air entrainment is a
nozzle model, not a resolved two-phase air/water simulation. The fixed water parcel
budget still limits how thin spill sheets can become. The central plume and
ring nozzles are independent pumps rather than a simulated pipe-pressure network.

### Fountain lighting and jet range (2026-10-17)

The fountain now traces sunlight reflected **upward** by the reconstructed water,
including onto downward-facing basin surfaces. A 128×128 GPU photon pass splits
power into Fresnel reflection and refraction, tests the metal/body blockers and
integrates absorption along the outgoing water path. World-space hit positions
are gathered onto visible receivers with depth/normal rejection. The metal
receives that energy through its directional GGX response, tint and patina;
it is not an emissive caustic pattern. The **Water-bounced sunlight** checkbox
provides an A/B comparison, and **Inspect undersides** positions the camera for it.
Metal also samples a bounded ambient reflection of nearby water, separately from
the direct-light photons so the sun is not counted twice.

The fountain's hard metal occlusion is now traced independently of the coarse
water-extinction volume. Rays intersect the full fixture bound even when their
origins are outside it. A cached cosine-weighted sky-visibility map supplies the
ground's ambient occlusion. This removes the coarse metal-shadow gaps beneath
the lowest basin while retaining translucent water and fine-particle shadows.
These changes are conditional on the fountain station; older stations retain
their original optical paths.

All three jet controls now reach **four times the previous maximum launch speed**
(4.90× the default speed). The central outlet reaches **43.94 m/s** at the default
physical scale. Its launch head is 49.2 solver units above the nozzle. The fountain
alone has a larger 48×60×48-unit simulation envelope. Water outside the near-basin
atlas is reconstructed from local Gaussian neighborhoods on the GPU, with a
bounded 64-neighbor query; the fine atlas is not enlarged. The timestep still
respects launch velocity, so these extreme settings require more simulation steps
per second and can run substantially below realtime.

`tests/water-lab-fountain-light-gpu.html` validates shadow visibility and dielectric
splitting against the CPU reference, and compares actual photon hit locations
and energy against CPU ray integration through a readback of the density field.
The recorded run found 1,352 reflected photons on undersides, maximum hit-position
difference 0.01473 solver units and maximum flux difference 0.00157. A rendered
A/B check changed 11,478 underside pixels; the bounced-light contribution became
exactly zero with sunlight off and changed with metal roughness. The high-flight
fixture checks rendered pixels, not only instance counts, and remained finite
after advancing the solver. All 314 numerical tests and the build pass.

Limits: this is a bounded single-water-bounce estimate, not recursive global
illumination. Photon sources sample the water atlas near the fountain; distant
individual drops do not generate their own caustics. Gathering covers visible
opaque receivers and is spatially filtered; it does not solve multiple glass
interfaces or off-screen caustic reflections. The selectable CPU fallback uses
32×32 photon rays and the same reference transport, with reduced caustic detail;
fine-particle attenuation on those CPU photon paths is not sampled. The existing
metal reflection remains a limited sky/water/ground approximation. At extreme
jet settings the parcel budget also limits stream continuity.

### Fountain spray through the full jet (2026-10-17)

The fountain now carries entrained-air and breakup history with each liquid
parcel. Air-relative stress, deformation and loss of liquid neighbors develop
that history; losing the last neighbor no longer silences the emitter. Mist has
a higher breakup threshold than spray and accumulates around sustained breakup.
This covers seeded jets, recirculated water and fragments ejected by impacts.
There is no emission rule based on height or camera distance. Nozzle aeration
still controls the initial air load, and histories decay or reset at recycling.

The new emitter is isolated in `water-lab-fountain-spray.js`. Emission accounting
runs on the CPU; particle advection, collision, lifetime and rendering continue
on the GPU with the existing CPU reference. Physical-volume weighting and a
9,000/s base spray budget (before the density multiplier) retain bounded work;
the fountain's 32,768-marker allocation is unchanged. Outside the near-fixture
wind lattice, fountain particles use spatially varying open-air wind instead
of repeating the lattice's top slice. The fountain alone has additional upper
headroom for impact-ejected liquid. Other stations keep their existing emitter.

This is an unresolved breakup/air-entrainment model, not a two-phase air/water
solver. Fine airborne markers remain visual tracers, and the existing near-field
water-advection atlas is not enlarged. The numerical tests cover crest memory,
quiet-flow suppression, impact fragments, scaling, recycling and distant wind.
`tests/water-lab-fountain-spray-gpu.html` checks CPU/GPU high-altitude motion,
rendered crest coverage, and an actual maximum-speed jet ascent separately from
its deliberately constructed full-flight coverage fixture.

### Stable laminar pipe (2026-10-17)

The pipe alone now emits complete, equally timed cross-sections. Its transverse
spacing matches the solver's rest spacing: the former 0.9 spacing over-compressed
the center of the inlet and launched alternating pressure pulses. Layers are
placed clear of the outlet collision skin, only reservoir water is recycled,
and the pipe timestep accounts for discharge speed and gravitational acceleration
instead of clipping a fast jet to the old fixed-step velocity limit. Dissolved
material is retained during recycling; stale impact aeration is cleared.

Thin connected inlet samples use bounded Gaussian quadrature along their moving
neighbor segments. Each parcel retains its volume; the density and lighting
passes still run on the GPU, using the same water material and CPU reference.
The subdivision runs on the CPU and adds at most twelve kernels per linked
parcel. It fills undersampled stretches of the jet rather than replacing the
flow with an animated tube. Links stop at contact, grabs, missing sections,
excessive gaps or sharp velocity changes, and the reconstruction fades away as
turbulent forcing rises. Disconnected drops keep their smaller Gaussian lobes.
Other stations and the separate sand-lab snapshot use their previous behavior.

This is a finite-resolution jet reconstruction, not a resolved capillary-breakup
model. `tests/water-lab-pipe.test.js` covers inlet timing, conserved volume and
solute, velocity limits, severed links, and continuity with the actual CPU fluid
solver. `tests/water-lab-pipe-gpu.html` runs sustained GPU flow and samples liquid
density along the stream, alongside the existing CPU/GPU constraint and density
checks.

Recorded validation: normal-flow and maximum-flow runs kept the centerline
above the liquid isosurface threshold at every half-second checkpoint; maximum
flow was checked through twelve simulation seconds. The minimum sampled density
was 0.375 (normal) and 0.501 (maximum), versus the 0.18 surface threshold. High
forcing still produced disconnected flow. All runs retained their water volume.
GPU/CPU maximum errors were 0.000919 for fluid constraints (tolerance 0.002) and
1.49e-7 for density (tolerance 1e-4). All 329 numerical tests and the build pass.
Results and the main-preview screenshot are in `tests/results/pipe-laminar-2026-10-17.*`.

### Sand layers and bounded compaction (2026-10-17)

Test 12 now retains dry deposits on top of wet or raised sand as separate
material parcels in the same smooth SDF union. They keep their own moisture,
spread into volume-preserving flattened mounds, and slip on slopes exceeding
friction. They are not transferred into the buried height column. Water contact
bonds the current shape; evaporation retains its existing 600-second timescale.
Capillary strength fades continuously toward 20% of the recorded wet bond, so
ordinary dried shapes remain stable while extreme slopes can yield. There is
no geometry replacement or mass transfer triggered by becoming fully dry.

Wet pushing previously extracted and re-cut the same deposits on every stroke,
multiplying both parcels and copied CSG histories. Pressure now compacts the
existing stock, followed by conservative column shear or impulses to existing
clumps. Explicit grabbing and carving still make local CSG cuts. Completed
compaction no longer dirties the terrain when packing does not change.

A matched six-stroke CPU benchmark reduced median push-plus-sand-step time from
79.2 ms to 1.68 ms; a warmed 120-stroke run had a 0.19 ms median and 1.11 ms p95,
with no new clumps/cuts and less than 1e-12 mass error. The browser's 120-stroke
fixture measured 0.10 ms median and 0.70 ms p95. These are **sand-only** timings,
not total frame times. Results: `tests/results/sand-compaction-2026-10-17.json`.

Sand material/settling and compaction remain on the CPU; water constraints,
transport, fine particles and rendering retain their GPU paths. GPU checks now
include flattened, cut sand shapes: maximum distance error was 6.52e-7 and
moisture error 3.67e-6 across three sand resolutions, below the 1e-4 tolerance.
The existing local preview's `qa=1` controls include layer landing, soaking,
accelerated drying, and sustained compaction fixtures. This is a coarse parcel
and yield model, not a grain-resolved granular solver; large loose mounds are
approximated by flattened SDF supports. Earlier scenes are unchanged.

### Sand support and loose overhangs (2026-10-18)

Test 12 resolves a fresh loose deposit on raised sand into at most 25 smaller
surface patches, once per deposit. They spread, follow their individual supports,
and accelerate down slopes beyond the dry angle of repose. Unsupported edges fall;
dry material reaching the dry ground rejoins its column stock. Wet material keeps
its adhesive shape. Patches from the same loose deposit overlap in the smooth SDF
but cannot stack or prop one another up as rigid slabs. This remains a coarse
CPU granular approximation, not individual simulated grains.

Support now distinguishes compression from below from an adhesive connection.
Loose sand cannot suspend other sand through a tensile bond. The rooted support
graph is refreshed after settling and deposition as well as before them. Cut
shapes use lower surfaces sampled from their actual CSG intervals, rather than
the empty underside of the original brush sphere. Disconnected cut pieces also
fall independently. Geometry and material caches skip unchanged settling work;
cached and reference results agree through wetting and support removal.

The local `qa=1` controls include **Mixed wet / dry drop** and **Settle layers 8 s**.
Checks cover edge shedding, wet caps on moving dry supports, cut-away support,
mass/moisture retention, and bounded subdivision. The 346-test suite and build
passed, followed by the additional cache-equivalence test. Existing GPU/CPU
checks all passed; support and settling still run on the CPU. Numerical results
and the settled fixture screenshot are in `tests/results/sand-support-2026-10-18.*`.

### Joined loose-sand surfaces (2026-10-18)

Test 12's **Dry layer on wet sand** fixture now starts paused before the drop,
farther up the beach. Resume shows the fall; **Drop another dry handful** allows
repeated loading without replacing the support. The fixture no longer silently
advances eight seconds before displaying its initial state.

Settled loose portions gradually acquire broader, radius-relative SDF blending,
joining their individual silhouettes into a continuous mound. This is surface
reconstruction, not a screen blur; the CPU surface query and GPU collision/render
field use the same widths. Material interpolation remains narrower so a dry
surface does not acquire its support's wet appearance. New cuts use the narrower
kernel to avoid filling the brush cut back in. Sand stock is conserved separately
from this approximate reconstructed volume.

A finite footprint now checks downhill support across eight directions, rather
than relying only on the slope at a parcel's center. This sheds steep edges and
prevents repeated deposits from building a stack of point-supported disks. Dry
landing tests use the underside instead of an inflated spherical contact, which
could previously catch on a side wall and re-anchor a clump above the ground.
Wet adhesion and the support-removal checks are retained.

Validation: all 351 numerical tests passed, followed by the 22 affected settling
regressions after the final projection adjustment; the production build passed.
Browser GPU checks passed at 33, 65 and 97 sand cells per side (maximum distance
error 1.11e-7; moisture error 3.67e-6). Four successive dry drops conserved stock
to below 1e-12 and retained seven supported clumps, with excess stock entering
the surrounding bed. Sand-only CPU stepping measured 0.38 ms median / 1.22 ms
p95 over 64 simulated seconds; these are not whole-frame timings. Sand physics
still uses the CPU, with the surface and water using their existing GPU paths.
Results and before/after images: `tests/results/sand-surface-*-2026-10-18.*`.

### Wind transport and bonded sand loading (2026-10-18)

Test 12 now uses the existing obstacle-aware wind field and wind brush for
sand. Dry exposed stock is lifted into short, heavy hops; wetter material and
dried material with retained cohesion require stronger wind. Stock is deducted
from its source and returned through normal deposition. The work is bounded to
192 distributed bed probes plus up to 64 brush-local probes per erosion update,
and 32 airborne wind aggregates. This budget is independent of water-mobilized
aggregates. Existing material is never deleted to meet those limits.

Fine airborne detail is a separate 8,192-slot GPU ping-pong simulation with
exact drag/gravity integration, solid contact removal, and a CPU reference.
These tan, translucent, covariance-projected Gaussians use directional sky SH
and direct sunlight. They represent already mobilized stock: they neither add
another mass source nor draw their parent aggregates as opaque flying spheres.
They are visual tracers, not individually mass-carrying simulated grains.

Bonded deposits now transfer gravitational and aerodynamic forces, and bending
moments, down a cached support graph. Multiple supporting paths share loads by
estimated contact area. Contact sampling accounts for CSG cuts. Sustained
excess load breaks a bond and releases the dependent pieces; spherical bonded
clusters can tumble. Wet bonds are intentionally very forgiving. Evaporation
smoothly reduces strength toward the existing roughly 20% residual adhesion,
without changing a retained shape merely because it crosses a drying threshold.
Small dry piles continue to settle through the existing friction/repose path.

This is a **CPU lumped-load fracture approximation**, not elastic finite-element
sand or a grain-scale soil solver. Strength is an artistic parameter (1.6 MPa at
full bond); the support graph uses paths toward grounded material. Fracture
occurs at inter-aggregate contacts, not arbitrary cracks through one CSG term.
Cut/flattened fragments translate while spherical clusters can rotate. Water,
air-field computation and fine-grain motion retain their GPU paths. Camera LOD
does not affect any load or transport calculation.

With `qa=1`, use **Short wet overhang**, **Long wet overhang**,
**Wind-loaded sand column**, **Dry structure (retained bond)** and
**Stress sand 3 s**. The last button advances sand alone with uniform diagnostic
wind; Resume uses the full obstacle-aware world simulation. **Wind erosion
fixture** provides a low view of the beach with water spray/lens film disabled
for inspection. Diagnostics report load relative to strength and broken bonds.

Validation covers stable wet/dried short overhangs, gravitational failure of
long overhangs, stronger wind required for wet columns than dried ones,
conservative entrainment/deposition, submerged surfaces, separate water/wind
budgets, contact caching and frame-independent fine-grain integration. GPU
motion matched 32 CPU probes within 1.86e-7 lab units. A 30-second sand-only run
with 66×66 cells and a short bonded structure cost 0.24 ms median / 1.27 ms p95
in calm air, and 2.02 ms / 4.82 ms at 40 m/s, with a maximum of 38 aggregates.
This is **not a whole-scene frame-rate claim**. Stock error stayed below 2e-12
lab cubic units. Results: `tests/results/sand-wind-stress-cpu-2026-10-18.json`.


### Sand wind coupling correction (test 12)

Sand surface forces now evaluate the current obstacle-aware wind directly rather
than interpolating the coarse air lattice through buried zero-velocity cells.
A narrow brush samples its actual ray hit, including below the terrain cell size.
At direct incidence the brush spreads along the surface and lifts grains instead
of having its momentum canceled into the ground. CPU sand and GPU fine grains
use matching local forcing; water retains its existing air lattice.

Deposited dry stock is considered before the bed, and eight of the 32 airborne
stock slots are reserved for brush transport. Stronger entrainment and denser
fine tracers make the response visible without enlarging individual Gaussians.
The fine tracer pool is bounded at 8,192. Grains removed from the surface remain
accounted for as transported stock and return on landing. The bounded beach
also removes outward/upward driving at its side walls so stock settles there;
previously invisible packets hovered at the boundary indefinitely, exhausting
all available erosion slots after the first few seconds.

QA now has a dry dune in **Wind erosion fixture**, plus **Wind brush fixture**
and **Hold wind brush 3 s**. **Inspect sand stress** reads back live GPU grains
and measures visible rendered pixels, rather than only counting births. These
fixtures are explicit resets; ordinary scene setup and prior tests are unchanged.
Regression tests exercise actual sloped-surface wind, narrow brushes between
cells at three resolutions, brush budget reservation, dry deposits and twenty
seconds of sustained maximum wind. All transfers conserve sand stock. A 128-point
GPU comparison of surface wind/impinging jets agreed with the CPU within 7.7e-6
lab velocity units. Grain-motion error remains below 1.9e-7. CPU stock transport
and bonded-load evaluation remain CPU work; fine grain motion runs on the GPU.

### Material-dependent grains and environmental player forces (test 12)

Fine-particle release now uses `particulate-material.js`: forcing stress versus
binding stress (cohesion/yield plus surface tension), with density, dispersion,
drag and albedo as material properties. Water's existing Weber gate is expressed
through the same function without changing its tuned response. Sand moisture and
bond memory continuously raise the threshold and reduce dispersion. Wet bed and
SDF deposits, including carved deposits, can shed fine stock under extreme wind
or strong water shear; they are no longer categorically excluded. Still water
shields the bed from wind. Removed stock remains conserved and deposits normally.

Dry grains have independently staggered births, wider surface sampling and
velocity spread, and size-dependent drag. Individual Gaussian sizes and the
8,192-instance cap are unchanged. The existing GPU flow atlas carries submerged
grains, with density-dependent settling; the CPU reference uses the same model.
The rendering keeps covariance projection and SH response, with warmer mineral
albedo and a modest ground-bounce approximation. Four occupied-water path samples
use the water's existing solute extinction/scattering when grains are submerged.
These are visual tracers of finite transported sand packets, not an independent
mass source or a fully resolved grain solver. The generalized release function is
a foundation for later materials, not a conversion of all historical tests.

The test-12 player is an 80 kg capsule with bounded input acceleration, ground
friction, air drag, and occupancy-weighted liquid velocity including vertical
wave motion. Idle controls no longer zero external momentum. Moving bodies and
the player exchange opposing impulses; existing player water displacement remains
active. Space still jumps on land and increases buoyancy in water. Liquid probes
run once per frame rather than once per collision substep. Player contacts, sand
stock and emission remain CPU work; fine grain motion and flow reconstruction use
the GPU when available. Diagnostics report player position, speed and immersion.

Validation covers conservative dry/wet/carved emission, air versus submerged
forcing, dispersion and birth timing, preserved water gating, frame subdivision,
wind-driven player motion, current/wave advection, body impulses, jumping,
flotation, slope stability and walking speed. GPU grain-motion probes span
multiple drag coefficients and air/submerged gravity (maximum error 2.4e-7 lab
units in the local preview). Prior test modules are unchanged.
