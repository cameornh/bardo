import {runNative} from './runtime.js';
const args=new Map(Deno.args.map(s=>{const [k,...v]=s.replace(/^--/,'').split('=');return [k,v.join('=')||true];}));
await runNative({completion:args.get('completion'),width:Number(args.get('width'))||960,height:Number(args.get('height'))||600,resolution:Number(args.get('resolution'))||1.4,backend:args.get('backend'),headless:args.has('headless'),play:args.has('play'),frames:Number(args.get('frames'))||0,report:args.get('report')||'.native/last-run.json',screenshot:args.get('screenshot'),exit:args.has('frames')});
