import { describe,it,expect } from 'vitest';
import { Box3,Vector3 } from 'three';
import { compositionGroup,validateComposition } from './composition';
const part={kind:'box',position:[1,0,0],scale:[2,1,.5],rotation:[0,0,0]};
describe('モデルの出力を座標だけとして受け取る境界',()=>{
  it.each([null,{}, {label:'x',parts:[]},{label:'x',parts:Array(25).fill(part)}, {label:'x',parts:[{...part,position:[0,NaN,0]}]}, {label:'x',parts:[{...part,scale:[0,1,1]}]}, {label:'x',parts:[{...part,kind:'script'}]}])('不正な構造を描画前に棄却する',value=>expect(()=>validateComposition(value)).toThrow());
  it('位置・尺度の契約どおりに部品を組む',()=>{
    const group=compositionGroup({label:'box',parts:[part]});
    const box=new Box3().setFromObject(group); expect(box.min.x).toBe(0); expect(box.max.x).toBe(2);
    expect(box.getSize(new Vector3()).toArray()).toEqual([2,1,.5]);
  });
  it('穴のある輪はXY面に立ち、X回転で水平になる',()=>{
    const group=compositionGroup({label:'ring',parts:[{...part,kind:'torus',position:[0,0,0],scale:[1,1,1],rotation:[Math.PI/2,0,0]}]});
    const size=new Box3().setFromObject(group).getSize(new Vector3());
    expect(size.y).toBeCloseTo(.2); expect(size.x).toBeCloseTo(1); expect(size.z).toBeCloseTo(1);
  });
});
