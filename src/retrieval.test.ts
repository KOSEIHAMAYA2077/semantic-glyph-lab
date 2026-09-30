import { describe, expect, it } from 'vitest';
import { validateAssetSearch } from './retrieval';

function response() {
  return {
    candidates: [
      { id:'polyhaven-ceramic_vase_03', name:'Ceramic Vase 03', path:'/retrieval-models/ceramic_vase_03-geometry.glb', source:'https://polyhaven.com/a/ceramic_vase_03', score:.863513 },
      { id:'polyhaven-watering_can_metal_01', name:'Watering Can Metal 01', path:'/retrieval-models/watering_can_metal_01-geometry.glb', source:'https://polyhaven.com/a/watering_can_metal_01', score:.242816 },
      { id:'polyhaven-wooden_handle_saber', name:'Wooden Handle Saber', path:'/retrieval-models/wooden_handle_saber-geometry.glb', source:'https://polyhaven.com/a/wooden_handle_saber', score:-.098569 },
    ],
    catalogCount:3,
    elapsedMs:1.83,
  };
}

describe('retrieval is a list of prepared candidates, never an automatic choice', () => {
  it('accepts the three prepared local meshes and preserves negative similarities', () => {
    const raw=response();
    const result=validateAssetSearch(raw);
    expect(result).toEqual(raw);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[2].score).toBeLessThan(0);
    expect(result).not.toHaveProperty('selected');
    expect(result).not.toHaveProperty('threshold');
  });

  it.each([
    { selected:null }, { selected:response().candidates[0] }, { selected:'polyhaven-ceramic_vase_03' },
    { threshold:0 }, { threshold:.48 },
  ])('rejects a server attempting to add a selection rule: %j', extra => {
    expect(() => validateAssetSearch({...response(),...extra})).toThrow();
  });

  it('accepts non-selecting timing metadata from the real service', () => {
    expect(validateAssetSearch({...response(),maxTokens:128}).catalogCount).toBe(3);
  });

  it.each([null,undefined,[],{},'not a response',{...response(),candidates:null},{...response(),candidates:{}}])('rejects incomplete response structure: %j', raw => {
    expect(() => validateAssetSearch(raw)).toThrow();
  });

  it.each([0,-1,1.5,33,NaN,Infinity,true,'3'])('rejects an invalid catalogue count: %s', catalogCount => {
    expect(() => validateAssetSearch({...response(),catalogCount})).toThrow();
  });

  it('does not silently accept missing candidates or duplicate identities', () => {
    const raw=response();
    expect(() => validateAssetSearch({...raw,candidates:raw.candidates.slice(0,2)})).toThrow();
    expect(() => validateAssetSearch({...raw,candidates:[raw.candidates[0],raw.candidates[0],raw.candidates[2]]})).toThrow();
    expect(() => validateAssetSearch({...raw,candidates:[]})).toThrow();
    expect(() => validateAssetSearch({...raw,candidates:[null,...raw.candidates.slice(1)]})).toThrow();
  });

  it.each([-Infinity,Infinity,NaN,-1.000001,1.000001,'0.4',null,true])('rejects a nonfinite, nonnumeric, or out-of-domain similarity: %s', score => {
    const raw=response();
    expect(() => validateAssetSearch({...raw,candidates:[{...raw.candidates[0],score},...raw.candidates.slice(1)]})).toThrow();
  });

  it('accepts both cosine endpoints and zero time without imposing a confidence threshold', () => {
    const raw=response();
    raw.candidates.forEach((item,index)=>{item.score=[-1,0,1][index];});
    raw.elapsedMs=0;
    expect(validateAssetSearch(raw)).toEqual(raw);
  });

  it.each([-1,NaN,Infinity,'1',null])('rejects invalid elapsed time: %s', elapsedMs => {
    expect(() => validateAssetSearch({...response(),elapsedMs})).toThrow();
  });

  it.each([
    'https://example.invalid/model.glb', '//example.invalid/model.glb', 'file:///tmp/model.glb',
    'blob:http://127.0.0.1/example', 'data:model/gltf-binary;base64,AAAA', '/generated/model.glb',
    'retrieval-models/model.glb', '/retrieval-models/subdirectory/model.glb',
    '/retrieval-models/../model.glb', '/retrieval-models/a..b.glb',
    '/retrieval-models/%2e%2e.glb', '/retrieval-models/%2fmodel.glb',
    '/retrieval-models/model.glb?url=remote', '/retrieval-models/model.glb#fragment',
    '/retrieval-models/model.gltf', '/retrieval-models/model.glb\n', '/retrieval-models/model\\evil.glb',
  ])('keeps mesh paths in one local GLB directory: %s', path => {
    const raw=response();
    expect(() => validateAssetSearch({...raw,candidates:[{...raw.candidates[0],path},...raw.candidates.slice(1)]})).toThrow();
  });

  it.each([
    'http://polyhaven.com/a/ceramic_vase_03', 'https://polyhaven.com.evil.invalid/a/vase',
    'https://evil.invalid/a/vase', 'https://polyhaven.com/a/../vase',
    'https://polyhaven.com/a/vase?next=evil', 'javascript:alert(1)',
  ])('only accepts official source-page links: %s', source => {
    const raw=response();
    expect(() => validateAssetSearch({...raw,candidates:[{...raw.candidates[0],source},...raw.candidates.slice(1)]})).toThrow();
  });

  it.each([
    { id:'' }, { id:'Uppercase' }, { id:'two ids' }, { id:'x'.repeat(81) },
    { name:'' }, { name:' \n ' }, { name:'x'.repeat(201) }, { name:7 },
  ])('rejects unusable candidate identities or names: %j', update => {
    const raw=response();
    expect(() => validateAssetSearch({...raw,candidates:[{...raw.candidates[0],...update},...raw.candidates.slice(1)]})).toThrow();
  });
});
