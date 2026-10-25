// Preserve all 9³ samples and their original order. A uniform loop bound keeps
// D3D's compiler from expanding three nested fixed loops into 729 copies.
export const MACRO_REDUCTION_SAMPLES=729;
const header='for(int y=0;y<=8;y++)for(int z=0;z<=8;z++)for(int x=0;x<=8;x++){';
export function compactMacroReduction(source){
 if(!source.includes(header)||!source.includes('uniform int uColumns,uWidth;'))return source;
 return source.replace('uniform int uColumns,uWidth;','uniform int uColumns,uWidth,uReductionSamples;')
  .replace(header,'for(int sampleIndex=0;sampleIndex<uReductionSamples;sampleIndex++){int x=sampleIndex%9,z=(sampleIndex/9)%9,y=sampleIndex/81;');
}
