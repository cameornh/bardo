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
    assert.deepEqual(new Set(l.families.find(f=>f.id==='example-rushes').members.map(m=>m.assetId)),new Set(clumps.map(a=>a.id)));
    const heights=[],flowering=[];
    for(const a of clumps){
      const stems=a.parts.filter(p=>p.joint.parentId==='ground');
      const lengths=stems.map(base=>{
        const tip=a.parts.find(p=>p.joint.parentId===base.id);
        const length=2*(tip.stamps[0].size[1]+base.stamps[0].size[1]);
        assert.ok(base.stamps[0].size[0]>tip.stamps[0].size[0]);
        assert.ok(base.joint.stiffness>tip.joint.stiffness);
        for(const p of [base,tip])for(const m of p.marks)assert.ok(supportedMark(p,m,palette));
        flowering.push(tip.marks.some(m=>m.id.startsWith('spikelet')));
        return length;
      });
      assert.ok(lengths[0]>lengths.at(-1));
      heights.push(...lengths);
    }
    assert.ok(Math.max(...heights)/Math.min(...heights)>2.5);
    assert.deepEqual(new Set(flowering),new Set([true,false]));
  }
});

test('stem tips follow reversed wind, recover in calm air and keep their roots attached',async()=>{
  const l=garden.create(),sim=await StudioPhysics.create(l,'world');
  try{
    const tips=[...sim.bodies.values()].filter(r=>r.part.id.startsWith('tip-'));
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
    assert.equal(sim.broken,0);assert.deepEqual(sim.skipped,[]);
    assert.equal(sim.bodies.size,2*tips.length);
    for(const link of sim.joints){
      const anchor=link.parent?sim.worldPoint(link.parent,link.anchorParent):link.anchorParent;
      assert.ok(sim.worldPoint(link.child,link.anchorChild).distanceTo(anchor)<.008);
    }
  }finally{sim.dispose();}
});
