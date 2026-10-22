import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Pinned build tool only. The browser loads the committed WASM binary, and
// falls back to JavaScript if compilation/loading is unavailable.
execFileSync('npm',['exec','--yes','--package=assemblyscript@0.28.9','--','asc',
 'src/sand-lab/kernels/neighbors.ts','--outFile','src/sand-lab/kernels/neighbors.wasm',
 '--optimize','--noAssert','--runtime','stub','--memoryBase','1024'],
 {cwd:fileURLToPath(new URL('../../../',import.meta.url)),stdio:'inherit'});
