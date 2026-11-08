export const VIEW_WGSL=`
struct View {view:mat4x4f,projection:mat4x4f,inverseProjection:mat4x4f,camera:mat4x4f,eye:vec4f,size:vec4f,sun:vec4f,radiance:vec4f,optics:vec4f,sh:array<vec4f,16>,rocks:array<vec4f,3>};
@group(0) @binding(0) var<uniform> c:View;
@group(0) @binding(1) var skyTexture:texture_2d<f32>;
@group(0) @binding(2) var linearSampler:sampler;
fn sky(ray:vec3f)->vec3f{let d=normalize(ray);let uv=vec2f(atan2(d.x,d.z)/6.2831853+.5,.5-asin(clamp(d.y,-1.,1.))/3.14159265);return textureSampleLevel(skyTexture,linearSampler,uv,0.).rgb;}
fn environment(n:vec3f)->vec3f{let x=n.x;let y=n.y;let z=n.z;let b=array<f32,9>(.28209479,-.48860251*y,.48860251*z,-.48860251*x,1.09254843*x*y,-1.09254843*y*z,.315391565*(2.*z*z-x*x-y*y),-1.09254843*x*z,.546274215*(x*x-y*y));var value=vec3f(0);for(var i=0u;i<9u;i++){value+=c.sh[i].xyz*b[i]*select(select(.25,2./3.,i<4u),1.,i==0u);}return max(vec3f(0),value);}
fn shadow(p:vec3f)->f32{for(var i=0u;i<3u;i++){let q=p-c.rocks[i].xyz;let t=-dot(q,c.sun.xyz);let miss=dot(q,q)-t*t;if(t>0.&&miss<c.rocks[i].w*c.rocks[i].w){return .15;}}return 1.;}
fn lit(p:vec3f,n:vec3f,base:vec3f)->vec3f{return base*(environment(n)+c.radiance.xyz*max(0.,dot(n,c.sun.xyz))*shadow(p+n*.005));}
fn worldAt(pixel:vec2f,depth:f32)->vec3f{let uv=pixel/c.size.xy;let q=c.inverseProjection*vec4f(uv.x*2.-1.,1.-uv.y*2.,1,1);return (c.camera*vec4f(q.xyz*(-depth/q.z),1)).xyz;}
struct Quad {@builtin(position) pos:vec4f,@location(0) uv:vec2f};
@vertex fn quad(@builtin(vertex_index) i:u32)->Quad{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];var out:Quad;out.pos=vec4f(p,0,1);out.uv=vec2f(p.x*.5+.5,.5-p.y*.5);return out;}
`;
export const OPAQUE_WGSL=VIEW_WGSL+`
struct Vertex {@builtin(position) pos:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) color:vec3f,@location(3) depth:f32};
@vertex fn terrain(@location(0) p:vec3f,@location(1) normal:vec3f,@location(2) color:vec3f)->Vertex{var out:Vertex;let v=c.view*vec4f(p,1);out.pos=c.projection*v;out.pos.z=(out.pos.z+out.pos.w)*.5;out.world=p;out.normal=normal;out.color=color;out.depth=-v.z;return out;}
@fragment fn land(v:Vertex)->@location(0) vec4f{let grain=fract(sin(dot(floor(v.world*700.),vec3f(12.91,78.233,31.53)))*43758.5453);let grainFilter=1./(1.+pow(700.*length(v.world-c.eye.xyz)/c.size.y,2.));return vec4f(lit(v.world,normalize(v.normal),v.color*(1.+(grain-.5)*.08*grainFilter)),v.depth);}
@fragment fn background(q:Quad)->@location(0) vec4f{let ray=normalize(worldAt(q.pos.xy,1.)-c.eye.xyz);return vec4f(sky(ray),1000.);}
`;
export const SPLAT_WGSL=VIEW_WGSL+`
struct State {p:vec4f,v:vec4f,chem:vec4f,metric:vec4f,extra:vec4f};
@group(1) @binding(0) var<storage,read> particles:array<State>;
@group(1) @binding(1) var opaque:texture_2d<f32>;
struct Splat {@builtin(position) pos:vec4f,@location(0) q:vec2f,@location(1) @interpolate(flat) depth:f32,@location(2) @interpolate(flat) sigma:f32};
@vertex fn splat(@builtin(vertex_index) vi:u32,@builtin(instance_index) id:u32)->Splat{
 let p=particles[id].p.xyz;let v=c.view*vec4f(p,1);let depth=-v.z;let sigma=c.size.z*.52;
 var out:Splat;out.depth=depth;out.sigma=sigma;out.q=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[vi]*2.7;
 // A perspective linearization is unreliable for nearby, far-off-axis
 // centers. Reject the whole bounded Gaussian against the view planes before
 // projecting covariance, so these cannot expand across the entire screen.
 let radius=sigma*2.7;let tx=1./c.projection[0][0];let ty=1./c.projection[1][1];
 if(depth<.04||abs(v.x)>depth*tx+radius*sqrt(1.+tx*tx)||abs(v.y)>depth*ty+radius*sqrt(1.+ty*ty)){out.pos=vec4f(2,2,2,1);return out;}
 // J Sigma J^T: true perspective-projected 3D Gaussian covariance. This
 // includes the off-axis cross term; no screen-sized camera-facing disks.
 let jx=vec3f(c.projection[0][0]/depth,0,c.projection[0][0]*v.x/(depth*depth))*c.size.x*.5;
 let jy=vec3f(0,c.projection[1][1]/depth,c.projection[1][1]*v.y/(depth*depth))*c.size.y*.5;
 let xx=dot(jx,jx)*sigma*sigma+.25;let xy=dot(jx,jy)*sigma*sigma;let yy=dot(jy,jy)*sigma*sigma+.25;
 let delta=sqrt((xx-yy)*(xx-yy)*.25+xy*xy);let l1=max(1e-8,(xx+yy)*.5+delta);let l2=max(1e-8,(xx+yy)*.5-delta);
 var axis=vec2f(1,0);if(abs(xy)>1e-8){axis=normalize(vec2f(l1-yy,xy));}else if(yy>xx){axis=vec2f(0,1);}
 var clip=c.projection*v;clip.x+=2.*(axis.x*sqrt(l1)*out.q.x-axis.y*sqrt(l2)*out.q.y)/c.size.x*clip.w;clip.y+=2.*(axis.y*sqrt(l1)*out.q.x+axis.x*sqrt(l2)*out.q.y)/c.size.y*clip.w;clip.z=(clip.z+clip.w)*.5;out.pos=clip;return out;
}
struct DepthResult {@location(0) value:vec4f,@builtin(frag_depth) depth:f32};
@fragment fn surface(v:Splat)->DepthResult{
 let r2=dot(v.q,v.q);if(r2>4.){discard;}let depth=v.depth-v.sigma*sqrt(max(0.,4.-r2));let land=textureLoad(opaque,vec2i(v.pos.xy),0).a;if(depth>land||depth<.025){discard;}
 let clip=c.projection*vec4f(0,0,-depth,1);var out:DepthResult;out.value=vec4f(depth,0,0,1);out.depth=(clip.z/clip.w+1.)*.5;return out;
}
@fragment fn thickness(v:Splat)->@location(0) vec4f{let r2=dot(v.q,v.q);if(r2>7.29||v.depth-v.sigma*2.>textureLoad(opaque,vec2i(v.pos.xy),0).a){discard;}return vec4f(exp(-.5*r2)*v.sigma*2.506628,0,0,1);}
`;
export const FILTER_WGSL=VIEW_WGSL+`
@group(1) @binding(0) var source:texture_2d<f32>;
@group(1) @binding(1) var<uniform> axis:vec4i;
@fragment fn depthSmooth(q:Quad)->@location(0) vec4f{let pixel=vec2i(q.pos.xy);let center=textureLoad(source,pixel,0).r;if(center==0.){return vec4f(0);}
 let radius=clamp(i32(c.size.z*c.projection[1][1]*c.size.y*.5/center),3,12);var sum=0.;var weight=0.;
 for(var i=-12;i<=12;i++){if(abs(i)>radius){continue;}let at=clamp(pixel+axis.xy*i,vec2i(0),vec2i(c.size.xy)-vec2i(1));let d=textureLoad(source,at,0).r;if(d==0.){continue;}let dz=(d-center)/(c.size.z*2.);let w=exp(-.5*f32(i*i)/f32(radius*radius)*4.-dz*dz);sum+=d*w;weight+=w;}
 return vec4f(sum/max(1e-8,weight),0,0,1);
}
`;
export const COMPOSITE_WGSL=VIEW_WGSL+`
@group(1) @binding(0) var opaque:texture_2d<f32>;
@group(1) @binding(1) var water:texture_2d<f32>;
@group(1) @binding(2) var thickness:texture_2d<f32>;
fn depthAt(p:vec2i)->f32{return textureLoad(water,clamp(p,vec2i(0),vec2i(c.size.xy)-vec2i(1)),0).r;}
fn reflection(p:vec3f,d:vec3f)->vec3f{
 var t=1000.;var color=sky(d);for(var i=0u;i<3u;i++){let q=p-c.rocks[i].xyz;let b=dot(q,d);let disc=b*b-dot(q,q)+c.rocks[i].w*c.rocks[i].w;if(disc>0.){let s=-b-sqrt(disc);if(s>.01&&s<t){t=s;let hit=p+d*s;let n=normalize(hit-c.rocks[i].xyz);color=lit(hit,n,vec3f(.34,.32,.29));}}}
 return color;
}
@fragment fn composite(q:Quad)->@location(0) vec4f{
 let pixel=vec2i(q.pos.xy);let background=textureLoad(opaque,pixel,0);let depth=depthAt(pixel);var color=background.rgb;var debugNormal=vec3f(0);
 if(depth>0.&&depth<background.a){
 let p=worldAt(q.pos.xy,depth);let left=depthAt(pixel-vec2i(1,0));let right=depthAt(pixel+vec2i(1,0));let up=depthAt(pixel-vec2i(0,1));let down=depthAt(pixel+vec2i(0,1));
 let useRight=right>0.&&(left==0.||abs(right-depth)<abs(left-depth));let useDown=down>0.&&(up==0.||abs(down-depth)<abs(up-depth));
 let dx=select(p-worldAt(q.pos.xy-vec2f(1,0),select(depth,left,left>0.)),worldAt(q.pos.xy+vec2f(1,0),right)-p,useRight);
 let dy=select(p-worldAt(q.pos.xy-vec2f(0,1),select(depth,up,up>0.)),worldAt(q.pos.xy+vec2f(0,1),down)-p,useDown);
 var n=normalize(cross(dx,dy));let v=normalize(c.eye.xyz-p);if(dot(n,v)<0.){n=-n;}debugNormal=n*.5+vec3f(.5);
 let fresnel=.02037+.97963*pow(1.-max(0.,dot(n,v)),5.);let organic=c.optics.x;let scatter=vec3f(.012,.026,.035)+sqrt(organic)*vec3f(.085,.072,.05);let ext=scatter+vec3f(.28,.065,.035)+organic*(1.+.35*organic)*vec3f(.12,.5,1.3);
 let path=min(30.,min(max(0.,background.a-depth),textureLoad(thickness,pixel,0).r))*c.optics.y;let trans=exp(-ext*path);
 let ray=normalize(p-c.eye.xyz);let cosine=dot(ray,c.sun.xyz);let phaseLight=(1.-.55*.55)/(4.*pow(max(.001,1.+.55*.55-1.1*cosine),1.5));
 var volume=background.rgb*trans;let stepLength=min(path,8./min(ext.x,min(ext.y,ext.z)))/5.;
 for(var k=0;k<5;k++){let dist=(f32(k)+.5)*stepLength;let vertical=max(0.,-ray.y*dist);let incident=environment(vec3f(0,1,0))*exp(-ext*vertical/.6)+c.radiance.xyz*phaseLight*exp(-ext*vertical/max(.1,c.sun.y));volume+=exp(-ext*f32(k)*stepLength)*(1.-exp(-ext*stepLength))*scatter/ext*incident;}
 let rd=reflect(-v,n);color=mix(volume,reflection(p+n*.005,rd),fresnel);
 let halfVector=normalize(v+c.sun.xyz);let rough=.14;let a=max(.045,rough*rough);let aa=a*a;let nh=max(0.,dot(n,halfVector));let denom=nh*nh*(aa-1.)+1.;let spec=aa/(3.14159265*denom*denom)*.02037*max(0.,dot(n,c.sun.xyz));color+=c.radiance.xyz*spec*.6;
 }
 if(c.optics.w==1.){return vec4f(background.rgb/(vec3f(1)+background.rgb),1);}
 if(c.optics.w==2.){return vec4f(vec3f(depth/15.),1);}
 if(c.optics.w==3.){return vec4f(vec3f(textureLoad(thickness,pixel,0).r/10.),1);}
 if(c.optics.w==4.){return vec4f(debugNormal,1);}
 // Fixed exposure for matched daytime comparisons; no camera-driven physics.
 color*=c.optics.z;color=pow(max(vec3f(0),color)/(vec3f(1)+max(vec3f(0),color)),vec3f(1./2.2));return vec4f(color,1);
}
`;
