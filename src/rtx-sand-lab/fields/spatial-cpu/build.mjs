import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const command=process.env.BARDO_ASC?[process.execPath,[process.env.BARDO_ASC]]:['npm',['exec','--yes','--package=assemblyscript@0.28.9','--','asc']];
execFileSync(command[0],[...command[1],'src/rtx-sand-lab/fields/spatial-cpu/neighbors.ts','--outFile','src/rtx-sand-lab/fields/spatial-cpu/neighbors.wasm','--optimize','--noAssert','--runtime','stub','--memoryBase','1024'],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),stdio:'inherit'});
