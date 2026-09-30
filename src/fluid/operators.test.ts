import {describe,it,expect} from 'vitest';
import {divergence,projectReference,rms} from './operators';
describe('periodic staggered fluid operators',()=>{
  it('leaves a uniform transport velocity unchanged',()=>{
    const size=16,velocity=new Float32Array(size*size*4);
    for(let i=0;i<size*size;i++){velocity[i*4]=.04;velocity[i*4+1]=-.03;}
    expect(rms(divergence(velocity,size))).toBe(0);
    expect(projectReference(velocity,size,40).velocity).toEqual(velocity);
  });
  it('reduces a compressive field without a mismatched centered-gradient stencil',()=>{
    const size=32,velocity=new Float32Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(y*size+x)*4;velocity[i]=.03*Math.sin(2*Math.PI*4*(x+1)/size);velocity[i+1]=.02*Math.sin(2*Math.PI*5*(y+1)/size);
    }
    const before=rms(divergence(velocity,size)),after=projectReference(velocity,size,100);
    expect(rms(divergence(after.velocity,size))/before).toBeLessThan(.00001);
    expect([...after.velocity].every(Number.isFinite)).toBe(true);
    expect(Math.abs(divergence(velocity,size).reduce((a,b)=>a+b,0))).toBeLessThan(.0001);
  });
});
