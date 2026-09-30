import { describe, expect, it } from 'vitest';
import { applyIntent, attributesOf, contextFor, specFor, validateIntent } from './intent';
import { DEFAULT_FORM } from './types';

const known = { action:'new', target:{form:'vase', object_en:null}, changes:{} };
const unknown = { action:'new', target:{form:null, object_en:'a watering can with a long spout'}, changes:{} };

describe('shape intent contract', () => {
  it('accepts both target kinds and sparse absolute attribute changes', () => {
    expect(validateIntent(known)).toEqual(known);
    expect(validateIntent(unknown)).toEqual(unknown);
    expect(validateIntent({action:'edit',target:null,changes:{twist:0,count:8}})).toEqual({action:'edit',target:null,changes:{twist:0,count:8}});
    expect(validateIntent({action:'keep',target:null,changes:{}}).action).toBe('keep');
  });

  it.each([
    null, [], {}, {...known,script:'ignored'}, {...known,action:'delete'},
    {...known,target:null}, {...known,target:{form:'vase',object_en:'a vase'}},
    {...known,target:{form:null,object_en:null}}, {...known,target:{form:'dragon',object_en:null}},
    {...known,target:{form:'vase',object_en:null,url:'https://example.test/a.glb'}},
    {action:'edit',target:known.target,changes:{twist:0}},
    {action:'edit',target:null,changes:{}}, {action:'keep',target:null,changes:{twist:0}},
    {...known,changes:[]}, {...known,changes:null}, {...known,changes:{object:'sphere'}},
  ])('rejects invalid union branches and unsupported fields: %j', value => {
    expect(() => validateIntent(value)).toThrow();
  });

  it.each([
    {count:true}, {count:1.5}, {count:0}, {count:9}, {elongation:'1.3'},
    {elongation:.499}, {elongation:2.501}, {roughness:-.001}, {roughness:1.001},
    {twist:-1.001}, {bend:1.001}, {squareness:NaN}, {elongation:Infinity}, {count:-Infinity},
  ])('rejects unsafe/out-of-range attributes without clamping: %j', changes => {
    expect(() => validateIntent({...known,changes})).toThrow();
  });

  it('accepts the declared endpoints, including neutral values', () => {
    for (const changes of [
      {squareness:0,elongation:.5,twist:-1,bend:-1,roughness:0,count:1},
      {squareness:1,elongation:2.5,twist:1,bend:1,roughness:1,count:8},
    ]) expect(validateIntent({...known,changes}).changes).toEqual(changes);
  });

  it.each(['', ' ', ' a vase', 'a vase ', '花瓶', 'a\nshape', '\uD800', '12345', 'a'.repeat(301), Array(46).fill('a').join(' ')])('rejects invalid unknown object descriptions', object_en => {
    expect(() => validateIntent({...unknown,target:{form:null,object_en}})).toThrow();
  });

  it('copies validated data, so later response mutation cannot change an accepted intent', () => {
    const raw = {...known,target:{...known.target},changes:{count:2}};
    const validated = validateIntent(raw);
    raw.target.form='cube'; raw.changes.count=8;
    expect(validated.target?.form).toBe('vase'); expect(validated.changes.count).toBe(2);
  });

  it('edits an unknown target without rebuilding it as the fallback sphere', () => {
    const before=contextFor({...DEFAULT_FORM,twist:.6,count:3},'a watering can');
    const after=applyIntent(before,validateIntent({action:'edit',target:null,changes:{elongation:1.4}}));
    expect(after.target).toEqual(before.target);
    expect(after.attributes).toEqual({...before.attributes,elongation:1.4});
    expect(specFor(after)).toEqual({...DEFAULT_FORM,twist:.6,count:3,elongation:1.4});
    expect(after.target.form).toBeNull();
    expect(before.attributes.elongation).toBe(1);
  });

  it('resets unspecified attributes only for a new target', () => {
    const before=contextFor({...DEFAULT_FORM,object:'sword',twist:.8,count:6});
    const after=applyIntent(before,validateIntent({...known,changes:{roughness:.4}}));
    expect(after.target).toEqual(known.target);
    expect(after.attributes).toEqual({...attributesOf(DEFAULT_FORM),roughness:.4});
    expect(before.attributes.count).toBe(6);
  });

  it('keeps current target and all attributes without sharing mutable references', () => {
    const original=contextFor({...DEFAULT_FORM,count:4},'an umbrella');
    const copy=applyIntent(original,validateIntent({action:'keep',target:null,changes:{}}));
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original); expect(copy.target).not.toBe(original.target);
    copy.attributes.count=1; expect(original.attributes.count).toBe(4);
  });
});
