import {mkdir,readFile,writeFile,chmod,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const version='2.9.8',targets={
 'darwin-x64':['x86_64-apple-darwin','4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c'],
 'darwin-arm64':['aarch64-apple-darwin','9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e'],
 'win32-x64':['x86_64-pc-windows-msvc','cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf'],
 'win32-arm64':['aarch64-pc-windows-msvc','b413b92b735b50c198e8fe3b85af1aa50e29d5f72e229aab701d132286e14cef']
};
const target=targets[process.platform+'-'+process.arch];if(!target)throw Error('Native host currently supports macOS and Windows');
await mkdir('.native/tools',{recursive:true});const exe=resolve('.native/tools/deno'+(process.platform==='win32'?'.exe':''));
const check=spawnSync(exe,['--version'],{encoding:'utf8'});if(!check.error&&check.stdout.startsWith('deno '+version+' ')){console.log('Native runtime '+version+' already installed');process.exit(0);}
console.log('Downloading verified native wgpu runtime '+version+'…');
const response=await fetch(`https://github.com/denoland/deno/releases/download/v${version}/deno-${target[0]}.zip`,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Runtime download: HTTP '+response.status);
const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==target[1])throw Error('Runtime checksum mismatch; refusing to install');
const zip=resolve('.native/tools/deno.zip');await writeFile(zip,bytes);
let extracted;if(process.platform==='win32')extracted=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${zip.replaceAll("'","''")}' -DestinationPath '${dirname(exe).replaceAll("'","''")}' -Force`],{stdio:'inherit'});else extracted=spawnSync('unzip',['-o',zip,'-d',dirname(exe)],{stdio:'inherit'});
if(extracted.error||extracted.status)throw extracted.error||Error('Runtime extraction failed');await rm(zip);if(process.platform!=='win32')await chmod(exe,0o755);console.log('Installed locally in .native/tools; no system settings changed');
