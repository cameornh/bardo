# Carved sand contacts and stronger wind brush

The shared live sand lab now starts the wind brush at **240 m/s** (previously
60 m/s) and allows **900 m/s** (previously 180 m/s). Ambient wind is unchanged.
The slider supplies the same velocity parameter to the existing CPU/GPU air
paths; no particle budgets, shaders or graphics watchdog settings changed.

## Collision correction

The rigid terrain solver already sampled the sand's carved CSG, but the
separate sand/object constraint pass treated each carved parcel as its original
solid sphere. That pass ejected an object from an otherwise empty carved bowl.

The live pass now uses the actual occupied carved shape for nearby object
contacts. Object-surface probes query the carved sand; reverse probes of the
remaining sand boundaries catch small fragments inside larger objects. Removed
boundaries are excluded. The normals, penetration correction, friction and
body torque come from actual contacts. Mobile sand exchanges equal and opposite
linear momentum with movable objects.

This remains CPU contact work. Ordinary uncarved grains retain the established
fast path. Conservative spatial bounds reject distant pairs; a body fitting
entirely inside a carved void skips surface probing. Surface samples are cached
until the shape changes, and each nearby pair uses at most eight contacts in
each of three passes. Historical SandLab snapshot constructors keep their
previous contact implementation; only LiveSandLab selects the new pass.

## Verification

- All 10 new checks passed: the original sphere-bound ejection reproducer,
  glass/mirror/rock/light balls falling into the bowl, tilted cups touching its
  walls, enclosed and intersection-cut cavities, cache refresh and spatial
  broadphase agreement, mobile momentum conservation, held objects, actual live
  prepare-step integration, unchanged ordinary-grain contacts, and brush forcing.
- The wider relevant run passed **82 tests**. It includes previous cup contacts,
  sand support, cohesion, repeated-edit conservation and live scheduling checks.
- One old GPU diagnostic assertion was excluded from that final run after it
  also failed in a clean archive of the unchanged base commit `ba404c6`:
  `sand/object constraints cannot submit GPU work, including deferred and packed
  modes` expects a backend label containing `CPU object contacts`, while the
  implementation reports `JavaScript CPU`. The test and GPU implementation
  files are unchanged. Its baseline failure is retained in
  `baseline-diagnostic.txt`; no snapshot test was rewritten.
- `npm run build` passed.
- The browser preview was visually inspected. It uses a 2D cross-section of
  the actual collision field and 480 CPU rigid steps, without a WebGL context
  or fluid simulation. The ball settled to y=1.07998995 against the expected
  1.08. The old contact pass instead pushed a placed ball up to y=2.1801.
  Results: `bowl.json`, preview: `bowl.png`.

Reproduce the isolated preview at
`/tests/carved-sand-contact-preview.html`. It creates no GPU work. The full beach
was not stress-tested on the Mac for this change, and these results do not claim
a full-scene FPS improvement or a new RTX hardware measurement.
