// Production startup avoids Vite's development module graph and stale servers.
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {startupReportPlugin} from './startup-report-server.mjs';
import {openChromeOpenGL} from './chrome-opengl.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),port=5178;
process.chdir(root);
try{
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<20||major===20&&minor<19||major===21||major===22&&minor<12)throw Error('This build needs Node.js 20.19+ or 22.12+. Installed: '+process.version+'. Install a current Node.js LTS release from https://nodejs.org/.');
 let revision='unknown';try{revision=execFileSync('git',['describe','--always','--dirty'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 console.log('Bardo Windows startup · '+revision+' · '+process.platform+' · Node '+process.version);
 let vite;try{vite=await import('vite');}catch{throw Error('Dependencies are missing. Run npm ci in this folder, then run npm run start:windows again.');}
 console.log('Building the production scene…');
 await vite.build({root});
 await writeFile(new URL('../dist/build-info.json',import.meta.url),JSON.stringify({revision,startup:'startup-v4',built:new Date().toISOString(),platform:process.platform,node:process.version},null,2));
 const server=await vite.preview({root,plugins:[startupReportPlugin(root)],preview:{host:'127.0.0.1',port,strictPort:true,open:false}});
 const sceneURL='http://127.0.0.1:'+port+'/?scene=sand-lab';
 console.log('\nSand lab (use the separate OpenGL Chrome window):\n'+sceneURL+'\n\nSaved startup report (loads no scene):\nhttp://127.0.0.1:'+port+'/?startup=report\n\nKeep this window open. Press Ctrl+C to stop.');
 if(process.platform==='win32'&&!process.argv.includes('--manual-browser')||process.argv.includes('--opengl')){
  try{const browser=await openChromeOpenGL(sceneURL);console.log('Opened separate OpenGL Chrome profile: '+browser.profile);}
  catch(error){console.error('Chrome launcher: '+error.message);}
 }
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.httpServer.close(()=>process.exit(0)));
}catch(error){console.error('\nStartup stopped: '+(error.stack||error));process.exitCode=1;}
