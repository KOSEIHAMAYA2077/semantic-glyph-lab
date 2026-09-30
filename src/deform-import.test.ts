import {it,expect} from 'vitest';
import {SphereGeometry} from 'three';
import {deformImport} from './deform-import';
import {DEFAULT_FORM} from './types';
it('生成した元形状を残し、属性を繰り返しても変形を累積しない',()=>{
  const base=new SphereGeometry(1,24,16),before=Array.from(base.getAttribute('position').array);
  const spec={...DEFAULT_FORM,elongation:2,twist:.6,squareness:1};
  const a=deformImport(base,spec),b=deformImport(base,spec);
  expect(Array.from(base.getAttribute('position').array)).toEqual(before);
  expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array);
  expect(a.getAttribute('position').count).toBe(base.getAttribute('position').count);
  for(const key of ['position','normal']) expect(Array.from(a.getAttribute(key).array).every(Number.isFinite)).toBe(true);
  expect(a.boundingBox!.max.y).toBeCloseTo(2);
});
