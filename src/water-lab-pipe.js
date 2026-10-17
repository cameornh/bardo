import {pipeInlet} from './water-lab-inlet.js';

// Emit complete cross-sections on a discharge clock. Serially emitting the
// stencil made each part of the nozzle pulse at a different phase, even at
// zero forcing. Backdate each layer within the step to retain regular spacing.
export function pumpPipe(lab, dt) {
  if (lab.flow <= 0) {lab.pumpBudget = 0; return;}
  const s = lab.spacing, scale = lab.spec.scale;
  const inlet = pipeInlet(s, scale, lab.flow, lab.turbulence, 0, lab.time);
  const sites = inlet.siteCount;
  lab.pumpBudget += dt * inlet.rate;
  while (lab.pumpBudget + 1e-8 >= sites) {
    const age = Math.max(0, (lab.pumpBudget - sites) / inlet.rate);
    const layer = Array.from({length: sites}, (_, j) => {
      const q = pipeInlet(s, scale, lab.flow, lab.turbulence, j, lab.time - age);
      q.point[0] = -3.8 + Math.max(.08, s * .46);
      for (let k = 0; k < 3; k++) q.point[k] += q.velocity[k] * age;
      q.point[1] -= .5 * 9.81 / scale * age * age;
      q.velocity[1] -= 9.81 / scale * age;
      return q;
    });
    // Recycle settled reservoir water, never an in-flight section of the jet.
    const ids = [];
    for (let tries = 0; tries < lab.count && ids.length < sites; tries++) {
      const i = lab.pumpCursor++ % lab.count, o = i * 4;
      if (!lab.positions[o + 3] && lab.positions[o + 1] < .8) ids.push(i);
    }
    const occupied = layer.some(q => {
      for (let i = 0; i < lab.count; i++) {
        const o = i * 4;
        if (Math.hypot(lab.positions[o] - q.point[0], lab.positions[o + 1] - q.point[1], lab.positions[o + 2] - q.point[2]) < s * .72) return true;
      }
      return false;
    });
    if (ids.length < sites || occupied) {lab.pumpBudget = Math.min(lab.pumpBudget, sites); break;}
    lab.pipeLayers ??= new Map();
    const layerId = lab.inletSequence / sites;
    layer.forEach((q, j) => {
      const o = ids[j] * 4;
      lab.positions.set(q.point, o);lab.velocities.set(q.velocity, o);
      // Recirculated dissolved material is retained; old impact aeration is
      // not an inlet disturbance. New aeration still comes from the solver.
      lab.chem[o + 3] = 0;
      lab.pipeLayers.set(ids[j], {lane: j, layer: layerId, period: sites / inlet.rate, launched: lab.time - age});
    });
    lab.inletSequence += sites;
    lab.pumped += sites * s ** 3 * scale ** 3;
    lab.pumpBudget -= sites;
  }
}

export function updatePipeStream(lab) {
  for (const [id, tag] of lab.pipeLayers || []) {
    const o = id * 4, p = Array.from(lab.positions.subarray(o, o + 3));
    const impact = lab.aerationActivity?.[id * 2 + 1] || 0;
    if (lab.positions[o + 3] || lab.time - tag.launched > 8 * Math.sqrt(lab.spec.scale) ||
        (lab.solid(p) < lab.spacing * .52 && impact > .08)) lab.pipeLayers.delete(id);
  }
}

// Reconstruct the finite volume along *connected, moving* inlet samples. This
// quadrature of small normalized Gaussians fills the sampling gap created by
// gravitational stretching without inflating each particle into a round ball.
// Links end at a collision, a missing layer, a sharp turn or a torn gap. No fixed
// curve, attachment force, extra water, or camera-dependent physics is added.
export function pipeStreamKernels(lab) {
  const out = new Map(), tags = lab.pipeLayers;
  const strength = 1 - Math.min(1, Math.max(0, lab.turbulence / .65));
  if (lab.kind !== 'pipe' || !tags?.size || !strength) return out;
  const lanes = new Map(), s = lab.spacing;
  for (const [id, tag] of tags) lanes.set(`${tag.layer}:${tag.lane}`, id);
  for (const [id, tag] of tags) {
    const o = id * 4, p = Array.from(lab.positions.subarray(o, o + 3));
    if (lab.positions[o + 3]) continue;
    const v = Array.from(lab.velocities.subarray(o, o + 3)), speed = Math.hypot(...v);
    const ends = [-1, 1].map(sign => {
      const j = lanes.get(`${tag.layer + sign}:${tag.lane}`);
      if (j === undefined) return null;
      const q = Array.from(lab.positions.subarray(j * 4, j * 4 + 3)), d = q.map((x, k) => x - p[k]), length = Math.hypot(...d);
      const w = Array.from(lab.velocities.subarray(j * 4, j * 4 + 3)), otherSpeed = Math.hypot(...w);
      const aligned = v.reduce((a, x, k) => a + x * w[k], 0) / Math.max(.0001, speed * otherSpeed);
      const expected = Math.max(s * .8, (speed + otherSpeed) * .5 * tag.period);
      if (aligned < .75 || length > expected * 1.65 || length > s * 5 || lab.positions[j * 4 + 3]) return null;
      return d.map(x => x * .5 * strength);
    });
    if (!ends[0] && !ends[1]) continue;
    // A zero endpoint at a genuine free end stops interpolation across a gap.
    const a = ends[0] || [0, 0, 0], b = ends[1] || [0, 0, 0];
    const span = Math.hypot(...b.map((x, k) => x - a[k]));
    const count = Math.max(2, Math.min(12, Math.ceil(span / (s * .3))));
    const kernels = [];
    for (let n = 0; n < count; n++) {
      const t = (n + .5) / count;
      kernels.push({position: p.map((x, k) => x + a[k] * (1 - t) + b[k] * t), radius: s * .65, volume: s ** 3 / count});
    }
    out.set(id, kernels);
  }
  return out;
}

export function pipeTimestep(lab) {
  let speed = 2 * lab.flow / lab.spec.scale;
  for (let o = 0; o < lab.velocities.length; o += 4) {
    if (lab.positions[o + 3]) continue;
    speed = Math.max(speed, Math.hypot(lab.velocities[o], lab.velocities[o + 1], lab.velocities[o + 2]));
  }
  // Use the same displacement bound as prediction, including the next gravity
  // increment. Reduce the step instead of silently slowing fast falling water.
  const g = 9.81 / lab.spec.scale;
  return Math.min(1 / 30, 2 * lab.spacing * .44 / (speed + Math.sqrt(speed * speed + 4 * g * lab.spacing * .44)));
}
