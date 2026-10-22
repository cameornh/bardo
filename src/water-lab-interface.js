// Water -> air interface, including Snell's window and total internal reflection.
export function waterExit(incident,normal,ior=1.333){
 let cosine=incident.reduce((s,v,k)=>s+v*normal[k],0);const n=normal.map(v=>v*(cosine<0?-1:1));cosine=Math.abs(cosine);
 const k=1-ior*ior*(1-cosine*cosine),reflected=incident.map((v,i)=>v-2*cosine*n[i]);
 if(k<=0)return {transmitted:null,reflected,fresnel:1};
 const ct=Math.sqrt(k),rs=(ior*cosine-ct)/(ior*cosine+ct),rp=(cosine-ior*ct)/(cosine+ior*ct);
 return {transmitted:incident.map((v,i)=>ior*v+(ct-ior*cosine)*n[i]),reflected,fresnel:(rs*rs+rp*rp)/2};
}
export const WATER_EXIT_GLSL=`
float waterExitFresnel(vec3 incident,vec3 normal,out vec3 transmitted){
 float cosine=abs(dot(incident,normal)),k=1.-WATER_IOR*WATER_IOR*(1.-cosine*cosine);
 if(k<=0.){transmitted=vec3(0);return 1.;}
 float ct=sqrt(k),rs=(WATER_IOR*cosine-ct)/(WATER_IOR*cosine+ct),rp=(cosine-WATER_IOR*ct)/(cosine+WATER_IOR*ct);
 transmitted=refract(incident,dot(incident,normal)>0.?-normal:normal,WATER_IOR);
 return .5*(rs*rs+rp*rp);
}
`;
