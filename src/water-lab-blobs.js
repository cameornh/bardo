import {hash} from './water-lab-model.js';

// A fixed number of detached parcels can have sub-grid reconstruction detail.
// These lobes share their parent's motion; they do not refine the fluid solver.
export const BLOB_FAMILIES = 384;
export const BLOB_KERNELS = 5;
const gaussianVolume = (2 * Math.PI) ** 1.5;
const clamp = x => Math.max(0, Math.min(1, x));

export function blobFamily(id, position, spacing, blend, neighbors = 0) {
  blend = clamp(blend);
  const major = .42 + .12 * hash(id * 19 + 1), tiny = .004 + .05 * hash(id * 19 + 2) ** 3;
  const middle = .12 + .15 * hash(id * 19 + 3);
  const weights = [major, tiny, middle, 1 - major - tiny - middle];
  const offsets = weights.map((_, j) => {
    const angle = hash(id * 47 + j * 7) * Math.PI * 2, y = hash(id * 53 + j * 11) * 2 - 1;
    const r = spacing * (1.05 + .3 * hash(id * 59 + j * 13));
    return [Math.cos(angle) * Math.sqrt(1 - y * y) * r, y * r, Math.sin(angle) * Math.sqrt(1 - y * y) * r];
  });
  const center = [0, 1, 2].map(k => offsets.reduce((s, p, j) => s + p[k] * weights[j], 0));
  const volume = spacing ** 3;
  const kernel = (p, radius, v, filtered = false) => {
    // Match the bulk atlas's tent-filter variance as the original kernel fades
    // out. Small daughter kernels bypass that filter instead of disappearing.
    const sigma = Math.sqrt(Math.max(spacing * .001, radius * .95) ** 2 + (filtered ? (spacing / 2) ** 2 / 6 : 0));
    return {position: p, radius, volume: v, sigma, amplitude: v / (gaussianVolume * sigma ** 3)};
  };
  const parentRadius = spacing * (.65 + .2 * clamp((neighbors - 5) / 20));
  const kernels = [kernel(position.slice(), parentRadius, volume * (1 - blend), true)];
  weights.forEach((weight, j) => {
    // Radius and volume shrink together: narrowing an equal-volume Gaussian
    // alone would raise its peak and can actually enlarge its visible boundary.
    const fraction = weight * blend;
    kernels.push(kernel(position.map((v, k) => v + (offsets[j][k] - center[k]) * blend),
      spacing * .65 * Math.cbrt(fraction), volume * fraction));
  });
  // Outside every support, the sum of all five kernels is below the isovalue.
  const radius = Math.max(...kernels.map(k => Math.hypot(...k.position.map((v, j) => v - position[j])) +
    k.sigma * Math.sqrt(2 * Math.max(0, Math.log(k.amplitude / (.18 / BLOB_KERNELS))))));
  return {id, position: position.slice(), radius, kernels, blend};
}

export function sampleBlob(family, p) {
  let density = 0;
  const gradient = [0, 0, 0];
  for (const k of family.kernels) {
    const q = p.map((v, j) => v - k.position[j]), variance = k.sigma ** 2;
    const d = k.amplitude * Math.exp(-.5 * q.reduce((a, v) => a + v * v, 0) / variance);
    density += d;
    q.forEach((v, j) => { gradient[j] -= d * v / variance; });
  }
  return {density, gradient};
}

export class LabBlobFamilies {
  constructor(limit = BLOB_FAMILIES) { this.limit = Math.min(BLOB_FAMILIES, Math.max(0, limit)); this.active = new Map(); }
  update(lab) {
    if (lab.kind !== this.kind || lab.spacing !== this.spacing || lab.time < this.time || lab.positions.length < this.length) this.active.clear();
    const dt = Math.min(.05, Math.max(0, lab.time - (this.time ?? lab.time)));
    this.kind = lab.kind; this.spacing = lab.spacing; this.time = lab.time; this.length = lab.positions.length;
    const target = i => lab.positions[i * 4 + 3] > .5 ? 0 : clamp((7 - (lab.neighborCounts?.[i] ?? 25)) / 4);
    for (const [id, blend] of this.active) {
      const next = blend + (target(id) - blend) * (1 - Math.exp(-dt / .16));
      if (next < .002 && target(id) === 0) this.active.delete(id); else this.active.set(id, next);
    }
    if (lab.time > 0 && this.active.size < this.limit) {
      const candidates = [];
      for (let i = 0; i < lab.count; i++) if (!this.active.has(i) && target(i) >= .75) candidates.push(i);
      // Stable priority independent of the camera and render frame rate.
      candidates.sort((a, b) => hash(a * 31) - hash(b * 31));
      for (const id of candidates.slice(0, this.limit - this.active.size)) this.active.set(id, 0);
    }
    this.families = Array.from(this.active, ([id, blend]) => blobFamily(id,
      Array.from(lab.positions.subarray(id * 4, id * 4 + 3)), lab.spacing, blend, lab.neighborCounts?.[id] ?? 0));
    return this.families;
  }
}
