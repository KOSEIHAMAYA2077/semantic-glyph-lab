import * as THREE from 'three';
import { createForm, FORM_IDS } from './geometry';
import { DEFAULT_FORM, type FormSpec, type ObjectId } from './types';
type Deformation=Partial<Pick<FormSpec,'squareness'|'elongation'|'twist'|'bend'|'roughness'>>;
export interface Part { kind:'box'|'cylinder'|'torus'|ObjectId; deformation?:Deformation; position:[number,number,number]; scale:[number,number,number]; rotation:[number,number,number] }
export interface Composition { label:string; parts:Part[]; model?:string; elapsedMs?:number; vocabulary?:'forms'|'primitives' }
export function validateComposition(value: unknown): Composition {
  if (!value || typeof value !== 'object') throw new Error('形の部品を確認できませんでした。');
  const data = value as Composition;
  if (typeof data.label !== 'string' || !data.label.length || data.label.length > 80 || /[\x00-\x1f]/.test(data.label) || !Array.isArray(data.parts) || data.parts.length < 1 || data.parts.length > 24) throw new Error('形の部品数または名前が範囲外です。');
  for (const part of data.parts) {
    if (!part || !['box','cylinder','torus',...FORM_IDS].includes(part.kind)) throw new Error('扱えない形の部品です。');
    if(part.deformation !== undefined) {
      if(!part.deformation || typeof part.deformation !== 'object' || Array.isArray(part.deformation)) throw new Error('変形の指定が不正です。');
      const limits={squareness:[0,1],elongation:[.5,2.5],twist:[-1,1],bend:[-1,1],roughness:[0,1]};
      for(const [name,value] of Object.entries(part.deformation)) {
        const range=limits[name as keyof typeof limits];
        if(!range || typeof value!=='number' || !Number.isFinite(value) || value<range[0] || value>range[1]) throw new Error('変形の指定が範囲外です。');
      }
    }
    for (const [name,lo,hi] of [['position',-5,5],['scale',.03,4],['rotation',-Math.PI,Math.PI]] as const) {
      const vector = part[name];
      if (!Array.isArray(vector) || vector.length !== 3 || vector.some(n=>typeof n !== 'number' || !Number.isFinite(n) || n<lo || n>hi)) throw new Error('形の座標が範囲外です。');
    }
  }
  return data;
}
export function compositionGroup(input: unknown): THREE.Group {
  const data=validateComposition(input), group=new THREE.Group();
  for (const p of data.parts) {
    const isForm=FORM_IDS.includes(p.kind as ObjectId) && (p.deformation || !['sphere','cone'].includes(p.kind));
    const geometry = isForm ? createForm({...DEFAULT_FORM,...p.deformation,object:p.kind as ObjectId}) : p.kind === 'box' ? new THREE.BoxGeometry(1,1,1,6,6,6)
      : p.kind === 'sphere' ? new THREE.SphereGeometry(.5,40,24)
      : p.kind === 'cylinder' ? new THREE.CylinderGeometry(.5,.5,1,32,8)
      : p.kind === 'cone' ? new THREE.ConeGeometry(.5,1,32,8)
      : new THREE.TorusGeometry(.4,.1,16,64);
    if(isForm) { geometry.computeBoundingBox(); const size=geometry.boundingBox!.getSize(new THREE.Vector3()); const factor=1/Math.max(size.x,size.y,size.z); geometry.scale(factor,factor,factor); }
    const mesh=new THREE.Mesh(geometry);
    mesh.position.fromArray(p.position); mesh.scale.fromArray(p.scale); mesh.rotation.set(...p.rotation);
    group.add(mesh);
  }
  return group;
}
