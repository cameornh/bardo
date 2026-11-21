import {uid,LIMITS} from './model.js';
import {exportFamily} from './asset-package.js';

export const familyControls=`<details id="studio-families"><summary>Asset families</summary>
<label>Family<select id="studio-family"></select></label>
<div class="studio-row"><button id="studio-new-family">New family</button><button id="studio-export-family">Export family</button><button id="studio-remove-family">Remove family</button></div>
<div id="studio-family-edit" hidden>
<label>Family name<input id="studio-family-name" maxlength="100"></label>
<label>Member asset<select id="studio-member"></select></label>
<label>Selection weight<input id="studio-weight" type="number" min="0" max="100" step="1"></label>
<small id="studio-members"></small><small>Zero excludes the asset. A weight of two makes it twice as likely as a weight of one.</small>
</div></details>`;

export function bindFamilyControls($,{library,asset,options,begin,changed,download,notice}){
  let selected;
  const current=()=>library().families?.find(f=>f.id===selected);
  function showWeight(){
    const member=current()?.members.find(m=>m.assetId===$('member').value);
    $('weight').value=member?.weight||0;
  }
  function sync(){
    const all=library().families||[];
    if(!current())selected=all[0]?.id;
    const f=current();
    options('family',all,selected);
    $('family').disabled=$('remove-family').disabled=$('export-family').disabled=$('family-edit').hidden=!f;
    if(!f)return;
    $('family-name').value=f.name;
    const member=$('member').value;
    options('member',library().assets,library().assets.some(a=>a.id===member)?member:asset().id);
    $('members').textContent=f.members.map(m=>library().assets.find(a=>a.id===m.assetId).name+' × '+m.weight).join(' · ');
    showWeight();
  }
  $('family').onchange=()=>{selected=$('family').value;sync();};
  $('member').onchange=showWeight;
  $('new-family').onclick=()=>{
    if((library().families?.length||0)>=LIMITS.assets)return notice('Family limit reached.');
    begin();
    const f={id:uid(),name:'Family '+((library().families?.length||0)+1),members:[{assetId:asset().id,weight:1}]};
    (library().families??=[]).push(f);selected=f.id;
    changed(false);$('family-name').focus();$('family-name').select();
  };
  $('remove-family').onclick=()=>{begin();library().families=library().families.filter(f=>f.id!==selected);changed(false);};
  $('export-family').onclick=()=>download(exportFamily(library(),selected),'bardo-'+selected+'.family.json');
  $('family-name').onchange=()=>{
    const name=$('family-name').value.trim();
    if(!name)return sync();
    begin();current().name=name;changed(false);
  };
  $('weight').onchange=()=>{
    const input=$('weight'),id=$('member').value,weight=Number(input.value),f=current();
    if(!input.value||!input.reportValidity())return showWeight();
    const next=f.members.filter(m=>m.assetId!==id);
    if(!weight&&!next.length){showWeight();return notice('Keep one member, or remove the family.');}
    const old=f.members.find(m=>m.assetId===id);
    if((old?.weight||0)===weight)return;
    begin();
    if(old&&weight)old.weight=weight;
    else f.members=weight?[...next,{assetId:id,weight}]:next;
    changed(false);
  };
  return {sync,select:id=>{selected=id;sync();}};
}
