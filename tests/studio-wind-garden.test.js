import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {validateLibrary,LIMITS} from '../src/asset-studio/model.js';
import {supportedMark} from '../src/asset-studio/gaussian-marks.js';
import {exampleWorlds} from '../src/asset-studio/example-worlds.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';

const garden=exampleWorlds.find(t=>t.id==='wetland');
const plants=l=>l.world.instances.map(i=>l.assets.find(a=>a.id===i.assetId));

test('one seeded architecture grows editable, supported shoots at different stages',()=>{
  const first=garden.create(),same=garden.create(null,garden.seed),other=garden.create(null,0);
  assert.deepEqual(plants(first),plants(same));
  assert.deepEqual(first.world,same.world);
  assert.notDeepEqual(plants(first),plants(other));
  for(const seed of [0,1,2,3,32,2026,garden.seed,4294967295]){
    const l=garden.create(null,seed), palette=new Map(l.materials.map(m=>[m.id,m]));
    validateLibrary(l);
    const clumps=plants(l), parts=clumps.flatMap(a=>a.parts);
    assert.ok(parts.length<=LIMITS.previewParts);
    assert.ok(clumps.every(a=>a===clumps[0]));
    assert.deepEqual(new Set(l.families.find(f=>f.id==='example-rushes').members.map(m=>m.assetId)),new Set(clumps.map(a=>a.id)));
    const heights=[],flowering=[];
    for(const [index,a] of clumps.entries()){
      const stems=a.parts.filter(p=>p.joint.parentId==='ground');
      const lengths=stems.map(base=>{
        const tip=a.parts.find(p=>p.joint.parentId===base.id);
        const length=2*(tip.stamps[0].size[1]+base.stamps[0].size[1]);
        assert.ok(base.stamps[0].size[0]>tip.stamps[0].size[0]);
        assert.ok(base.joint.stiffness>tip.joint.stiffness);
        assert.ok(tip.marks.some(m=>m.id.startsWith('leaf-')&&Math.abs(m.root[1])<1e-8));
        for(const p of [base,tip])for(const m of p.marks)assert.ok(supportedMark(p,m,palette));
        flowering.push(tip.marks.some(m=>m.id.startsWith('spikelet')));
        return length;
      });
      assert.ok(lengths[0]>lengths.at(-1));
      heights.push(...lengths.map(h=>h*l.world.instances[index].transform.scale[1]));
    }
    assert.ok(Math.max(...heights)/Math.min(...heights)>2.5);
    assert.deepEqual(new Set(flowering),new Set([true,false]));
  }
});

test('stem tips follow reversed wind, recover in calm air and keep their roots attached',async()=>{
  const l=garden.create(),sim=await StudioPhysics.create(l,'world');
  try{
    const wind=sim.stand.windWorld;
    const tips=[...wind.bodies.values()].filter(r=>r.part.id.startsWith('tip-'));
    const end=r=>new Vector3(0,2*r.part.stamps[0].size[1],0).applyMatrix4(r.matrix);
    const initial=tips.map(end);
    const heights=initial.map(v=>v.y), mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
    const phase=(speed,heading)=>{
      sim.wind={speed,heading,turbulence:.8};
      const displacements=[];
      for(let i=0;i<420;i++){
        sim.step();
        if(i>=300&&i%12===0)displacements.push(mean(tips.map((r,k)=>end(r).x-initial[k].x)));
      }
      return mean(displacements);
    };
    const calm=phase(0,0),east=phase(8,0),west=phase(8,180),recovered=phase(0,0);
    assert.ok(east>calm+.1&&west<calm-.1,`calm ${calm}, east ${east}, west ${west}`);
    assert.ok(Math.abs(recovered-calm)<.1);
    assert.ok(tips.every((r,k)=>end(r).y>heights[k]*.87));
    assert.equal(wind.broken,0);assert.deepEqual(wind.skipped,[]);
    assert.equal(wind.bodies.size,2*tips.length);
    for(const link of wind.joints){
      const anchor=link.parent?wind.worldPoint(link.parent,link.anchorParent):link.anchorParent;
      assert.ok(wind.worldPoint(link.child,link.anchorChild).distanceTo(anchor)<.008);
    }
  }finally{sim.dispose();}
});

test('a hit breaks only the struck placement; a gale can break untouched landscape joints',async()=>{
  const library=garden.create(),sim=await StudioPhysics.create(library,'world');
  try{
    const stand=sim.stand,wind=stand.windWorld,land=sim.sand.landscape;
    const center=[...stand.planted.values()][0],remote=land.crowns(8,4)[0]??land.crowns(9,4)[0];
    assert.ok(remote&&Math.hypot(remote.x,remote.z)>50);
    const asset=library.assets.find(a=>a.id===library.world.instances[0].assetId);
    assert.equal(stand.assets[remote.variant],asset);
    sim.wind={speed:0,heading:0,turbulence:0};
    const target=stand.activate(remote),other=stand.activate(center);
    assert.deepEqual(target.records.map(r=>r.part),other.records.map(r=>r.part));
    const tip=target.records.find(r=>r.part.id==='tip-0');
    sim.addPulse(tip.key,new Vector3(0,tip.part.stamps[0].size[1]*tip.scale.y,0),new Vector3(10000,0,0),.05);
    for(let i=0;i<18;i++)sim.step();
    assert.ok(target.records.some(r=>r.jointBroken));
    assert.ok(other.records.every(r=>!r.jointBroken));assert.equal(wind.broken,0);
    const damaged=target.records.find(r=>r.jointBroken);
    const matrix=damaged.matrix.clone();
    stand.release(target);
    assert.ok(stand.pose(remote,damaged.part,matrix.clone()).equals(matrix));
    const resumed=stand.activate(remote).records.find(r=>r.part===damaged.part);
    assert.equal(resumed.jointBroken,true);assert.ok(resumed.matrix.equals(matrix));

    sim.wind={speed:100,heading:0,turbulence:.8};
    for(let i=0;i<160;i++)sim.step();
    assert.ok(wind.broken>0);
    const fresh=land.crowns(8,4).find(c=>c.id!==remote.id&&
      asset.parts.some(p=>wind.get(stand.sample(c).site.id,p.id).jointBroken));
    assert.ok(fresh&&!stand.active.has(fresh.id));
    const sample=stand.sample(fresh),poses=asset.parts.map(p=>stand.pose(fresh,p,matrix.clone()));
    const local=stand.activate(fresh);
    for(const [i,r] of local.records.entries()){
      assert.equal(!!r.jointBroken,!!wind.get(sample.site.id,r.part.id).jointBroken);
      assert.ok(r.matrix.equals(poses[i]));
    }
  }finally{sim.dispose();}
});
