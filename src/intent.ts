import { DEFAULT_FORM, type FormSpec, type ObjectId } from './types';

export type ShapeTarget = { form: ObjectId; object_en: null } | { form: null; object_en: string };
export type Attributes = Omit<FormSpec, 'object'>;
export interface ShapeContext { target: ShapeTarget; attributes: Attributes }
export type ShapeIntent =
  | { action: 'new'; target: ShapeTarget; changes: Partial<Attributes> }
  | { action: 'edit'; target: null; changes: Partial<Attributes> }
  | { action: 'keep'; target: null; changes: Record<string, never> };

const forms = new Set('sphere cube vase sword tree flower fish bird chair table mug bottle house tower ring star heart knot shell cone pyramid rock cloud mushroom'.split(' '));
const bounds: Record<keyof Attributes, [number, number]> = { squareness:[0,1], elongation:[.5,2.5], twist:[-1,1], bend:[-1,1], roughness:[0,1], count:[1,8] };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('形の応答を確認できませんでした。');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || !expected.every(key=>Object.hasOwn(value,key))) throw new Error('形の応答に不明な項目があります。');
}
export function validateIntent(raw: unknown): ShapeIntent {
  const value=object(raw); keys(value,['action','target','changes']);
  if (typeof value.action!=='string'||!['new','edit','keep'].includes(value.action)) throw new Error('形の操作を確認できませんでした。');
  const changes=object(value.changes);
  for(const [key,number] of Object.entries(changes)) {
    const range=Object.hasOwn(bounds,key)?bounds[key as keyof Attributes]:undefined;
    if(!range || typeof number!=='number' || !Number.isFinite(number) || number<range[0] || number>range[1] || (key==='count'&&!Number.isInteger(number))) throw new Error('形の属性が範囲外です。');
  }
  if(value.action==='new') {
    const target=object(value.target);keys(target,['form','object_en']);
    if(target.form===null) {
      const name=target.object_en;
      if(typeof name!=='string'||name!==name.trim()||name.length<1||name.length>300||!/^[\x20-\x7e]+$/.test(name)||!/[a-z]/i.test(name)||name.split(/\s+/).length>45) throw new Error('物体の説明を確認できませんでした。');
    } else if(typeof target.form!=='string'||!forms.has(target.form)||target.object_en!==null) throw new Error('物体の指定を確認できませんでした。');
  } else if(value.target!==null || (value.action==='keep'&&Object.keys(changes).length) || (value.action==='edit'&&!Object.keys(changes).length)) throw new Error('形を保つ操作の応答が不正です。');
  return structuredClone(value) as unknown as ShapeIntent;
}
export function attributesOf(spec:FormSpec):Attributes {
  const {object:_object,...attributes}=spec;return {...attributes};
}
export function contextFor(spec:FormSpec,object_en?:string):ShapeContext {
  return {target:object_en?{form:null,object_en}:{form:spec.object,object_en:null},attributes:attributesOf(spec)};
}
export function applyIntent(context:ShapeContext,intent:ShapeIntent):ShapeContext {
  if(intent.action==='keep')return structuredClone(context);
  return {target:structuredClone(intent.action==='new'?intent.target:context.target),attributes:{...attributesOf(intent.action==='new'?DEFAULT_FORM:{...context.attributes,object:'sphere'}),...intent.changes}};
}
export function specFor(context:ShapeContext):FormSpec {
  return {object:context.target.form??'sphere',...context.attributes};
}
