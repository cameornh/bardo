// Lighting-only amortization; no change to simulation timesteps. A full sweep
// takes at most .2 simulated seconds (or four rendered frames, whichever is
// sooner). Explicit edits and paused inspection reject the whole history.
export class LightingTiles {
 constructor(){this.cursor=0;}
 plan(rows,time,key,revision,paused=false){
  if(this.key!==key||time<this.time||paused&&revision!==this.revision){this.key=key;this.time=time;this.revision=revision;this.cursor=0;return {ranges:[[0,rows]],blend:1,full:true};}
  if(revision===this.revision)return null;
  const dt=Math.max(0,time-this.time);this.time=time;this.revision=revision;
  if(dt===0||paused){this.cursor=0;return {ranges:[[0,rows]],blend:1,full:true};}
  const count=Math.min(rows,Math.max(Math.ceil(rows/4),Math.ceil(rows*dt/.2))),first=Math.min(count,rows-this.cursor),ranges=[[this.cursor,first]];
  if(first<count)ranges.push([0,count-first]);this.cursor=(this.cursor+count)%rows;
  return {ranges,blend:count===rows?1:.85,full:count===rows};
 }
}
