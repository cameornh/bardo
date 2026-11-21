import {Vector3} from 'three';
import {asset,material,part,stamp,uid,LIMITS} from './model.js';
import {brushFrame,projectMount} from './gaussian-marks.js';

// An editable example constructed with exactly the same mounts and materials
// as the brush. Creating it is an explicit, undoable library action.
export function flowerExample(library){
 if(library.assets.length>=LIMITS.assets)throw Error('Asset limit reached.');
 const colors=[['Stem green','#52753a'],['Leaf green','#578c49'],['Rose petal','#e56294'],['Inner petal','#f793ab'],['Pollen','#e7a038']];
 const definitions=colors.map(([name,color])=>library.materials.find(m=>m.name===name&&m.color===color&&m.phase==='solid'&&m.liquidity===0)
   ??material(uid(),name,color,{roughness:.77,density:660,grainDepth:.12}));
 const additions=definitions.filter(m=>!library.materials.includes(m));
 if(library.materials.length+additions.length>LIMITS.materials)throw Error('The material library has no room for the flower palette.');
 const [stem,leaf,rose,pink,pollen]=definitions.map(m=>m.id);
 const a=asset('Garden cosmos'),p=part('Stem and flower head',[
  stamp('capsule','add',[0,.77,0],[.055,.72,.055],stem,.025),
  stamp('sphere','add',[0,1.52,0],[.19,.13,.19],pollen,.025)]);
 a.spacing=.05;a.parts=[p];p.physics={fixed:true};p.marks=[];
 const add=(kind,start,dir,up,length,width,curl,flex,materialId)=>{
  const mount=projectMount(p,start,.12);
  if(!mount)throw Error('Flower attachment has no mount.');
  p.marks.push({id:uid(),kind,root:mount.root,...brushFrame(dir,up),length,width,curl,flex,materialId});
 };
 for(let layer=0;layer<2;layer++)for(let i=0;i<(layer?8:10);i++){
  const theta=(i+(layer?.48:0))*Math.PI*2/(layer?8:10),x=Math.cos(theta),z=Math.sin(theta);
  const lift=(layer?.43:.08)+.09*Math.cos(i*2.4);
  add('petal',[x*.164,1.55+layer*.04,z*.164],new Vector3(x,lift,z),new Vector3(0,1,0),
    (layer?.37:.57)*(1+.06*Math.sin(i*2.2)),layer?.30:.27,layer?.42:.55,.62,layer?pink:rose);
 }
 for(const [theta,y,len] of [[.3,.50,.55],[3.42,.87,.48],[1.9,1.09,.31]]){
  const x=Math.cos(theta),z=Math.sin(theta);
  add('leaf',[x*.056,y,z*.056],new Vector3(x,.55,z),new Vector3(0,1,0),len,.22,-.64,.84,leaf);
 }
 return {asset:a,materials:additions,paint:rose};
}
