import test from 'node:test';
import assert from 'node:assert/strict';
import {Group, Matrix4, PerspectiveCamera, Ray, Vector3} from 'three';
import {PaintedView} from '../src/asset-studio/painted-view.js';
import {MarkBrush} from '../src/asset-studio/paint-brush.js';
import {clone, part, seedLibrary, stamp, validateLibrary} from '../src/asset-studio/model.js';
import {flowerExample} from './fixtures/studio-flower.js';
import {brushCopies, brushFrame, MAX_MARKS, projectMount, strokePoints, supportedMark} from '../src/asset-studio/gaussian-marks.js';
import {exportAsset, importAsset} from '../src/asset-studio/asset-package.js';
import {PaintedHinges} from '../src/asset-studio/painted-hinges.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';

function flower() {
  const library = seedLibrary(), example = flowerExample(library);
  library.materials.push(...example.materials);
  library.assets.push(example.asset);
  return {library, sculpt: example.asset, stem: example.asset.parts[0]};
}

test('an exported flower carries every paint material and remaps conflicting mark-only colors', () => {
  const {library, sculpt, stem} = flower();
  validateLibrary(library);
  const file = JSON.parse(JSON.stringify(exportAsset(library, sculpt.id)));
  assert.equal(file.materials.length, 5);
  const pink = stem.marks[0].materialId;
  const dest = seedLibrary();
  dest.materials.push({...library.materials.find(m => m.id === pink), color:'#333333'});
  const result = importAsset(dest, file), copied = result.asset.parts[0].marks;
  assert.equal(copied.length, 21);
  assert.notEqual(copied[0].materialId, pink);
  assert.deepEqual({...copied[0], materialId:pink}, stem.marks[0]);
  assert.equal(result.library.materials.find(m => m.id === copied[0].materialId).color, '#e56294');
  validateLibrary(result.library);
});

test('older sculpts stay valid and invalid attachment frames and budgets are rejected', () => {
  validateLibrary(seedLibrary());
  const {library, stem} = flower(), original = clone(stem.marks);
  for (const mutate of [
    m => {m[0].up = m[0].axis;}, m => {m[0].flex = Infinity;}, m => {m[0].materialId = 'missing';},
    m => {m[1].id = m[0].id;}, m => {while(m.length <= MAX_MARKS)m.push({...m[0], id:'extra'+m.length});}
  ]) {
    stem.marks = clone(original); mutate(stem.marks);
    assert.throws(() => validateLibrary(library), /Gaussian/);
  }
});

test('mounts project to the actual signed surface, lose support when carved, and recover on undo', () => {
  const {library, stem} = flower(), palette = new Map(library.materials.map(m => [m.id,m]));
  const mark = stem.marks.at(-1), site = projectMount(stem,mark.root.map((x,i) => i===1?x+.001:x),.1);
  assert.ok(site && Math.abs(site.normal.length()-1)<1e-8);
  assert.equal(projectMount(stem,[7,8,9],.05),null);
  assert.ok(stem.marks.every(m => supportedMark(stem,m,palette)));
  stem.stamps.push(stamp('sphere','subtract',mark.root,[.14,.14,.14],'stone',0));
  assert.ok(!supportedMark(stem,mark,palette));
  stem.stamps.pop(); assert.ok(supportedMark(stem,mark,palette));
  assert.ok(!supportedMark(stem,{...mark,materialId:'water'},palette));
  palette.set(site.materialId, palette.get('water'));
  assert.ok(!supportedMark(stem,mark,palette));
});

test('stroke spacing and symmetry are independent of pointer event density', () => {
  const samples = strokePoints([0,0,0],[.5,0,0],.25,.5);
  assert.deepEqual(samples.map(p=>p[0]),[.125,.25,.375,.5]);
  assert.deepEqual(strokePoints([0,0,0],[5,0,0],.25,.5),[[5,0,0]]);
  assert.equal(brushCopies([0,1,0],'mirror').length,1);
  const pole=brushCopies([0,1,0],'6',true);
  assert.equal(new Set(pole.map(c=>c.transform([1,0,0]).map(x=>x.toFixed(2)).join(','))).size,6);
  assert.deepEqual(brushCopies([1,2,3],'mirror')[1].point,[-1,2,3]);
  for(const symmetry of ['4','6','8']) {
    const copies=brushCopies([1,2,0],symmetry);
    assert.equal(copies.length,Number(symmetry));
    for(const c of copies)assert.ok(Math.abs(Math.hypot(c.point[0],c.point[2])-1)<1e-8);
  }
  const frame=brushFrame(new Vector3(0,1,0),new Vector3(0,1,0),1.2);
  assert.ok(Math.abs(new Vector3(...frame.axis).dot(new Vector3(...frame.up)))<1e-8);
});

test('fixed-step hinges respond to wind, a moving host and individual cursor loads, then settle', () => {
  const palette = new Map(seedLibrary().materials.map(m => [m.id,m]));
  const p=part('Support',[stamp('box','add',[0,0,0],[1,1,1],'wood',0)]);
  const leaf={id:'leaf',kind:'leaf',root:[0,0,1],axis:[0,0,1],up:[1,0,0],
    length:.5,width:.25,curl:0,flex:.8,materialId:'wood'};
  p.marks=[leaf,{...leaf,id:'stiff',flex:0}];
  const hinges=new PaintedHinges(), body={key:'host',part:p,scale:new Vector3(1,1,1),matrix:new Matrix4()};
  hinges.attach(body,palette);
  const [moving,stiff]=hinges.parts.get(body.key);
  let time=0;
  const step=(n,speed=0)=>{for(let i=0;i<n;i++)hinges.step(1/120,{speed,heading:0},0,time+=1/120);};
  step(300,18);assert.ok(moving.angle>.15);assert.equal(stiff.angle,0);
  step(400);assert.ok(Math.abs(moving.angle)<1e-4);
  body.matrix.makeTranslation(1,0,0);step(1);assert.ok(moving.angle<0);
  step(400);
  const h=hinges.grab(body.key, leaf.id, new Vector3(1,0,1.5));
  h.cursorForce.set(-30,0,0);h.until=time+.5;
  step(40);assert.ok(moving.angle<-.1);
  step(500);assert.equal(h.cursorForce,null);assert.ok(Math.abs(moving.angle)<1e-4);
  assert.equal(stiff.angle,0);assert.equal(hinges.count,2);
});

test('a placed flower and a bare stem use the same rigid bodies and collision proxies', async () => {
  const {library, sculpt, stem}=flower();
  library.world.instances=[{id:'flower',assetId:sculpt.id,transform:{position:[2,0,3],rotation:[0,35,0],scale:[1.2,1.2,1.2]}}];
  const painted=await StudioPhysics.create(library,'world',sculpt.id);
  try {
    const key='flower:'+stem.id;
    assert.equal(painted.paintedHinges.count,21);
    assert.equal(painted.paintedHinges.parts.get(key)[0].owner,painted.bodies.get(key));
    for(let i=0;i<60;i++)painted.advance(1/60);
    assert.ok(painted.paintedHinges.parts.get(key).some(h=>Math.abs(h.angle)>.005));
    const bareLibrary=clone(library);
    delete bareLibrary.assets.at(-1).parts[0].marks;
    const bare=await StudioPhysics.create(bareLibrary,'world',sculpt.id);
    try {
      assert.equal(bare.bodies.size,1); assert.equal(painted.bodies.size,bare.bodies.size);
      assert.equal(painted.colliderCount,bare.colliderCount);assert.equal(painted.joints.length,bare.joints.length);
    } finally {bare.dispose();}
  } finally {painted.dispose();}
});


test('a drag from one pole previews a rosette, cancels cleanly and commits as one edit', () => {
  const library=seedLibrary(), material=library.materials.find(m=>m.id==='wood');
  const p=part('Bud',[stamp('sphere','add',[0,0,0],[1,1,1],'wood',0)]);
  const values={repeat:'6','mark-kind':'ribbon','mark-bias':1.5,'mark-taper':0,'mark-length':.5,'mark-width':.28,'mark-curl':.3,'mark-roll':0,'mark-flex':.6};
  const group=new Group(),host=new Group();host.userData.partId=p.id;group.add(host);
  let preview,edits=0;
  const view={groups:new Map([['editor',group]]),camera:new PerspectiveCamera(),
    ray:e=>new Ray(new Vector3(e.clientX/100,1,3),new Vector3(0,0,-1)),
    paintView:{preview:marks=>{preview=marks;},clearPreview:()=>{preview=null;}}};
  const brush=new MarkBrush(key=>({value:values[key]}),view,msg=>assert.fail(msg));
  const draw=()=>{
    brush.start({clientX:0,clientY:0},{point:new Vector3(0,1,0),partId:p.id},p,library.materials,material,.1);
    brush.move({clientX:40,clientY:0});
    assert.equal(preview.length,6);assert.ok(preview.every(m=>Math.abs(m.length-.4)<1e-6));
    assert.equal(new Set(preview.map(m=>m.axis.map(x=>x.toFixed(3)).join(','))).size,6);
  };
  draw();assert.equal(brush.finish(false,()=>edits++),false);assert.equal(p.marks,undefined);
  draw();assert.ok(brush.finish(true,()=>edits++));assert.equal(edits,1);
  assert.equal(p.marks.length,6);assert.equal(preview,null);
});


test('a single ellipsoid dab batches separately, picks at its visible surface and highlights in the editor', () => {
  const {library,sculpt,stem}=flower();
  const dab={...stem.marks.at(-1),kind:'dab',id:'soft-dab',axis:[0,0,1],up:[0,1,0],curl:0,length:.5,width:.35};
  stem.marks=[stem.marks[0],dab];
  const group=new Group(),host=new Group();host.userData.partId=stem.id;group.userData.assetId=sculpt.id;group.add(host);
  const paint=new PaintedView({},'');
  try {
    paint.rebuild({library,groups:new Map([['editor',group]])});
    const [petals,dabs]=paint.batches;
    assert.equal(dabs.mesh.geometry.index.count,6);
    assert.equal(petals.mesh.geometry.index.count,180);
    const center=new Vector3(...dab.root).addScaledVector(new Vector3(...dab.axis),dab.length*.5);
    const hit=paint.pick(new Ray(center.clone().add(new Vector3(2,0,0)),new Vector3(-1,0,0)));
    assert.equal(hit.mark,dab);assert.ok(hit.point.x>center.x);
    paint.select(stem.id,dab.id);
    assert.equal(dabs.mesh.geometry.attributes.highlight.getX(0),1);
    assert.equal(petals.mesh.geometry.attributes.highlight.getX(0),0);
    paint.select(stem.id,null);assert.equal(dabs.mesh.geometry.attributes.highlight.getX(0),0);
  } finally {paint.dispose();}
});

test('a hinge follows its supporting fragment when the part separates', () => {
  const {library,stem}=flower(),paint=new PaintedHinges(),scale=new Vector3(1,1,1);
  const body={part:stem,key:'original',scale,matrix:new Matrix4()};
  paint.attach(body,new Map(library.materials.map(m=>[m.id,m])));
  const h=paint.parts.get(body.key)[0],root=h.anchor.toArray();
  paint.step(1/120,{},-9.81,0);
  const detached={matrix:new Matrix4().makeTranslation(2,0,0)};
  const nodes=[[15,15,15],root].map(center=>({shapes:[{center,half:[.25,.25,.25]}]}));
  body.structure={bodies:new Set([body,detached]),owners:[body,detached],indices:[0,1],
    grid:{nodes,lo:[-1,-1,-1],dims:[20,20,20],step:[1,1,1],scale:[1,1,1],cells:new Map()}};
  paint.step(1/120,{},-9.81,1/120);
  assert.equal(h.owner,detached);assert.ok(paint.revision>0);
  assert.ok(h.previous.distanceTo(h.probe.clone().applyMatrix4(detached.matrix))<1e-10);
});
