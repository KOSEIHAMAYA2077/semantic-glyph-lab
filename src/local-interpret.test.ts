import { expect, it } from 'vitest';
import { localInterpret } from './local-interpret';
import { DEFAULT_FORM } from './types';
it('attributes preserve the existing object and compose into the form',()=>{
 const vase=localInterpret('花瓶',DEFAULT_FORM).spec;
 expect(localInterpret('四角くねじれた',vase).spec).toMatchObject({object:'vase',squareness:1,twist:.7});
 expect(localInterpret('普通の形へ戻す',vase).spec).toEqual(vase);
});
it('explicit multi-character objects take precedence over their contained characters',()=>{
 expect(localInterpret('花瓶',DEFAULT_FORM).spec.object).toBe('vase');
 expect(localInterpret('瓶',DEFAULT_FORM).spec.object).toBe('bottle');
});
