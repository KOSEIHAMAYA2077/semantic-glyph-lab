import { describe, expect, it } from 'vitest';
import { localAttributeEdit } from './local-interpret';
import { DEFAULT_FORM, type FormSpec } from './types';

const previous:FormSpec={...DEFAULT_FORM,object:'vase',elongation:1.3,twist:.4,bend:.2,roughness:.3,count:2};

describe('only complete attribute commands bypass asset search', () => {
  it.each([
    ['四角く',{squareness:1}],
    ['四角くして。',{squareness:1}],
    ['ねじれた',{twist:.65}],
    ['四角くねじれた',{squareness:1,twist:.65}],
    ['ねじれを戻す',{twist:0}],
    ['ねじれなし',{twist:0}],
    ['普通の比率',{elongation:1}],
    ['３個',{count:3}],
    [' ＴＷＩＳＴＥＤ ',{twist:.65}],
  ] as const)('edits existing attributes without choosing a new object: %s', (text,changes) => {
    const before=Object.freeze({...previous});
    const result=localAttributeEdit(text,before);
    expect(result?.spec).toEqual({...previous,...changes});
    expect(result?.source).toBe('composed');
    expect(result?.objectSelected).toBe(false);
    expect(result?.candidates).toEqual([]);
    expect(before).toEqual(previous);
  });

  it('can color the newly added text without losing the previous shape attributes', () => {
    const result=localAttributeEdit('青色 四角く',previous);
    expect(result?.ink).toBe('#79a7ff');
    expect(result?.spec).toEqual({...previous,squareness:1});
  });

  it.each([
    ['赤くねじれた','#ef6969',{twist:.65}],
    ['赤い ねじれた','#ef6969',{twist:.65}],
    ['青く四角く','#79a7ff',{squareness:1}],
    ['青い 四角く','#79a7ff',{squareness:1}],
    ['白く３個','#eeeae2',{count:3}],
    ['白いねじれた','#eeeae2',{twist:.65}],
    ['黄色く四角く','#efd66b',{squareness:1}],
    ['黄色いねじれなし','#efd66b',{twist:0}],
  ] as const)('accepts a color adjective attached to a complete attribute command: %s', (text,ink,changes) => {
    const before=Object.freeze({...previous});
    const result=localAttributeEdit(text,before);
    expect(result?.ink).toBe(ink);
    expect(result?.spec).toEqual({...previous,...changes});
    expect(result?.objectSelected).toBe(false);
    expect(result?.candidates).toEqual([]);
    expect(before).toEqual(previous);
  });

  it.each([
    '長い注ぎ口が付いたじょうろ', '長い注ぎ口のじょうろ',
    '四角い花瓶', 'ねじれた花瓶', '細長い剣', '四角いじょうろ',
    '四角い未知の物体', '三つの輪が鎖状につながったもの',
    '花瓶', '急須', 'a long spouted watering can',
    '赤い花瓶', '赤くねじれた花瓶', '青い四角いじょうろ',
    '黄色い長い注ぎ口のじょうろ', '白い球体',
  ])('leaves noun-bearing descriptions for search or other interpretation: %s', text => {
    expect(localAttributeEdit(text,previous)).toBeUndefined();
  });

  it.each([
    '四角くしない', '四角くしないで', '四角くするな', 'ねじるな',
    'ねじるな！四角く', '四角くするな。',
    '四角くない', 'ねじれた形にはしないで',
    '「四角く」という言葉だけを追加', '四角くしてと言ったが形は変えないで',
    'do not twist', 'ねじれを戻さないで',
    '赤くねじるな', '青い 四角くしないで',
    '白く四角くするな。', '黄色くねじれを戻さないで',
  ])('does not turn prohibitions, quotations, or negation into edits: %s', text => {
    expect(localAttributeEdit(text,previous)).toBeUndefined();
  });

  it.each(['',' \n ','ただ静かな気分','青色','#abcdef','少し大きくして','太く','四角く\u200b','赤く','青い','白く','黄色い'])('does not invent an attribute edit for %j', text => {
    expect(localAttributeEdit(text,previous)).toBeUndefined();
  });

  it('keeps the same fallback object used to represent an imported mesh', () => {
    const imported={...DEFAULT_FORM,twist:.3,roughness:.2,count:3};
    expect(localAttributeEdit('四角く',imported)?.spec).toEqual({...imported,squareness:1});
    expect(imported.squareness).toBe(0);
  });

  it('does not bypass the existing input-size and type checks', () => {
    expect(() => localAttributeEdit('字'.repeat(4001),previous)).toThrow();
    expect(() => localAttributeEdit(null as unknown as string,previous)).toThrow();
  });
});
