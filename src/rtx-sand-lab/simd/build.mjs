import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Separate binaries: historical scalar kernels are never rebuilt here.
const command=process.env.BARDO_ASC?[process.execPath,[process.env.BARDO_ASC]]:['npm',['exec','--yes','--package=assemblyscript@0.28.9','--','asc']];
for(const name of ['pressure','density'])execFileSync(command[0],[...command[1],
 `src/rtx-sand-lab/simd/${name}.ts`,'--outFile',`src/rtx-sand-lab/simd/${name}.wasm`,
 '--enable','simd','--optimize','--noAssert','--runtime','stub','--memoryBase','1024'],
 {cwd:fileURLToPath(new URL('../../../',import.meta.url)),stdio:'inherit'});
