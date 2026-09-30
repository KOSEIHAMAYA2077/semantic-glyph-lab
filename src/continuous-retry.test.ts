import { describe, expect, it, vi } from 'vitest';
import { ContinuousInput, type AcceptedWriting } from './continuous';
import { contextFor, type ShapeContext, type ShapeIntent } from './intent';
import { DEFAULT_FORM } from './types';

const unknown: ShapeIntent = { action:'new', target:{form:null, object_en:'a watering can'}, changes:{} };
const keep: ShapeIntent = { action:'keep', target:null, changes:{} };
const edit: ShapeIntent = { action:'edit', target:null, changes:{squareness:1, twist:.7, count:2} };
function deferred<T>() {
  let resolve!: (value:T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check: () => boolean) {
  for (let i=0;i<100;i++) { if (check()) return; await Promise.resolve(); }
  throw new Error('Expected asynchronous state was not reached');
}
function fixture(options: {
  failAt?: 'generation'|'installation';
  regenerate?: () => Promise<string>;
  blockRoute?: Promise<ShapeIntent>;
} = {}) {
  const failAt = options.failAt ?? 'generation';
  let generations=0, installations=0;
  const originals: AcceptedWriting[] = [];
  const hooks = {
    accepted:vi.fn((entry:AcceptedWriting) => { originals.push({...entry}); }),
    route:vi.fn(async (raw:string):Promise<ShapeIntent> => {
      if(raw==='じょうろ')return unknown;
      if(raw==='大きく')throw new Error('Unsupported edit');
      if(raw==='四角く、ねじれた')return edit;
      if(raw==='別の花瓶')return {action:'new', target:{form:'vase', object_en:null}, changes:{}};
      if(raw==='blocked')return options.blockRoute ?? keep;
      return keep;
    }),
    generate:vi.fn(async (_description:string) => {
      generations++;
      if(failAt==='generation'&&generations===1)throw new Error('503');
      if(options.regenerate&&generations>1)return options.regenerate();
      return `mesh ${generations}`;
    }),
    install:vi.fn(async (_payload:string, _context:ShapeContext, isCurrent:()=>boolean) => {
      installations++;
      if(failAt==='installation'&&installations===1)throw new Error('Invalid GLB');
      return isCurrent();
    }),
    known:vi.fn(), edit:vi.fn(), invalidate:vi.fn(), changed:vi.fn(), release:vi.fn(),
  };
  const controller = new ContinuousInput(contextFor(DEFAULT_FORM), hooks);
  return { controller, hooks, originals };
}
async function bothFailures(h:ReturnType<typeof fixture>) {
  h.controller.submit('じょうろ');
  await h.controller.whenIdle();
  expect(h.controller.state.canRetry).toBe(true);
  h.controller.submit('大きく');
  await h.controller.whenIdle();
  expect(h.controller.state).toMatchObject({canRetry:true, canRetryGeneration:true});
}

describe('separate retry for a generated target and a later failed input', () => {
  it.each(['generation','installation'] as const)('retains the %s retry after repeated route failure without adding original text twice', async failAt => {
    const h=fixture({failAt});
    await bothFailures(h);
    expect(h.controller.retry()).toBe(true);
    await h.controller.whenIdle();
    expect(h.hooks.generate).toHaveBeenCalledTimes(1);
    expect(h.hooks.route.mock.calls.map(([raw])=>raw)).toEqual(['じょうろ','大きく','大きく']);
    expect(h.controller.state.canRetryGeneration).toBe(true);
    expect(h.controller.retryGeneration()).toBe(true);
    expect(h.controller.retryGeneration()).toBe(false);
    await h.controller.whenIdle();
    expect(h.hooks.generate.mock.calls.map(([description])=>description)).toEqual(['a watering can','a watering can']);
    expect(h.hooks.install.mock.calls.at(-1)?.[0]).toBe('mesh 2');
    expect(h.controller.state.canRetryGeneration).toBe(false);
    expect(h.controller.accepted.map(({raw,state})=>({raw,state}))).toEqual([
      {raw:'じょうろ',state:'applied'}, {raw:'大きく',state:'failed'},
    ]);
    expect(h.originals.map(entry=>entry.raw)).toEqual(['じょうろ','大きく']);
    expect(h.hooks.accepted).toHaveBeenCalledTimes(2);
    expect(h.hooks.release).toHaveBeenCalledTimes(failAt==='installation'?2:1);
  });

  it('applies a valid later edit to the retried target and preserves the unrelated failed entry', async () => {
    const h=fixture();
    await bothFailures(h);
    h.controller.submit('四角く、ねじれた');
    await h.controller.whenIdle();
    expect(h.hooks.edit).not.toHaveBeenCalled();
    expect(h.controller.retryGeneration()).toBe(true);
    await h.controller.whenIdle();
    const installed=h.hooks.install.mock.calls.at(-1)![1];
    expect(installed.target).toEqual(unknown.target);
    expect(installed.attributes).toMatchObject({squareness:1,twist:.7,count:2});
    expect(h.controller.accepted.find(entry=>entry.raw==='大きく')?.state).toBe('failed');
    expect(h.hooks.accepted).toHaveBeenCalledTimes(3);
    expect(h.controller.state.canRetryGeneration).toBe(false);
  });

  it('retains both retry paths when the regenerated target also fails', async () => {
    let attempts=0;
    const h=fixture({regenerate:async()=>{
      if(++attempts===1)throw new Error('retry 503');
      return 'successful retry mesh';
    }});
    await bothFailures(h);
    expect(h.controller.retryGeneration()).toBe(true);
    await h.controller.whenIdle();
    expect(h.controller.state).toMatchObject({canRetry:true,canRetryGeneration:true});
    expect(h.controller.state.error).toContain('Unsupported edit');
    expect(h.controller.state.error).toContain('retry 503');
    expect(h.controller.retry()).toBe(true);
    await h.controller.whenIdle();
    expect(h.hooks.generate).toHaveBeenCalledTimes(2);
    expect(h.controller.state.canRetryGeneration).toBe(true);
    expect(h.controller.retryGeneration()).toBe(true);
    await h.controller.whenIdle();
    expect(h.hooks.install.mock.calls.at(-1)?.[0]).toBe('successful retry mesh');
    expect(h.hooks.generate).toHaveBeenCalledTimes(3);
    expect(h.controller.state.canRetryGeneration).toBe(false);
    expect(h.controller.accepted.find(entry=>entry.raw==='大きく')?.state).toBe('failed');
    expect(h.hooks.accepted).toHaveBeenCalledTimes(2);
  });

  it.each(['cancel','new target'] as const)('rejects the older target retry after %s', async action => {
    const h=fixture();
    await bothFailures(h);
    if(action==='cancel')h.controller.reset(contextFor({...DEFAULT_FORM,object:'tree'}));
    else { h.controller.submit('別の花瓶'); await h.controller.whenIdle(); }
    expect(h.controller.state).toMatchObject({canRetry:false,canRetryGeneration:false});
    expect(h.controller.retryGeneration()).toBe(false);
    await h.controller.whenIdle();
    expect(h.hooks.generate).toHaveBeenCalledTimes(1);
    expect(h.hooks.install).not.toHaveBeenCalled();
    expect(h.controller.current.target.form).toBe(action==='cancel'?'tree':'vase');
    expect(h.controller.accepted.filter(entry=>entry.raw==='じょうろ')).toHaveLength(1);
  });

  it('discards an already running regeneration when cancellation invalidates its target', async () => {
    const regenerated=deferred<string>();
    const h=fixture({regenerate:()=>regenerated.promise});
    await bothFailures(h);
    expect(h.controller.retryGeneration()).toBe(true);
    await until(()=>h.hooks.generate.mock.calls.length===2);
    h.controller.reset(contextFor({...DEFAULT_FORM,object:'tree'}));
    regenerated.resolve('cancelled retry mesh');
    await h.controller.whenIdle();
    expect(h.hooks.install).not.toHaveBeenCalled();
    expect(h.hooks.release).toHaveBeenCalledExactlyOnceWith('cancelled retry mesh');
    expect(h.controller.state).toMatchObject({canRetry:false,canRetryGeneration:false,error:''});
    expect(h.controller.retryGeneration()).toBe(false);
    expect(h.controller.current.target.form).toBe('tree');
    expect(h.originals.map(entry=>entry.raw)).toEqual(['じょうろ','大きく']);
  });

  it('keeps the ordinary generation-only retry working without duplicating original writing', async () => {
    const h=fixture();
    h.controller.submit('じょうろ');
    await h.controller.whenIdle();
    expect(h.controller.state).toMatchObject({canRetry:true,canRetryGeneration:false});
    expect(h.controller.retry()).toBe(true);
    await h.controller.whenIdle();
    expect(h.hooks.install).toHaveBeenCalledTimes(1);
    expect(h.hooks.generate).toHaveBeenCalledTimes(2);
    expect(h.hooks.accepted).toHaveBeenCalledTimes(1);
    expect(h.controller.state).toMatchObject({canRetry:false,canRetryGeneration:false});
  });

  it('schedules regeneration behind a full input queue without accepting another original', async () => {
    const gate=deferred<ShapeIntent>();
    const h=fixture({blockRoute:gate.promise});
    await bothFailures(h);
    h.controller.submit('blocked');
    await until(()=>h.hooks.route.mock.calls.some(([raw])=>raw==='blocked'));
    for(let i=0;i<8;i++)expect(h.controller.submit(`keep ${i}`)).toBe(true);
    expect(h.controller.state.pending).toBe(8);
    expect(h.controller.retryGeneration()).toBe(true);
    expect(h.controller.retryGeneration()).toBe(false);
    expect(h.controller.state.pending).toBe(8);
    expect(h.hooks.generate).toHaveBeenCalledTimes(1);
    gate.resolve(keep);
    await h.controller.whenIdle();
    expect(h.controller.state.canRetryGeneration).toBe(false);
    expect(h.hooks.generate).toHaveBeenCalledTimes(2);
    expect(h.hooks.accepted).toHaveBeenCalledTimes(11);
  });
});
