// Matrix-free pressure projection on the fixed-phase MAC grid.
export function applyLaplacian(grid, x, out = new Float64Array(grid.count)) {
  for (let i = 0; i < grid.count; i++) {
    let v = grid.degree[i]*x[i];
    for (let k = 0; k < 6; k++) {const j = grid.neighbors[6*i+k]; if (j >= 0) v -= x[j];}
    out[i] = v;
  }
  return out;
}
export function rms(a) {let s=0;for(let i=0;i<a.length;i++)s+=a[i]*a[i];return Math.sqrt(s/a.length);}
export function pressureRHS(grid) {return grid.removeMean(grid.divergence().map(v=>-v*grid.h**2));}
export function residual(grid, x, rhs) {return rms(applyLaplacian(grid,x).map((v,i)=>v-rhs[i]));}
function dot(a,b) {let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum;}
export function solvePressureCPU(grid, rhs, {initial, iterations = 240, tolerance = 1e-8} = {}) {
  const x = initial ? Float64Array.from(initial) : new Float64Array(grid.count), ax = applyLaplacian(grid,x);
  const r = rhs.map((v,i)=>v-ax[i]), z = r.map((v,i)=>v/Math.max(1,grid.degree[i])), d = z.slice();
  let rz = dot(r,z), count = 0; const target = Math.max(1e-12, rms(rhs)*tolerance);
  for (; count < iterations && rms(r)>target; count++) {
    applyLaplacian(grid,d,ax); const denominator = dot(d,ax);
    if (Math.abs(denominator)<1e-30) break;
    const alpha = rz/denominator;
    for (let i = 0; i < grid.count; i++) {x[i]+=alpha*d[i]; r[i]-=alpha*ax[i]; z[i]=r[i]/Math.max(1,grid.degree[i]);}
    const next = dot(r,z), beta = next/rz;
    for (let i = 0; i < grid.count; i++) d[i] = z[i]+beta*d[i];
    rz=next;
  }
  grid.removeMean(x);
  return {potential:x, iterations:count, relativeResidual:residual(grid,x,rhs)/Math.max(1e-12,rms(rhs)), backend:'CPU conjugate gradient'};
}
// Exact algorithmic reference for the GPU's bounded red/black SOR sweeps.
export function solveSORReference(grid, rhs, sweeps = 64, omega = 1.65) {
  const x = new Float64Array(grid.count), [nx,ny] = grid.dims;
  for (let s = 0; s < sweeps; s++) for (let color = 0; color < 2; color++) for (let i = 0; i < grid.count; i++) {
    if (((i%nx + Math.floor(i/nx)%ny + Math.floor(i/(nx*ny)))&1)!==color || !grid.degree[i]) continue;
    let sum = rhs[i];
    for (let k = 0; k < 6; k++) {const j = grid.neighbors[6*i+k]; if (j>=0) sum+=x[j];}
    x[i] += omega*(sum/grid.degree[i]-x[i]);
  }
  return grid.removeMean(x);
}
export async function stepFields(grid, requestedDt, solver = null) {
  const dt = grid.stableDt(requestedDt), start = performance.now();
  grid.advectVelocity(dt); grid.diffuseVelocity(dt);
  const before = rms(grid.divergence()), rhs = pressureRHS(grid);
  let solve = solver ? await solver.solve(grid,rhs) : solvePressureCPU(grid,rhs);
  // Do not accept a poorly converged GPU solve as incompressible. A small CPU
  // residual correction is explicit in diagnostics, never silently omitted.
  if (solve.relativeResidual > 2e-5) {
    const fix = solvePressureCPU(grid,rhs,{initial:solve.potential});
    solve = {...fix, backend:solve.backend+' + CPU residual correction', initialIterations:solve.iterations};
  }
  if (!Number.isFinite(solve.relativeResidual) || solve.relativeResidual > 2e-5) throw Error('Pressure did not converge within the bounded solve; step stopped');
  grid.applyProjection(solve.potential, dt);
  grid.advectScalars(dt); grid.diffuseScalars(dt); grid.time += dt;
  const after = rms(grid.divergence());
  if (!grid.temperature.every(Number.isFinite) || !grid.humidity.every(Number.isFinite) || !grid.pressure.every(Number.isFinite)) throw Error('Non-finite field: stopped');
  return {dt, before, after, reduction:before>1e-12?1-after/before:1, milliseconds:performance.now()-start, ...solve, potential:undefined};
}
