export const SAND_MATERIAL=Object.freeze({color:Object.freeze([.56,.39,.19]),dryRoughness:.95,wetRoughness:.24,wetDarkening:.38});
export const SAND_MATERIAL_GLSL=`
vec3 sandAlbedo(float saturation){return vec3(.56,.39,.19)*mix(1.,.38,clamp(saturation,0.,1.));}
float sandRoughness(float saturation){return mix(.95,.24,clamp(saturation,0.,1.));}
`;
