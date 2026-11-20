# Incremental studio surfaces — 2026-11-19

The next backlog item was exact incremental studio rebuilding, retaining beach regression coverage. CPU sculpting now reuses the previous field and surface blocks. The live GPU sampler and extraction retain their existing behavior. This improves editing response; it does not establish an FPS or physics-throughput gain.

## Measurements on this Mac

| Measurement | Full rebuild | Incremental |
| --- | ---: | ---: |
| Browser worker update, mean | 231.05 ms | 17.72 ms |
| Browser worker update, p95 | 253.0 ms | 22.6 ms |
| Complete editing playback | 22.49 FPS | 22.30 FPS |
| Frame interval, p95 | 67.4 ms | 67.2 ms |
| Surface packing/upload on main thread, mean | 8.86 ms | 7.51 ms |
| CPU sampling + extraction only, mean | 233.87 ms | 14.48 ms |
| CPU sampling + extraction only, p95 | 258.95 ms | 22.31 ms |

The browser comparison uses the real StudioView, covariance-projected Gaussians, SH response and Baker worker at 960 × 540. Eight ABBA blocks each start with the same 25-stamp sculpt and append eight carve/paint strokes at 0.065 m spacing. Each block presents for at least four seconds, with at most one worker job and one GPU frame outstanding. The worker runs independently of presentation, as it does in the editor. No other performance test/build ran concurrently. CPU tests/builds ran only outside measured playback.

Worker delivery is **13.0× faster**; kernel-only rebuilding is **16.2× faster**. FPS differs by −0.85%, within the block variation, and is not a speedup. Physics remains paused during authoring, matching the existing studio workflow: realtime is zero in both edit modes. No simulation-speed improvement is claimed. Cold bakes stay full; CPU-only cold averages were 236.2 and 223.4 ms with appreciable warm-up variation, not the intended benefit.

The final surfaces and all eight frozen images are exact (maximum byte difference zero). The CPU editing run reports no context loss. [Raw browser rows](studio-edits.json), [CPU rows](cpu.json), [rendered result](studio-edits.png).

## Implementation and limits

- A separate opt-in worker keeps at most two part caches. Historical worker behavior remains unchanged. The UI provides “Reuse unchanged CPU sculpt regions” under Diagnostics; disabling it restores full rebuilding.
- Scalar state retains f64 accumulation before f32 publication. Resuming from the exported f32 grid would alter normals/material decisions. A new stamp is evaluated across the full existing grid because CSG operations can change distances far outside the brush bounds.
- Only blocks incident to changed f32 samples/material indices are re-extracted. Cells across 8³ block boundaries are included. Output preserves the original global z/y/x order, material tie rules and 24,000-splat truncation policy.
- Grid changes, undo, changes to earlier stamps/material IDs, reordering and backend changes fall back to full rebuilding. Finishing a brush stroke schedules only the parts touched by that stroke.
- This fixture retains 4,888,703 bytes of typed cache storage per part. A maximum-grid part stays under 10.5 MB; the two-part cache is bounded below 21 MB of typed storage, excluding returned arrays/signatures. Old cache entries are evicted. Saved library data are untouched.
- Full output packing and geometry uploads remain. This is not a sparse infinite field, adaptive sampling, incremental GPU sampling or unlimited stamp history. Expanding the bounds can still be expensive. GPU mode still samples/extracts fully in the live scene.

## GPU evidence and excluded run

The existing bounded GPU sampler passed its four CPU-oracle cases: 3,121 samples, maximum distance error 2.384e-7 m, exact material IDs. Four real GPU-generated grids also produce exactly the same surface through cached and reference CPU extraction. [GPU evidence](gpu-extraction.json).

A subsequent GPU-backed rendered editing comparison stopped during the first **unchanged full-rebuild reference** block at the existing two-second graphics-completion limit. No candidate block completed, so no timings from this run are included. Last confirmed complete: `studio covariance Gaussian`; first outstanding: `work queued before frame`. The displayed stage still said compilation although the stack had reached playback; the harness now refreshes that stage label before playback. The completion checkpoint does not identify the guilty workload, and no device/context-loss result was captured. [Raw stop](gpu-edits-stopped.json), [screenshot](gpu-edits-stopped.png).

No watchdog was enlarged and no graphics retry was attempted. The live GPU extraction cache is not enabled. Rendered studio-physics and beach controls are prepared but were not run after this stop. Therefore **this pass has no new full-scene physics/FPS regression result for the beach**. The combined reference stall is the next focused stability item. Prior failed beach/studio controls remain recorded in the backlog.

## Validation and reproduction

64 numerical/unit tests pass, covering exact field/surface values, material ordering, normals, block seams, truncation, undo, changing bounds, CPU/GPU switching, bounded eviction, worker protocol, legacy-worker defaults, studio rigid/joint physics, beach fields and carved contacts. Browser and native builds pass; native studio hosting remains unimplemented. Windows/RTX and long sessions are untested. [Tests](numerical.txt), [browser build](build.txt), [native build](native-build.txt).

- `/tests/studio-incremental.html`: explicit buttons for the CPU editing comparison and standalone GPU extraction check. Nothing runs on load.
- `?gpu=1`: the same edit comparison with GPU sampling. **Retain as a stopped research test; investigate the recorded reference stall before rerunning.** GPU extraction reuse is explicit test-only opt-in.
- “Studio physics control” and “Beach control”: unchanged A/A playback, both sides using the same production paths. They are regression measurements, not candidate speedups. Run only after the graphics gate is healthy.
- `node tools/bench-studio-incremental.mjs <output.json>`: CPU-only ABBA rebuild timings.

Next performance leads: spatial picking within large parts; stable sparse grids that tolerate expanding bounds without changing coverage; incremental GPU sampling with explicit state ownership; partial surface uploads. These remain in the backlog.
