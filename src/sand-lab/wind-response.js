import {windPressure} from '../beach-wind.js';
// Beach water responds sooner to wind stress. Sand and saved tests keep their forces.
export const WATER_WIND_DRAG=.0011;
export const WATER_WIND_PRESSURE_GAIN=2.6;

// Opt in on the current beach. Preserve the stored laboratory snapshots and
// the common air field used by sand, rigid bodies and the player.
export function waterWindDrag(speed,reactive=false){return WATER_WIND_DRAG*(reactive?1.2+.4/(1+(speed/18)**2):1);}
export function waterWindPressure(x,z,time,speed,turbulence,reactive=false){
 const original=windPressure(x,z,time,speed,0,turbulence);
 if(!reactive)return WATER_WIND_PRESSURE_GAIN*original;
 // Broader, advected pressure gusts put energy into longer waves. Taper the
 // extra sensitivity at storm speeds; the solver still limits step travel.
 const gain=1.6+2.2/(1+(speed/18)**2),broad=windPressure(x*.38,z*.38,time*.38,speed,0,turbulence);
 return WATER_WIND_PRESSURE_GAIN*gain*(original*.45+broad*.85);
}
