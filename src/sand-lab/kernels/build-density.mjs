import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Pinned build tool only; the application loads the committed binary and
// keeps the JavaScript solver as its fallback. No runtime npm dependency.
execFileSync('npm',['exec','--yes','--package=assemblyscript@0.28.9','--','asc',
 'src/sand-lab/kernels/density.ts','--outFile','src/sand-lab/kernels/density.wasm',
 '--optimize','--noAssert','--runtime','stub','--memoryBase','1024'],
 {cwd:fileURLToPath(new URL('../../../',import.meta.url)),stdio:'inherit'});
