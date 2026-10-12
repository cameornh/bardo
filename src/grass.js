import { CHUNK_SIZE, terrainHeight, terrainDistance, terrainNormal } from './terrain.js';

export const GRASS_GRID = 33;
export const GRASS_STEP = CHUNK_SIZE / (GRASS_GRID - 1);
export const GRASS_STRIDE = 10;
const hash = (x,z,s=0) => { const v=Math.sin(x*127.1+z*311.7+s*74.7)*43758.5453;return v-Math.floor(v); };

// Find the upper exposed terrain surface, including ordered CSG edits. Roots
// are geometry attachments; the blades never enter the world's SDF list.
export function grassSurface(x,z,edits=[]) {
  if(!edits.length)return terrainHeight(x,z);
  let y=Math.max(terrainHeight(x,z),...edits.filter(e=>e[4]>0).map(e=>e[1]+e[3]))+.04;
  for(let i=0;i<96&&y>-12;i++){
    const d=terrainDistance(x,y,z,edits);
    if(d<.001)return y;
    y-=Math.max(.0005,d*.9);
  }
  return NaN;
}

export function buildGrassChunk(cx,cz,edits=[]) {
  const records=[],levels=[],x0=cx*CHUNK_SIZE,z0=cz*CHUNK_SIZE;
  const heights=new Float32Array(GRASS_GRID*GRASS_GRID);
  for(let z=0;z<GRASS_GRID;z++)for(let x=0;x<GRASS_GRID;x++)heights[z*GRASS_GRID+x]=grassSurface(x0+x*GRASS_STEP,z0+z*GRASS_STEP,edits);
  // Stable nested cells. Distant levels stand for clumps rather than deleting
  // individual blades; overlap between levels is density blended by the renderer.
  for(let level=0;level<6;level++){
    const cells=Math.max(1,Math.ceil(40/2**level)),spacing=CHUNK_SIZE/cells,offset=records.length/GRASS_STRIDE;
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
      const gx=cx*cells+x,gz=cz*cells+z,seed=hash(gx,gz,level);
      const wx=x0+(x+.25+.5*hash(gx,gz,level+3))*spacing,wz=z0+(z+.25+.5*hash(gx,gz,level+9))*spacing;
      const y=grassSurface(wx,wz,edits);if(!Number.isFinite(y))continue;
      const n=terrainNormal([wx,y,wz],edits);if(n[1]<.65)continue;
      const height=.36+.28*hash(gx,gz,4),width=level<2?.021*2**level:spacing*.24;
      records.push(wx,y+.012,wz,height,...n,width,seed,level);
    }
    const count=records.length/GRASS_STRIDE-offset,segments=level<2?3:1;
    levels.push({offset,count,segments,sigma:spacing});
  }
  const patches=Array.from({length:16},(_,i)=>({x:x0+(i%4+.5)*4,z:z0+(Math.floor(i/4)+.5)*4,minY:Infinity,maxY:-Infinity,levels:levels.map(l=>({...l,indices:[]}))}));
  levels.forEach((level,li)=>{for(let i=level.offset;i<level.offset+level.count;i++){
    const o=i*GRASS_STRIDE,patch=patches[Math.floor((records[o+2]-z0)/4)*4+Math.floor((records[o]-x0)/4)];
    patch.levels[li].indices.push(i);patch.minY=Math.min(patch.minY,records[o+1]);patch.maxY=Math.max(patch.maxY,records[o+1]+records[o+3]);
  }});
  return {records:new Float32Array(records),heights,levels,patches,cx,cz};
}

// Sparse damped springs on a half-meter lattice. The field is independent of
// render LOD. It only transfers body motion to grass; no grass drag on the ball.
export class GrassDynamics {
  constructor(){this.chunks=new Map();this.recovery=2.5;this.contacts=0;this.bent=0;}
  add(key,data,slot){
    const size=GRASS_GRID*GRASS_GRID;
    const chunk={...data,slot,field:new Float32Array(size*4),velocity:new Float32Array(size*3),active:new Set(),dirty:new Set(Array.from({length:GRASS_GRID},(_,i)=>i))};
    this.chunks.set(key,chunk);return chunk;
  }
  remove(key){this.chunks.delete(key);}
  clear(){for(const c of this.chunks.values()){c.field.fill(0);c.velocity.fill(0);c.active.clear();for(let i=0;i<GRASS_GRID;i++)c.dirty.add(i);}this.contacts=0;this.bent=0;}
  step(dt,previous,position,radius){
    this.contacts=0;this.bent=0;
    const reach=radius+.6,dx=position[0]-previous[0],dz=position[2]-previous[2],length2=dx*dx+dz*dz;
    for(const c of this.chunks.values()){
      const x0=c.cx*CHUNK_SIZE,z0=c.cz*CHUNK_SIZE,targets=new Map();
      if(Math.max(previous[0],position[0])+reach>=x0&&Math.min(previous[0],position[0])-reach<=x0+CHUNK_SIZE&&Math.max(previous[2],position[2])+reach>=z0&&Math.min(previous[2],position[2])-reach<=z0+CHUNK_SIZE){
        const xa=Math.max(0,Math.floor((Math.min(previous[0],position[0])-reach-x0)/GRASS_STEP)),xb=Math.min(GRASS_GRID-1,Math.ceil((Math.max(previous[0],position[0])+reach-x0)/GRASS_STEP));
        const za=Math.max(0,Math.floor((Math.min(previous[2],position[2])-reach-z0)/GRASS_STEP)),zb=Math.min(GRASS_GRID-1,Math.ceil((Math.max(previous[2],position[2])+reach-z0)/GRASS_STEP));
        for(let z=za;z<=zb;z++)for(let x=xa;x<=xb;x++){
          const i=z*GRASS_GRID+x,y=c.heights[i];if(!Number.isFinite(y))continue;
          const wx=x0+x*GRASS_STEP,wz=z0+z*GRASS_STEP;
          const t=length2>1e-9?Math.max(0,Math.min(1,((wx-previous[0])*dx+(wz-previous[2])*dz)/length2)):1;
          const bx=previous[0]+dx*t,by=previous[1]+(position[1]-previous[1])*t,bz=previous[2]+dz*t;
          const ox=wx-bx,oz=wz-bz,horizontal=Math.hypot(ox,oz),vertical=Math.max(y-by,by-(y+.6),0);
          const distance=Math.hypot(horizontal,vertical),contactRadius=radius+.23;
          if(distance>=contactRadius)continue;
          const penetration=1-distance/contactRadius,weight=Math.min(1,penetration*2.4);
          // A small forward bias bends the center of the track in travel direction.
          let tx=ox+dx*18,tz=oz+dz*18;const direction=Math.hypot(tx,tz);if(direction<1e-6){tx=1;tz=0;}else{tx/=direction;tz/=direction;}
          targets.set(i,[tx*weight,tz*weight,weight]);c.active.add(i);this.contacts++;
        }
      }
      for(const i of c.active){
        const target=targets.get(i)||[0,0,0],omega=targets.has(i)?22:4.5/this.recovery;
        let magnitude=0;
        for(let axis=0;axis<3;axis++){
          const f=i*4+axis,v=i*3+axis,error=c.field[f]-target[axis],velocity=c.velocity[v];
          // Exact critically damped spring step for a constant target. Stable at
          // any fixed simulation rate, without Euler overshoot or frame timers.
          const j=velocity+omega*error,decay=Math.exp(-omega*dt);
          c.field[f]=target[axis]+(error+j*dt)*decay;c.velocity[v]=(velocity-omega*j*dt)*decay;
          magnitude+=Math.abs(c.field[f])+Math.abs(c.velocity[v]);
        }
        c.dirty.add(Math.floor(i/GRASS_GRID));
        if(magnitude<.001&&!targets.has(i)){c.field.fill(0,i*4,i*4+4);c.velocity.fill(0,i*3,i*3+3);c.active.delete(i);}
        else if(c.field[i*4+2]>.03)this.bent++;
      }
    }
  }
}
