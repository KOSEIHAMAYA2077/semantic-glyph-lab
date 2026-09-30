import { describe, expect, it } from 'vitest';
import { localInterpret } from './local-interpret';
import { DEFAULT_FORM, type FormSpec, type Interpretation } from './types';
import fixturesJson from './rule-fixtures.json?raw';
it('attributes preserve the existing object and compose into the form',()=>{
 const vase=localInterpret('花瓶',DEFAULT_FORM).spec;
 expect(localInterpret('四角くねじれた',vase).spec).toMatchObject({object:'vase',squareness:1,twist:.65});
 expect(localInterpret('普通の形へ戻す',vase).spec).toEqual(vase);
});
describe('Python server rules and offline interpretation agree',()=>{
 const {fixtures}=JSON.parse(fixturesJson) as {fixtures:{text:string;previous:FormSpec;expected:Omit<Interpretation,'elapsedMs'>}[]};
 it.each(fixtures)('$text',({text,previous,expected})=>{
  const {elapsedMs,...result}=localInterpret(text,previous);
  expect(result).toEqual(expected);
  expect(elapsedMs).toBe(0);
 });
 it('does not change a caller-owned previous form',()=>{
  const previous=Object.freeze({...DEFAULT_FORM,object:'vase' as const,twist:.4});
  expect(localInterpret('ねじれなし',previous).spec.twist).toBe(0);
  expect(previous.twist).toBe(.4);
 });
});
it('explicit multi-character objects take precedence over their contained characters',()=>{
 expect(localInterpret('花瓶',DEFAULT_FORM).spec.object).toBe('vase');
 expect(localInterpret('瓶',DEFAULT_FORM).spec.object).toBe('bottle');
});
