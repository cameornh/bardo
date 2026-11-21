// A coherent gust crosses the work area over seconds. The authored speed and
// heading remain the mean wind, including when the simulation clock is paused.
export function windAt(settings,time,x=0,z=0,out={}){
 const amount=settings.turbulence??0;
 if(!amount||!settings.speed)return settings;
 const along=.63*Math.sin(time*1.31-.09*x+.06*z)+.37*Math.sin(time*2.47+.05*x+.13*z);
 const across=.72*Math.sin(time*.89+.12*z-.07*x)+.28*Math.sin(time*2.17-.08*z);
 out.speed=settings.speed*(1+.46*amount*along);
 out.heading=settings.heading+32*amount*across;
 return out;
}
