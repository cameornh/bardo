import {clamp} from './material-air.js';

const options=pairs=>pairs.map(([v,name])=>`<option value="${v}">${name}</option>`).join('');
export const fieldControls=`<fieldset><legend>Material interactions</legend>
 <label>Surface action<select id="studio-field-action">${options([['probe','Probe'],['heat','Heat pulse'],['cool','Cold pulse'],['wet','Add water'],['positive','Attach supply'],['return','Attach return'],['unpin','Remove electrode']])}</select></label>
 <label>Intensity <output id="studio-field-amount"></output><input id="studio-field-power" type="range" min=".02" max="3" step=".02" value="1"></label>
 <div class="studio-row"><button id="studio-field-pick">Point at surface</button><button id="studio-field-selected">Apply to selected part</button></div>
 <label>Air temperature (°C)<input id="studio-air-temp" type="number" min="-50" max="150" step="1" value="20"></label>
 <label>Relative humidity (%)<input id="studio-air-rh" type="number" min="0" max="100" step="1" value="45"></label>
 <label>Field display<select id="studio-field-display">${options([['natural','Natural appearance'],['temperature','Temperature · cold to hot'],['moisture','Surface water and air humidity'],['charge','Electric potential · low to high'],['reaction','Burning, smoke and vapour']])}</select></label>
 <small>Click a surface to sample or apply the action. Attach supply and return at different points to drive current. Reset physics clears the experiment.</small>
 <output id="studio-field-readout" class="studio-field-readout">Choose a surface or apply to the selected part.</output></fieldset>`;
export function bindFieldTools($,api){
 const settings=sim=>{
  const temp=Number($('air-temp').value),rh=Number($('air-rh').value);
  if(Number.isFinite(temp))sim.materialWorld.air.temperature=273.15+clamp(temp,-50,150);
  if(Number.isFinite(rh))sim.materialWorld.air.humidity=clamp(rh,0,100)/100;
 };
 const use=async(hit,selected=false)=>{
  const sim=await api.physics();if(!sim)return;
  const world=sim.materialWorld;settings(sim);
  let s;
  if(selected){
   const key=api.selectedKey(),r=sim.bodies.get(key);
   s=r?.field.sites[0];
   if(!s){world.collectLoose(sim);s=[...world.loose.values()].find(s=>s.group.key===key);}
  }else s=world.target(sim,hit);
  if(!world.apply(s,$('field-action').value,Number($('field-power').value)))api.notice('Select a placed part or point at a material surface.');
 };
 function showStrength(){
  const action=$('field-action').value,value=Number($('field-power').value);
  const adjustable=['heat','cool','wet','positive'].includes(action);$('field-power').disabled=!adjustable;
  $('field-amount').textContent=action==='heat'||action==='cool'?(value*600).toFixed(0)+' kJ/m²':action==='wet'?(value*.8).toFixed(2)+' kg/m²':action==='positive'?(value*48).toFixed(1)+' V':action==='return'?'0 V':'';
 }
 $('field-action').onchange=()=>{showStrength();api.choose();};
 $('field-power').oninput=showStrength;showStrength();
 $('field-selected').onclick=()=>use(null,true);
 $('field-pick').onclick=()=>api.choose();
 $('field-display').onchange=()=>api.display($('field-display').value);
 for(const id of ['air-temp','air-rh'])$(id).onchange=()=>{const sim=api.current();if(sim)settings(sim);};
 function read(sim){
  const w=sim?.materialWorld,s=w?.probe;
  if(!s){$('field-readout').textContent='Choose a surface or apply to the selected part.';return;}
  const c=w.air.at(s.position,false),air=w.air.read(c),percent=v=>(v*100).toFixed(1)+'%';
  $('field-readout').textContent=[
   s.material.name+' · '+(s.t-273.15).toFixed(1)+' °C · '+s.volts.toFixed(2)+' V · '+s.watts.toFixed(2)+' W',
   'Surface water '+(1000*s.water/s.area).toFixed(1)+' g/m² · melted '+percent(s.melt)+' · bulk mass transferred '+percent(s.lost),
   'Burn '+(1000*s.burning).toFixed(2)+' g/s'+(s.material.fuelEnergy>0?' · fuel remaining '+percent(s.fuel):'')+(s.electrode!=null?' · electrode '+s.electrode.toFixed(1)+' V':''),
   'Air '+(air.temperature-273.15).toFixed(1)+' °C · RH '+percent(air.humidity)+' · O₂ '+(100*air.oxygen/.275).toFixed(0)+'% of ambient · smoke '+((c?.smoke||0)*1000).toFixed(2)+' g/m³',
   'CPU · '+w.nodes.length+' material samples · '+w.air.cells.size+' air cells'
  ].join('\n');
 }
 return {use,read,settings};
}
