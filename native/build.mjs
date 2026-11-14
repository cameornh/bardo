import {build} from 'esbuild';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
await mkdir('.native/generated',{recursive:true});
const nativeAssets={name:'native-assets',setup(b){
 b.onLoad({filter:/\.css\?inline$/},async a=>({contents:'export default '+JSON.stringify(await readFile(a.path.replace(/\?inline$/,''),'utf8')),loader:'js'}));
 b.onResolve({filter:/\.css\?inline$/},a=>({path:resolve(a.resolveDir,a.path),namespace:'file'}));
 b.onLoad({filter:/\.js$/},async a=>{if(a.path.includes('node_modules'))return;let s=await readFile(a.path,'utf8');s=s.replace(/new URL\((['"])([^'"]+\.wasm)\1,\s*import\.meta\.url\)/g,(_,q,p)=>JSON.stringify('/'+relative(root,resolve(dirname(a.path),p)).replaceAll('\\','/')));return {contents:s,loader:'js'};});
}};
await build({entryPoints:['src/rtx-sand-lab/main.js'],outfile:'.native/generated/scene.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[nativeAssets],logLevel:'info'});
await build({entryPoints:['native/compiler-worker.js'],outfile:'.native/generated/compiler-worker.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[nativeAssets],logLevel:'info'});
// Isolated representation experiments are not loaded by the normal scene.
await build({entryPoints:['src/rtx-sand-lab/representation/experiment.js'],outfile:'.native/generated/representation.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[nativeAssets],logLevel:'info'});
await build({entryPoints:['src/rtx-sand-lab/particle-compaction/experiment.js'],outfile:'.native/generated/particle-compaction.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[nativeAssets],logLevel:'info'});
await build({entryPoints:['src/rtx-sand-lab/sand-bricks.worker.js','src/rtx-sand-lab/collision-mesh.worker.js'],outdir:'.native/generated',bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[nativeAssets],logLevel:'info'});
await build({entryPoints:['src/rtx-sand-lab/empty-space/experiment.js'],outfile:'.native/generated/empty-space.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[nativeAssets],logLevel:'info'});
let result;if(process.platform==='darwin')result=spawnSync('clang',['-dynamiclib','-fobjc-arc','-framework','Cocoa','-framework','QuartzCore','native/window/macos.m','-o','.native/window.dylib'],{stdio:'inherit'});
else if(process.platform==='win32'){
 result=spawnSync('clang',['-shared','native/window/windows.c','-o','.native/window.dll','-luser32'],{stdio:'inherit'});
 if(result.error?.code==='ENOENT')result=spawnSync('cl',['/nologo','/LD','/TC','/std:c11','native/window/windows.c','/Fo.native/window.obj','/link','/OUT:.native/window.dll','user32.lib'],{stdio:'inherit'});
 if(result.error?.code==='ENOENT')throw Error('A C compiler is required: install LLVM clang, or run from a Visual Studio C++ developer terminal. See native/README.md.');
}
else throw Error('Native window build supports macOS and Windows');
if(result.error)throw result.error;if(result.status)process.exit(result.status);
