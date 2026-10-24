// The graphics processor is shared with the renderer. Keep offload only when
// measured wall time (including transfers) beats the existing CPU path.
// A rejection is latched for the session: no recurring probes or retry storm.
export class PressureBudget {
 constructor(){this.cpu=[];this.gpu=[];this.reason=null;this.minimumCount=8192;}
 accepts(n){return !this.reason&&n>=this.minimumCount&&(!this.count||Math.abs(n/this.count-1)<.2);}
 get ready(){return this.cpu.length>=4;}
 get cpuMs(){return this.cpu.slice(1).reduce((a,b)=>a+b,0)/Math.max(1,this.cpu.length-1);}
 recordCPU(ms,n){if(!this.accepts(n)||this.ready)return;this.count??=n;this.cpu.push(ms);}
 recordGPU(ms){
  this.gpu.push(ms);if(this.gpu.length>3)this.gpu.shift();
  if(this.gpu.length===3&&this.gpu.reduce((a,b)=>a+b,0)/3>=this.cpuMs*.95)this.reason='CPU measured faster with current graphics load';
 }
}
