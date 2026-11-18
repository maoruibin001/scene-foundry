import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const wgsl = readFileSync(new URL('./volume-integrate.wgsl', import.meta.url), 'utf8');
const f32 = Math.fround;

function segments(start: number, end: number, depth: number, nearLight: boolean, stopAtDepth: boolean) {
  const clipped = Math.min(end, depth === 0 ? end : depth);
  const step = f32((end - start) / 96);
  const samples: {distance: number; weight: number}[] = [];
  for (let i = 0; i < 96; i++) {
    const origin = f32(start + f32(i * step));
    if (stopAtDepth && origin >= clipped) break;
    const length = Math.min(step, Math.max(0, f32(clipped - origin)));
    if (!length) continue;
    const subdivisions = nearLight ? 4 : 1;
    const weight = f32(length / subdivisions);
    for (let sub = 0; sub < subdivisions; sub++) {
      samples.push({distance: f32(origin + f32((sub + .5) * weight)), weight});
    }
  }
  return samples;
}

describe('volume integration P0', () => {
  test('the exit precedes the original clamp and leaves near-light subdivisions in place', () => {
    expect(wgsl).toMatch(/if \(segment_start >= clipped_far\) \{ break; \}\s*let segment_length = clamp\(clipped_far - segment_start, 0\.0, ray_step\);/);
    expect(wgsl).toMatch(/let subdivisions = select\(1u, 4u,/);
  });

  test.each([
    {name:'missing depth', depth:0, nearLight:false, intervals:[[2, 98]]},
    {name:'foreground before all volumes', depth:1, nearLight:false, intervals:[[2, 98]]},
    {name:'partial last step', depth:6.125, nearLight:false, intervals:[[2, 98]]},
    {name:'intersecting thin volumes resolved as ordered boundary intervals', depth:2.07, nearLight:true, intervals:[[2, 2.01], [2.01, 2.1], [2.1, 2.11]]},
    {name:'no fog', depth:0, nearLight:false, intervals:[]},
  ])('retains original positions and optical weights for $name', ({depth, nearLight, intervals}) => {
    const integrate = (stop: boolean) => intervals.flatMap(([start,end]) => segments(start, end, depth, nearLight, stop));
    expect(integrate(true)).toEqual(integrate(false));
  });

  test('the pair and ordinary lighting functions are evaluated in disjoint branches', () => {
    expect(wgsl).toMatch(/if \(mode == 3u\) \{\s*radiance = volume_light_radiance_pair\(world_position, visibility\);\s*\} else \{\s*radiance = volume_light_radiance\(world_position\) \* visibility;\s*\}/);
  });
});
