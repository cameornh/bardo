import {Matrix4,Plane,Vector3} from 'three';
import {brushCopies,brushFrame,MAX_MARKS,markProfile,projectMount} from './gaussian-marks.js';
import {retention} from './physics-data.js';
import {uid} from './model.js';

const tools=[['add','Add'],['subtract','Carve'],['paint','Paint'],['gaussian','Gaussian'],['detail','Edit detail'],['sample','Eyedropper']];
export const sculptToolbar='<div id="studio-brush-bar" role="group" aria-label="Sculpt tools" hidden>'+tools.map(([key,label],i)=>
 '<button type="button" data-brush="'+key+'" title="'+label+' ('+(i+1)+')">'+label+'</button>').join('')+'</div>';
export const toolOptions='<option value="gaussian">Paint Gaussian detail</option><option value="detail">Edit Gaussian detail</option><option value="sample">Sample material</option>';
const range=(id,label,min,max,step,value)=>'<label>'+label+' <output id="studio-'+id+'-value">'+value+'</output><input id="studio-'+id+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'"></label>';
export const brushControls=`
 <label>Brush material<select id="studio-brush-material"></select></label>
 <label id="studio-repeat-row">Stroke symmetry<select id="studio-repeat"><option value="1">Single stroke</option><option value="mirror">Mirror across local X</option><option value="radial">Radial around local Y</option></select></label>
 <label id="studio-repeat-count-row" hidden>Radial copies<input id="studio-repeat-count" type="number" min="2" max="32" step="1" value="6"></label>
 <div id="studio-stamp-settings">${range('stroke-spacing','Stamp spacing (radii)',.15,1,.05,.35)}${range('aspect','Vertical brush scale',.1,2,.05,1)}</div>
 <div id="studio-gaussian-settings" hidden>
  <label>Gaussian brush<select id="studio-mark-kind"><option value="ribbon">Curved ribbon</option><option value="dab">Ellipsoid</option></select></label>
  ${range('mark-length','Length (m)',.035,4,.005,.5)}
  ${range('mark-width','Relative width',.04,.9,.01,.28)}
  <div id="studio-profile">${range('mark-bias','Width curve bias',.25,4,.05,1)}${range('mark-taper','Linear taper',0,1,.01,0)}</div>
  ${range('mark-curl','Curl',-1,1,.02,.3)}
  ${range('mark-roll','Twist (°)',-180,180,1,0)}
  ${range('mark-flex','Joint flexibility',0,1,.02,.6)}
  <div id="studio-detail-edit" hidden><label>Attached detail<select id="studio-mark-list"></select></label>
  <div class="studio-row"><button id="studio-apply-mark">Apply to detail</button><button id="studio-erase-mark">Remove detail</button></div></div>
  <small id="studio-mark-count"></small>
 </div>`;
const value=(el)=>Number(el.value);
export function bindBrushControls($){
 $('mark-kind').onchange=()=>$('profile').hidden=$('mark-kind').value==='dab';
 $('repeat').onchange=()=>$('repeat-count-row').hidden=$('repeat-row').hidden||$('repeat').value!=='radial';
 for(const id of ['stroke-spacing','aspect','mark-bias','mark-taper','mark-length','mark-width','mark-curl','mark-roll','mark-flex'])
  $(id).oninput=()=>$(id+'-value').value=$(id).value;
}
export function showBrushControls($,active,tool){
 const marking=tool==='gaussian'||tool==='detail',stamping=['add','subtract','paint'].includes(tool);
 $('brush-bar').hidden=!active;
 for(const b of $('brush-bar').children)b.setAttribute('aria-pressed',String(b.dataset.brush===tool));
 $('gaussian-settings').hidden=!marking;$('detail-edit').hidden=tool!=='detail';
 $('stamp-settings').hidden=!stamping;$('repeat-row').hidden=!stamping&&tool!=='gaussian';
 $('repeat').onchange();
 for(const id of ['shape','radius','blend'])$(id).closest('label').hidden=!stamping;
}
export const strokePattern=$=>$('repeat').value==='radial'?Math.max(2,Math.min(32,Math.round(Number($('repeat-count').value)||2))):$('repeat').value;
function readSettings($){
 return {kind:$('mark-kind').value.toLowerCase(),length:value($('mark-length')),width:value($('mark-width')),
  bias:value($('mark-bias')),taper:value($('mark-taper')),curl:value($('mark-curl')),flex:value($('mark-flex'))};
}
export class MarkBrush{
 constructor($,view,notice){this.$=$;this.view=view;this.notice=notice;this.selected=null;}
 sync(part){
  const marks=part.marks||[],list=this.$('mark-list');
  if(!marks.some(m=>m.id===this.selected))this.selected=null;
  list.replaceChildren(new Option('Pick a detail…',''),...marks.map((m,i)=>new Option((i+1)+' · '+m.kind,m.id)));
  list.value=this.selected||'';
  this.$('mark-count').textContent=marks.length+' / '+MAX_MARKS+' details on '+part.name;
  this.$('apply-mark').disabled=this.$('erase-mark').disabled=!this.selected;
 }
 choose(part,id){
  const m=part.marks?.find(m=>m.id===id);
  this.selected=m?.id;
  if(m){this.$('mark-kind').value=m.kind==='dab'?'dab':'ribbon';this.$('mark-kind').onchange();
   const [bias,taper]=markProfile(m);
   for(const [key,num] of Object.entries({bias,taper,length:m.length,width:m.width,curl:m.curl,flex:m.flex,roll:0})){
    const input=this.$('mark-'+key);input.value=num;input.oninput();
   }
  }
  this.sync(part);return m;
 }
 modify(part,material,remove,before){
  const i=part.marks?.findIndex(m=>m.id===this.selected)??-1;if(i<0)return false;
  if(!remove&&retention(material)<=1e-4){this.notice('Choose a material that can hold a joint.');return false;}
  before();
  if(remove){part.marks.splice(i,1);this.selected=null;}
  else{
   const m=part.marks[i];
   Object.assign(m,readSettings(this.$),brushFrame(new Vector3(...m.axis),new Vector3(...m.up),value(this.$('mark-roll'))*Math.PI/180),{materialId:material.id});
   this.choose(part,m.id);
  }
  return true;
 }
 start(event,hit,part,materials,material,spacing){
  if(!hit||hit.ground||hit.partId!==part.id){this.notice('Start the Gaussian brush on the selected sculpted part.');return;}
  if(retention(material)<=1e-4){this.notice('Choose a brush material that can hold a joint.');return;}
  const obj=this.view.groups.get('editor')?.children.find(o=>o.userData.partId===part.id);
  if(!obj)return;
  obj.updateWorldMatrix(true,false);
  const inv=new Matrix4().copy(obj.matrixWorld).invert(),point=hit.point.clone().applyMatrix4(inv);
  const mount=projectMount(part,point.toArray(),Math.max(.025,spacing*1.5));
  if(!mount){this.notice('Could not find a surface here. Try closer to the sculpt.');return;}
  const palette=new Map(materials.map(m=>[m.id,m]));
  const copies=[];
  for(const c of brushCopies(mount.root,strokePattern(this.$),true)){
   const site=projectMount(part,c.point,Math.max(.015,spacing*.12));
   if(site&&retention(palette.get(site.materialId))>1e-4)copies.push({root:site.root,transform:c.transform,id:uid()});
  }
  if(!copies.length){this.notice('This surface cannot retain a painted joint.');return;}
  if((part.marks?.length||0)>=MAX_MARKS){this.notice('Detail limit reached on this part.');return;}
  this.pending={part,obj,inv,palette,mount,copies,material,settings:readSettings(this.$),startX:event.clientX,startY:event.clientY,
   plane:new Plane().setFromNormalAndCoplanarPoint(this.view.camera.getWorldDirection(new Vector3()),hit.point),start:point};
  this.move(event);
 }
 move(event){
  const p=this.pending;if(!p)return;
  const end=this.view.ray(event).intersectPlane(p.plane,new Vector3());
  const delta=end?.applyMatrix4(p.inv).sub(p.start),drag=Math.hypot(event.clientX-p.startX,event.clientY-p.startY)>4;
  const axis=p.mount.normal.clone();let length=p.settings.length;
  if(drag&&delta?.lengthSq()>1e-8){
   length=Math.max(.035,Math.min(4,delta.length()));axis.copy(delta).normalize();
   const inward=axis.dot(p.mount.normal);if(inward<.08)axis.addScaledVector(p.mount.normal,.08-inward).normalize();
  }
  const hint=new Vector3(0,1,0);
  if(Math.abs(hint.dot(axis))>.94)hint.copy(this.view.camera.getWorldDirection(new Vector3()).negate().transformDirection(p.inv));
  const frame=brushFrame(axis,hint,value(this.$('mark-roll'))*Math.PI/180);
  p.marks=p.copies.map(c=>({...p.settings,length,id:c.id,root:c.root,axis:c.transform(frame.axis),up:c.transform(frame.up),materialId:p.material.id}));
  // A radial drag from a single pole can still create a full rosette.
  // Suppress only copies that duplicate both the mount and its orientation.
  const near=(a,b)=>a.every((x,i)=>Math.abs(x-b[i])<.0005);
  p.marks=p.marks.filter((m,i,all)=>!all.slice(0,i).some(o=>near(o.root,m.root)&&near(o.axis,m.axis)&&near(o.up,m.up)));
  if((p.part.marks?.length||0)+p.marks.length>MAX_MARKS){
   p.marks=[];this.notice('The symmetry stroke exceeds the remaining detail slots.');
  }
  this.view.paintView.preview(p.marks,p.obj,p.palette);
 }
 finish(commit,before){
  const p=this.pending;this.pending=null;this.view.paintView.clearPreview();
  if(!p?.marks.length||!commit)return false;
  before();(p.part.marks??=[]).push(...p.marks);this.selected=p.marks[0].id;return true;
 }
}
