import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const name of ['transport','pressure','transfer'])execFileSync('npm',['exec','--yes','--package=assemblyscript@0.28.9','--','asc',
 `src/rtx-sand-lab/fields/kernels/${name}.ts`,'--outFile',`src/rtx-sand-lab/fields/kernels/${name}.wasm`,
 '--optimize','--noAssert','--runtime','stub','--memoryBase','1024'],
 {cwd:fileURLToPath(new URL('../../../../',import.meta.url)),stdio:'inherit'});
