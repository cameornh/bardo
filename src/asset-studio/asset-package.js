import {clone, LIMITS, MAX_LIBRARY_BYTES, uid, validateLibrary, VERSION} from './model.js';

const kind = 'bardo-studio-asset';
const withSuffix = (text, suffix) => text.slice(0, 100 - suffix.length) + suffix;

function usedMaterials(asset) {
  return new Set(asset.parts.flatMap(part => [...part.stamps, ...(part.marks || [])].map(item => item.materialId)));
}

export function exportAsset(library, assetId) {
  const asset = library.assets.find(item => item.id === assetId);
  if (!asset) throw Error('Select an asset to export.');
  const used = usedMaterials(asset);
  return clone({kind, version: VERSION, asset, materials: library.materials.filter(m => used.has(m.id))});
}

// A material file may have been reserialized with different property order.
function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}

function resolveMaterial(source, materials, reserved) {
  for (let variant = 1; ; variant++) {
    const id = variant === 1 ? source.id : withSuffix(source.id, '-import-' + variant);
    if (variant > 1 && reserved.has(id)) continue;
    const name = variant === 1 ? source.name : withSuffix(source.name, ' (import ' + variant + ')');
    const candidate = {...source, id, name};
    const existing = materials.find(m => m.id === id);
    if (existing) {
      if (sameValue({surfaceMode:'auto', ...existing}, {surfaceMode:'auto', ...candidate})) return id;
      continue;
    }
    if (variant > 1 && materials.some(m => m.name === name)) continue;
    if (materials.length >= LIMITS.materials) throw Error('Import would exceed the material limit.');
    materials.push(candidate);
    return id;
  }
}

export function importAsset(library, file) {
  if (file?.kind !== kind) throw Error('Choose a single asset exported with Export asset. Use Import library for a complete library.');
  if (file.version !== VERSION) throw Error('Unsupported asset file version.');
  if (library.assets.length >= LIMITS.assets) throw Error('Asset library is full.');
  const {asset, materials} = clone(file);
  if (!asset || !Array.isArray(materials)) throw Error('Missing asset or material definitions.');
  // Reuse the library validator and its migrations. An empty sculpt needs no
  // materials of its own; the validation-only ground must never bind a stamp.
  const validationMaterials = materials.length ? materials : [clone(library.materials[0])];
  validateLibrary({version: VERSION, assets:[asset], materials:validationMaterials,
    world:{instances:[], groundMaterialId:validationMaterials[0]?.id}});
  const used = usedMaterials(asset);
  const reserved = new Set(materials.map(m => m.id));
  for (const id of used) if (!reserved.has(id)) throw Error('Missing material for the imported sculpt.');

  const merged = [...library.materials], remap = new Map();
  for (const m of materials) if (used.has(m.id)) remap.set(m.id, resolveMaterial(m, merged, reserved));
  for (const part of asset.parts) for (const item of [...part.stamps, ...(part.marks || [])]) item.materialId = remap.get(item.materialId);

  // Part IDs and joint parent IDs are local to an asset. Keep their links
  // intact, giving each import its own independently editable asset.
  while (library.assets.some(a => a.id === asset.id)) asset.id = uid();
  const original = asset.name;
  for (let n = 2; library.assets.some(a => a.name === asset.name); n++) asset.name = withSuffix(original, ' (' + n + ')');
  const result = {...library, assets:[...library.assets, asset], materials:merged};
  if (new Blob([JSON.stringify(result)]).size > MAX_LIBRARY_BYTES) throw Error('Import would exceed the 8 MiB library save limit.');
  return {asset, library:result};
}

export const familyKind='bardo-studio-family';
export function exportFamily(library,familyId){
  const family=library.families?.find(f=>f.id===familyId);
  if(!family)throw Error('Choose a family to export.');
  const assets=family.members.map(m=>library.assets.find(a=>a.id===m.assetId));
  const used=new Set(assets.flatMap(a=>[...usedMaterials(a)]));
  return clone({version:VERSION,kind:familyKind,family,assets,materials:library.materials.filter(m=>used.has(m.id))});
}

export function importFamily(library,file){
  if(file?.kind!==familyKind||file.version!==VERSION||!Array.isArray(file.materials)||!file.family)throw Error('Invalid asset family file.');
  const {family,assets,materials}=clone(file);
  const checks=materials.length?materials:[clone(library.materials[0])];
  validateLibrary({version:VERSION,assets,materials:checks,families:[family],world:{groundMaterialId:checks[0].id,instances:[]}});
  if(assets.length!==family.members.length)throw Error('The family file contains extra assets.');
  const remap=new Map();
  let next=library;
  for(const asset of assets){
    const ids=usedMaterials(asset);
    const result=importAsset(next,{version:VERSION,kind,asset,materials:materials.filter(m=>ids.has(m.id))});
    next=result.library;
    remap.set(asset.id,result.asset.id);
  }
  const existing=next.families||[],original=family.name;
  if(existing.some(f=>f.id===family.id))family.id=uid();
  for(let i=2;existing.some(f=>f.name===family.name);i++)family.name=withSuffix(original,' ('+i+')');
  for(const member of family.members)member.assetId=remap.get(member.assetId);
  next={...next,families:[...existing,family]};
  validateLibrary(next);
  if(new Blob([JSON.stringify(next)]).size>MAX_LIBRARY_BYTES)throw Error('The family would exceed the library save limit.');
  return {family,library:next};
}
