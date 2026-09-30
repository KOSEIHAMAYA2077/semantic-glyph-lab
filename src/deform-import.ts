import { BufferGeometry, Vector3 } from 'three';
import type { FormSpec } from './types';
/** Deform imported surfaces without replacing their identity or accumulating drift. */
export function deformImport(base: BufferGeometry, spec: FormSpec) {
  const geometry=base.clone(); base.computeBoundingBox();
  const half=base.boundingBox!.getSize(new Vector3()).multiplyScalar(.5);
  half.set(Math.max(half.x,1e-5),Math.max(half.y,1e-5),Math.max(half.z,1e-5));
  const exponent=2+spec.squareness*18;
  const transform=(v:Vector3)=>{
    let x=v.x,y=v.y,z=v.z;
    if(spec.squareness>0) {
      const nx=x/half.x,ny=y/half.y,nz=z/half.z,length=Math.hypot(nx,ny,nz);
      if(length>1e-8) {const factor=1/((Math.abs(nx/length)**exponent+Math.abs(ny/length)**exponent+Math.abs(nz/length)**exponent)**(1/exponent)); x*=factor;y*=factor;z*=factor;}
    }
    const noise=1+spec.roughness*.085*Math.sin(x*4.8+y*2.3)*Math.cos(z*5.1-y*3.7);
    x*=noise;y*=noise;z*=noise;
    const angle=spec.twist*y*1.45,c=Math.cos(angle),s=Math.sin(angle),rx=x*c-z*s,rz=x*s+z*c;
    y*=spec.elongation;return v.set(rx+spec.bend*.43*(y*y-.4),y,rz);
  };
  const pos=geometry.getAttribute('position'), normal=geometry.getAttribute('normal');
  const p=new Vector3(),n=new Vector3(),u=new Vector3(),v=new Vector3(),o=new Vector3(),a=new Vector3(),b=new Vector3();
  for(let i=0;i<pos.count;i++) {
    p.fromBufferAttribute(pos,i);n.fromBufferAttribute(normal,i).normalize();
    u.set(Math.abs(n.y)<.9?0:1,Math.abs(n.y)<.9?1:0,0).cross(n).normalize();v.crossVectors(n,u).normalize();
    transform(o.copy(p));transform(a.copy(p).addScaledVector(u,1e-4));transform(b.copy(p).addScaledVector(v,1e-4));
    a.sub(o);b.sub(o);a.cross(b).normalize();
    pos.setXYZ(i,o.x,o.y,o.z);normal.setXYZ(i,a.x,a.y,a.z);
  }
  pos.needsUpdate=normal.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
