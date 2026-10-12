// Surface-net samples: one Gaussian per crossed cell, no triangle mesh.
const CORNERS = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
export function hash(x,y,z) { const n=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453; return n-Math.floor(n); }

export function sampleSurface(world, id, spacing) {
  const bound=world.objects[id].bound, count=Math.ceil(2*bound/spacing), h=2*bound/count, side=count+1;
  const field=new Float32Array(side**3);
  const index=(x,y,z)=>(z*side+y)*side+x;
  for(let z=0;z<side;z++)for(let y=0;y<side;y++)for(let x=0;x<side;x++)field[index(x,y,z)]=world.localDistance(id,x*h-bound,y*h-bound,z*h-bound);
  const centers=[],normals=[],radii=[],seeds=[];
  for(let z=0;z<count;z++)for(let y=0;y<count;y++)for(let x=0;x<count;x++){
    const values=CORNERS.map(c=>field[index(x+c[0],y+c[1],z+c[2])]);
    if(values.every(v=>v>=0)||values.every(v=>v<0))continue;
    let p=[0,0,0], crossings=0;
    for(const [a,b] of EDGES){
      if((values[a]<0)===(values[b]<0))continue;
      const t=values[a]/(values[a]-values[b]);
      for(let j=0;j<3;j++)p[j]+=CORNERS[a][j]+t*(CORNERS[b][j]-CORNERS[a][j]);
      crossings++;
    }
    p=p.map((v,i)=>(v/crossings+[x,y,z][i])*h-bound);
    // Project back onto the actual field after averaging edge intersections.
    for(let it=0;it<2;it++){
      const d=world.localDistance(id,...p), n=world.normal(id,p,true);
      p=p.map((v,i)=>v-d*n[i]);
    }
    const n=world.normal(id,p,true), seed=hash(x,y,z);
    centers.push(...p);normals.push(...n);radii.push(h*.59);seeds.push(seed);
    if (id===0 && world.edits.length) {
      // Sharp CSG cells can contain two distinct faces. Preserve samples on both
      // faces instead of allowing one averaged tangent to bridge the cut rim.
      for (const [a,b] of EDGES) {
        if ((values[a]<0)===(values[b]<0)) continue;
        const t=values[a]/(values[a]-values[b]);
        const edge=CORNERS[a].map((v,i)=>([x,y,z][i]+v+t*(CORNERS[b][i]-v))*h-bound);
        const en=world.normal(id,edge,true);
        if(en.reduce((sum,v,i)=>sum+v*n[i],0)>.88)continue;
        for(let it=0;it<3;it++){const d=world.localDistance(id,...edge),g=world.normal(id,edge,true);for(let j=0;j<3;j++)edge[j]-=d*g[j];}
        centers.push(...edge);normals.push(...world.normal(id,edge,true));radii.push(h*.42);seeds.push(seed);
      }
    }
    if(id===4){
      // Low-frequency fuzzy silhouette, not simulated individual hairs.
      const length=.045+.085*seed;
      centers.push(...p.map((v,i)=>v+n[i]*length));normals.push(...n);radii.push(h*.40);seeds.push(seed*.71);
    }
  }
  return { centers:new Float32Array(centers),normals:new Float32Array(normals),radii:new Float32Array(radii),seeds:new Float32Array(seeds),count:radii.length,spacing:h };
}

export function sampleRegion(distance, normal, minimum, maximum, spacing) {
  const size=minimum.map((v,i)=>Math.round((maximum[i]-v)/spacing));
  const sx=size[0]+1, sy=size[1]+1, sz=size[2]+1;
  const values=new Float32Array(sx*sy*sz), index=(x,y,z)=>(z*sy+y)*sx+x;
  for(let z=0;z<sz;z++)for(let y=0;y<sy;y++)for(let x=0;x<sx;x++) {
    values[index(x,y,z)]=distance(minimum[0]+x*spacing,minimum[1]+y*spacing,minimum[2]+z*spacing);
  }
  const centers=[],normals=[],radii=[],seeds=[];
  const project=p=>{
    for(let it=0;it<4;it++){
      const n=normal(p),f0=distance(...p),epsilon=.005;
      const gradient=(distance(...p.map((v,i)=>v+n[i]*epsilon))-f0)/epsilon;
      const correction=f0/Math.max(Math.abs(gradient),.2);
      for(let i=0;i<3;i++)p[i]-=n[i]*correction;
    }
  };
  for(let z=0;z<size[2];z++)for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++) {
    const f=CORNERS.map(c=>values[index(x+c[0],y+c[1],z+c[2])]);
    if(f.every(v=>v>=0)||f.every(v=>v<0))continue;
    const p=[0,0,0];let hits=0;
    for(const [a,b] of EDGES){
      if((f[a]<0)===(f[b]<0))continue;
      const t=f[a]/(f[a]-f[b]);hits++;
      for(let i=0;i<3;i++)p[i]+=CORNERS[a][i]+t*(CORNERS[b][i]-CORNERS[a][i]);
    }
    for(let i=0;i<3;i++)p[i]=minimum[i]+([x,y,z][i]+p[i]/hits)*spacing;
    project(p);
    const n=normal(p);
    centers.push(...p);normals.push(...n);radii.push(spacing*.65);seeds.push(hash(...p));
    // CSG rims have two faces in one cell. Give each face its own support;
    // field clipping can then reject the overhang without opening a hole.
    for(const [a,b] of EDGES){
      if((f[a]<0)===(f[b]<0))continue;
      const t=f[a]/(f[a]-f[b]);
      const edge=CORNERS[a].map((v,i)=>minimum[i]+([x,y,z][i]+v+t*(CORNERS[b][i]-v))*spacing);
      if(normal(edge).reduce((sum,v,i)=>sum+v*n[i],0)>.85)continue;
      project(edge);
      centers.push(...edge);normals.push(...normal(edge));radii.push(spacing*.5);seeds.push(hash(...edge));
    }
  }
  return {centers:new Float32Array(centers),normals:new Float32Array(normals),radii:new Float32Array(radii),seeds:new Float32Array(seeds),count:radii.length};
}

export function sampleGround(spacing=.55,extent=13){
 const centers=[],normals=[],radii=[],seeds=[];
 for(let z=-extent;z<=extent;z+=spacing)for(let x=-extent;x<=extent;x+=spacing){
  centers.push(x,0,z);normals.push(0,1,0);radii.push(spacing*.56);seeds.push(hash(x,0,z));
 }
 // A sparse outer ring extends the same flat field toward the horizon.
 // Both rings share a plane, so their overlap has no geometry discontinuity.
 for(let z=-52;z<=52;z+=1.65)for(let x=-52;x<=52;x+=1.65){
  if(Math.abs(x)<extent-1&&Math.abs(z)<extent-1)continue;
  centers.push(x,0,z);normals.push(0,1,0);radii.push(1.65*.56);seeds.push(hash(x,0,z));
 }
 return {centers:new Float32Array(centers),normals:new Float32Array(normals),radii:new Float32Array(radii),seeds:new Float32Array(seeds),count:radii.length};
}
