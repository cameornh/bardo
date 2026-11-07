// Materials share the scene's uniform objects, but only declarations in their
// own GLSL can change their program. In particular, starting simulation fills
// previously null textures that most display passes never sample.
const declarations=new WeakMap();
export function shaderUniforms(material){
 const vertex=material.vertexShader||'',fragment=material.fragmentShader||'';
 let entry=declarations.get(material);
 if(entry?.vertex===vertex&&entry?.fragment===fragment)return entry.names;
 const source=(vertex+'\n'+fragment).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,''),names=new Set();
 for(const match of source.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+([^;{}]+);/g)){
  for(const declaration of match[1].split(',')){
   const name=declaration.trim().match(/^[A-Za-z_]\w*/)?.[0];if(name)names.add(name);
  }
 }
 declarations.set(material,{vertex,fragment,names});return names;
}
export function liveProgramConstants(material,constants){
 const names=shaderUniforms(material);
 // Particle/body counts change during ordinary play.
 // Specializing them makes the first eroded sand parcel compile an entirely
 // new scene program, synchronously in render(). Keep them as uniforms from
 // the first prepared frame. Retain specialization of execution settings:
 // compiling both interpolation / lighting algorithms into a single shader
 // increases driver complexity substantially. Startup prepares those settings.
 return Object.fromEntries(Object.entries(constants).filter(([name])=>
  name!=='uSandCount'&&name!=='uBodyCount'&&names.has(name)));
}
