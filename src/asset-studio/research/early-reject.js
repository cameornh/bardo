// Isolated rendering trial: no reliable full-scene gain on the tested Mac.
export function installEarlyReject(view){
 view.uniforms.earlyReject={value:false};
 for(const material of [view.material,view.depthMaterial]){material.vertexShader=material.vertexShader.replace('uniform mat4 cameraWorld;','uniform mat4 cameraWorld;uniform bool earlyReject;').replace('\n mat3 covariance',' // The fragment shader already rejects these centers. Conservative margins\n // leave grazing samples to that exact reference, before covariance projection.\n vNormal=normalize(mat3(cameraWorld)*normalMatrix*n);vWorld=(modelMatrix*vec4(center,1.)).xyz;\n if(earlyReject&&(c.z>-.03||vWorld.y<-.00001||dot(vNormal,normalize(cameraPosition-vWorld))<.01)){gl_Position=vec4(2.,2.,2.,1.);return;}\n mat3 covariance');material.needsUpdate=true;}
}
