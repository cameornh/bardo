# Bardo

Previous tests are development snapshots. Do not change their behavior or implementation unless the user explicitly requests it. New experiments belong in isolated modules; shared changes must not silently alter previous tests.

This is a local engine experiment. Keep the interface limited to functional test controls and diagnostics; avoid branding, promotional copy, and decorative UI.

Use actual covariance-projected Gaussian primitives, with spherical harmonics for directional environment response. Keep simulation independent of camera motion and visual LOD. Preserve the user's saved clay and terrain edits when adding isolated test scenes.

Use available GPU compute for suitable parallel workloads in new tests, not only for drawing. Keep an explicit CPU reference/fallback, report the active backend, and validate GPU results numerically. Be clear about simulations that still run on the CPU. Camera coarsening must stay proportional to speed, with an early, gentle onset and gradual completion.

Run the relevant numerical tests and `npm run build`, and visually inspect new rendering work in the existing local preview.

The user has authorized pushing completed, verified changes to `https://github.com/cameornh/bardo`. Commit and push future changes there as part of completing the work. Preserve remote history; do not force-push.
