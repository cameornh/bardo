// The snapshot renderer concatenates the entire scene library into each
// fragment shader. Remove unreachable function definitions before handing a
// live shader to the driver. Kept function bodies are byte-for-byte unchanged:
// no ray budgets, lighting approximations, or floating point rewrites.
// Overloads are retained as a group. Global initializers / preprocessor macros
// are roots too, so helpers referenced outside a function remain available.
export function reachableShader(source,roots=[]){
 const masked=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,s=>s.replace(/[^\n]/g,' '));
 const definitions=[],byName=new Map();
 const signature=/\b(?:(?:highp|mediump|lowp)\s+)?(?:void|bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?)\s+(\w+)\s*\([^;{}]*\)\s*\{/g;
 let match;
 while((match=signature.exec(masked))){
  let end=signature.lastIndex,depth=1;
  for(;depth&&end<masked.length;end++){if(masked[end]==='{')depth++;else if(masked[end]==='}')depth--;}
  if(depth)throw Error('Unbalanced GLSL function: '+match[1]);
  const entry={name:match[1],start:match.index,end,text:masked.slice(signature.lastIndex,end-1)};
  definitions.push(entry);if(!byName.has(entry.name))byName.set(entry.name,[]);byName.get(entry.name).push(entry);
  signature.lastIndex=end;
 }
 if(!byName.has('main'))throw Error('Shader has no main function');
 let globals='',cursor=0;
 for(const entry of definitions){globals+=masked.slice(cursor,entry.start);cursor=entry.end;}
 globals+=masked.slice(cursor);
 const keep=new Set(),pending=['main',...roots.filter(name=>byName.has(name))];
 const calls=text=>{for(const call of text.matchAll(/\b(\w+)\s*\(/g))if(byName.has(call[1])&&!keep.has(call[1]))pending.push(call[1]);};
 calls(globals);
 while(pending.length){const name=pending.pop();if(keep.has(name))continue;keep.add(name);for(const entry of byName.get(name))calls(entry.text);}
 let result='';cursor=0;
 for(const entry of definitions){result+=source.slice(cursor,entry.start);if(keep.has(entry.name))result+=source.slice(entry.start,entry.end);cursor=entry.end;}
 return result+source.slice(cursor);
}

export function installShaderReachability(material){
 if(!material?.isShaderMaterial||material.userData.liveReachability)return;
 material.userData.liveReachability=true;
 const original=material.onBeforeCompile,cache=material.customProgramCacheKey;
 material.onBeforeCompile=function(shader,renderer){
  original.call(this,shader,renderer);
  for(const stage of ['vertexShader','fragmentShader']){
   // THREE expands includes later. An unseen chunk could call a helper, so
   // leave those shaders alone rather than guessing their dependency graph.
   if(!shader[stage].includes('#include'))shader[stage]=reachableShader(shader[stage]);
  }
 };
 material.customProgramCacheKey=function(){return cache.call(this)+'|live-reachable-v1';};
 material.needsUpdate=true;
}
