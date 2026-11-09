import {spawnSync,spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
for(const script of ['native/setup.mjs','native/build.mjs']){const p=spawnSync(process.execPath,[script],{stdio:'inherit'});if(p.error)throw p.error;if(p.status)process.exit(p.status);}
const executable=resolve('.native/tools/deno'+(process.platform==='win32'?'.exe':''));
const child=spawn(executable,['run','--config','native/deno.json','--allow-read','--allow-write=.native','--allow-env','--allow-sys','--allow-ffi','native/main.js',...process.argv.slice(2)],{stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code||0);
