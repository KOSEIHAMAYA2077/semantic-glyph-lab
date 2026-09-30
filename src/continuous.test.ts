import { describe, expect, it, vi } from 'vitest';
import { ContinuousInput, type AcceptedWriting, type ContinuousState } from './continuous';
import { contextFor, validateIntent, type ShapeContext, type ShapeIntent } from './intent';
import { DEFAULT_FORM, type ObjectId } from './types';

const keep:ShapeIntent={action:'keep',target:null,changes:{}};
const newKnown=(form:ObjectId):ShapeIntent=>({action:'new',target:{form,object_en:null},changes:{}});
const newUnknown=(object_en:string):ShapeIntent=>({action:'new',target:{form:null,object_en},changes:{}});
const edit=(changes:Extract<ShapeIntent,{action:'edit'}>['changes']):ShapeIntent=>({action:'edit',target:null,changes});
function deferred<T>() {
  let resolve!:(value:T)=>void, reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
async function until(check:()=>boolean) {
  for(let n=0;n<100;n++) { if(check())return; await Promise.resolve(); }
  throw new Error('Expected asynchronous test state was not reached');
}
interface Setup {
  route?:(text:string,current:ShapeContext)=>Promise<ShapeIntent>;
  generate?:(description:string)=>Promise<string>;
  install?:(payload:string,current:ShapeContext,isCurrent:()=>boolean)=>Promise<boolean>;
  accepted?:(entry:AcceptedWriting)=>void;
  known?:(current:ShapeContext)=>void;
  edit?:(current:ShapeContext)=>void;
  limit?:number;
}
function setup(options:Setup={}) {
  const received:AcceptedWriting[]=[], states:ContinuousState[]=[], operations:string[]=[];
  let active=0,maxActive=0;
  async function exclusive<T>(name:string,work:()=>Promise<T>) {
    operations.push(name);active++;maxActive=Math.max(maxActive,active);
    try{return await work();}finally{active--;}
  }
  const hooks={
    accepted:vi.fn((entry:AcceptedWriting)=>{options.accepted?.(entry);received.push({...entry});}),
    route:vi.fn((text:string,current:ShapeContext)=>exclusive(`route:${text}`,()=>options.route?.(text,current)??Promise.resolve(keep))),
    generate:vi.fn((text:string)=>exclusive(`generate:${text}`,()=>options.generate?.(text)??Promise.resolve(`mesh:${text}`))),
    known:vi.fn((current:ShapeContext)=>options.known?.(current)),
    edit:vi.fn((current:ShapeContext)=>options.edit?.(current)),
    install:vi.fn((payload:string,current:ShapeContext,isCurrent:()=>boolean)=>exclusive(`install:${payload}`,()=>options.install?.(payload,current,isCurrent)??Promise.resolve(isCurrent()))),
    invalidate:vi.fn(),
    changed:vi.fn((state:ContinuousState)=>states.push({...state})),
    release:vi.fn(),
  };
  const scheduler=new ContinuousInput(contextFor(DEFAULT_FORM),hooks,options.limit??8);
  return {scheduler,hooks,received,states,operations,get maxActive(){return maxActive;}};
}

describe('continuous writing without waiting for shape inference',()=>{
  it('accepts raw text once immediately, while a preceding interpretation is unresolved',async()=>{
    const first=deferred<ShapeIntent>();
    const h=setup({route:text=>text==='一文目'?first.promise:Promise.resolve(keep)});
    expect(h.scheduler.submit('一文目')).toBe(true);
    await until(()=>h.hooks.route.mock.calls.length===1);
    expect(h.scheduler.submit(' 二文目\n次の行 ')).toBe(true);
    expect(h.scheduler.submit('e\u0301 と 👩‍💻')).toBe(true);
    expect(h.received.map(e=>e.raw)).toEqual(['一文目',' 二文目\n次の行 ','e\u0301 と 👩‍💻']);
    expect(h.scheduler.accepted.map(e=>e.raw)).toEqual(h.received.map(e=>e.raw));
    expect(h.hooks.route).toHaveBeenCalledTimes(1);
    first.resolve(keep);await h.scheduler.whenIdle();
    expect(h.hooks.route.mock.calls.map(([text])=>text)).toEqual(h.received.map(e=>e.raw));
    expect(h.scheduler.accepted.map(e=>e.state)).toEqual(['applied','applied','applied']);
    expect(h.hooks.accepted).toHaveBeenCalledTimes(3);expect(h.maxActive).toBe(1);
  });

  it('uses a bounded FIFO and refuses excess input before its acceptance hook',async()=>{
    const gate=deferred<ShapeIntent>();
    const h=setup({route:text=>text==='active'?gate.promise:Promise.resolve(keep)});
    h.scheduler.submit('active');await until(()=>h.hooks.route.mock.calls.length===1);
    for(let n=0;n<8;n++)expect(h.scheduler.submit(`queued ${n}`)).toBe(true);
    expect(h.scheduler.state.pending).toBe(8);
    expect(h.scheduler.submit('must remain in editor')).toBe(false);
    expect(h.scheduler.submit(' \n\t')).toBe(false);
    expect(h.hooks.accepted).toHaveBeenCalledTimes(9);
    expect(h.scheduler.accepted.some(e=>e.raw==='must remain in editor')).toBe(false);
    gate.resolve(keep);await h.scheduler.whenIdle();
    expect(h.hooks.route.mock.calls.map(([text])=>text)).toEqual(['active',...Array.from({length:8},(_,n)=>`queued ${n}`)]);
  });

  it('lets the glyph-capacity hook reject atomically without losing or partially queuing raw writing',async()=>{
    const segmenter=new Intl.Segmenter('ja',{granularity:'grapheme'});
    let available=1;
    const h=setup({accepted:entry=>{
      const length=Array.from(segmenter.segment(entry.raw)).filter(g=>!/^\s+$/u.test(g.segment)).length;
      if(length>available)throw new Error('capacity');available-=length;
    }});
    expect(()=>h.scheduler.submit('e\u0301と')).toThrow('capacity');
    expect(h.scheduler.accepted).toHaveLength(0);expect(h.scheduler.state.pending).toBe(0);
    expect(h.scheduler.submit(' e\u0301\n')).toBe(true);await h.scheduler.whenIdle();
    expect(h.scheduler.accepted[0].raw).toBe(' e\u0301\n');
    expect(h.received).toHaveLength(1);expect(available).toBe(0);
  });

  it('routes newer writing before adopting an older completed generated model',async()=>{
    const generation=deferred<string>();
    const h=setup({route:async text=>text==='A'?newUnknown('a watering can'):newKnown('vase'),generate:()=>generation.promise});
    h.scheduler.submit('A');await until(()=>h.hooks.generate.mock.calls.length===1);
    h.scheduler.submit('B');generation.resolve('old A');await h.scheduler.whenIdle();
    expect(h.scheduler.current.target.form).toBe('vase');
    expect(h.hooks.known).toHaveBeenCalledTimes(1);expect(h.hooks.install).not.toHaveBeenCalled();
    expect(h.hooks.release).toHaveBeenCalledExactlyOnceWith('old A');expect(h.maxActive).toBe(1);
  });

  it('retains the pending unknown target and uses its latest attributes after edits',async()=>{
    const generation=deferred<string>();
    const contexts:ShapeContext[]=[];
    const h=setup({route:async(text,current)=>{contexts.push(current);return text==='A'?newUnknown('an umbrella'):edit({elongation:1.6,count:2});},generate:()=>generation.promise});
    h.scheduler.submit('A');await until(()=>h.hooks.generate.mock.calls.length===1);
    h.scheduler.submit('more slender');generation.resolve('umbrella mesh');await h.scheduler.whenIdle();
    expect(contexts[1].target).toEqual({form:null,object_en:'an umbrella'});
    expect(h.hooks.generate).toHaveBeenCalledTimes(1);expect(h.hooks.edit).not.toHaveBeenCalled();
    const [,installed]=h.hooks.install.mock.calls[0];
    expect(installed.target.object_en).toBe('an umbrella');
    expect(installed.attributes.elongation).toBe(1.6);expect(installed.attributes.count).toBe(2);
    expect(h.hooks.known).not.toHaveBeenCalled();expect(h.hooks.release).toHaveBeenCalledExactlyOnceWith('umbrella mesh');
  });

  it('does not starve generation or recolor earlier accepted text when later inputs keep the shape',async()=>{
    const generation=deferred<string>();
    const inks:{raw:string,ink:string}[]=[];
    const h=setup({accepted:e=>inks.push({raw:e.raw,ink:e.raw.includes('赤')?'red':e.raw.includes('青')?'blue':'white'}),route:async text=>text==='A'?newUnknown('a watering can'):keep,generate:()=>generation.promise});
    h.scheduler.submit('A');await until(()=>h.hooks.generate.mock.calls.length===1);
    for(const text of ['赤','青','今日は少し歩いた'])h.scheduler.submit(text);
    generation.resolve('can mesh');await h.scheduler.whenIdle();
    expect(h.hooks.install).toHaveBeenCalledTimes(1);expect(h.hooks.generate).toHaveBeenCalledTimes(1);
    expect(inks).toEqual([{raw:'A',ink:'white'},{raw:'赤',ink:'red'},{raw:'青',ink:'blue'},{raw:'今日は少し歩いた',ink:'white'}]);
    expect(h.hooks.accepted).toHaveBeenCalledTimes(4);
  });

  it.each(['route success','route error','generation success','generation error'] as const)('manual reset suppresses stale %s',async stage=>{
    const route=deferred<ShapeIntent>(),generation=deferred<string>();
    const isRoute=stage.startsWith('route');
    const h=setup({route:()=>isRoute?route.promise:Promise.resolve(newUnknown('a watering can')),generate:()=>generation.promise});
    h.scheduler.submit('old');await until(()=>isRoute?h.hooks.route.mock.calls.length===1:h.hooks.generate.mock.calls.length===1);
    h.scheduler.submit('queued old');
    h.scheduler.reset(contextFor({...DEFAULT_FORM,object:'tree'}));
    if(isRoute)stage.endsWith('error')?route.reject(new Error('stale error')):route.resolve(newKnown('vase'));
    else stage.endsWith('error')?generation.reject(new Error('stale error')):generation.resolve('stale mesh');
    await h.scheduler.whenIdle();
    expect(h.scheduler.current.target.form).toBe('tree');
    expect(h.scheduler.state).toMatchObject({pending:0,phase:'idle',error:'',canRetry:false});
    expect(h.hooks.install).not.toHaveBeenCalled();expect(h.hooks.known).not.toHaveBeenCalled();
    expect(h.scheduler.accepted.find(e=>e.raw==='queued old')?.state).toBe('cancelled');
    expect(h.received.map(e=>e.raw)).toEqual(['old','queued old']);
    if(stage==='generation success')expect(h.hooks.release).toHaveBeenCalledExactlyOnceWith('stale mesh');
  });

  it('supplies an invalidation guard that remains false during a delayed GLB parse after reset',async()=>{
    const parsed=deferred<void>();let installed=false;
    const h=setup({route:async()=>newUnknown('an umbrella'),install:async(_payload,_current,isCurrent)=>{await parsed.promise;installed=isCurrent();return installed;}});
    h.scheduler.submit('A');await until(()=>h.hooks.install.mock.calls.length===1);
    h.scheduler.reset(contextFor({...DEFAULT_FORM,object:'flower'}));parsed.resolve();await h.scheduler.whenIdle();
    expect(installed).toBe(false);expect(h.scheduler.current.target.form).toBe('flower');
    expect(h.hooks.release).toHaveBeenCalledExactlyOnceWith('mesh:an umbrella');
  });

  it('ignores a stale install exception after reset and releases that payload once',async()=>{
    const parsed=deferred<boolean>();
    const h=setup({route:async()=>newUnknown('an umbrella'),install:()=>parsed.promise});
    h.scheduler.submit('A');await until(()=>h.hooks.install.mock.calls.length===1);
    h.scheduler.reset(contextFor({...DEFAULT_FORM,object:'mushroom'}));
    parsed.reject(new Error('old malformed GLB'));await h.scheduler.whenIdle();
    expect(h.scheduler.current.target.form).toBe('mushroom');
    expect(h.scheduler.state).toMatchObject({error:'',canRetry:false,phase:'idle'});
    expect(h.hooks.release).toHaveBeenCalledExactlyOnceWith('mesh:an umbrella');
  });

  it('continues the FIFO after a route hook throws synchronously',async()=>{
    const h=setup({route:text=>{if(text==='bad')throw new Error('invalid response');return Promise.resolve(newKnown('vase'));}});
    h.scheduler.submit('bad');h.scheduler.submit('valid');await h.scheduler.whenIdle();
    expect(h.scheduler.accepted.map(e=>e.state)).toEqual(['failed','applied']);
    expect(h.scheduler.current.target.form).toBe('vase');
    expect(h.scheduler.state).toMatchObject({error:'',canRetry:false,phase:'idle'});
    expect(h.hooks.accepted).toHaveBeenCalledTimes(2);expect(h.maxActive).toBe(1);
  });

  it.each(['422','503','timeout','invalid JSON'] as const)('retains failed original input and retries %s without adding its glyphs twice',async reason=>{
    let attempts=0;
    const h=setup({route:async()=>{if(attempts++===0){if(reason==='invalid JSON')return validateIntent({action:'edit',target:null,changes:{count:99}});throw new Error(reason);}return newKnown('vase');}});
    const raw='  花瓶\n原文  ';h.scheduler.submit(raw);await h.scheduler.whenIdle();
    expect(h.scheduler.current.target.form).toBe('sphere');
    expect(h.scheduler.accepted[0]).toMatchObject({raw,state:'failed'});
    expect(h.scheduler.state.canRetry).toBe(true);
    expect(h.scheduler.retry()).toBe(true);expect(h.scheduler.retry()).toBe(false);await h.scheduler.whenIdle();
    expect(h.scheduler.current.target.form).toBe('vase');
    expect(h.hooks.accepted).toHaveBeenCalledTimes(1);expect(h.scheduler.accepted).toHaveLength(1);
    expect(h.scheduler.accepted[0]).toMatchObject({raw,state:'applied'});expect(h.scheduler.state.canRetry).toBe(false);
  });

  it.each(['generation','installation'] as const)('retries failed %s with current pending attributes and no duplicate text',async stage=>{
    let generationAttempts=0,installAttempts=0;
    const h=setup({route:async text=>text==='A'?newUnknown('an umbrella'):edit({twist:.7}),
      generate:async()=>{if(generationAttempts++===0&&stage==='generation')throw new Error('503');return `mesh ${generationAttempts}`;},
      install:async()=>{if(installAttempts++===0&&stage==='installation')throw new Error('invalid GLB');return true;}});
    h.scheduler.submit('A');await h.scheduler.whenIdle();
    expect(h.scheduler.state.canRetry).toBe(true);
    h.scheduler.submit('twist');await h.scheduler.whenIdle();
    expect(h.hooks.edit).not.toHaveBeenCalled();expect(h.scheduler.retry()).toBe(true);await h.scheduler.whenIdle();
    const last=h.hooks.install.mock.calls.at(-1)!;
    expect(last[1].attributes.twist).toBe(.7);expect(last[1].target.object_en).toBe('an umbrella');
    expect(h.hooks.accepted).toHaveBeenCalledTimes(2);expect(h.scheduler.accepted).toHaveLength(2);
    expect(h.scheduler.state.canRetry).toBe(false);
    expect(h.hooks.release.mock.calls.length).toBe(stage==='generation'?1:2);
  });

  it('retains only the latest waiting unknown target, while routing every accepted input in order',async()=>{
    const first=deferred<string>();
    const h=setup({route:async text=>newUnknown(text),generate:description=>description==='A'?first.promise:Promise.resolve(`mesh ${description}`)});
    h.scheduler.submit('A');await until(()=>h.hooks.generate.mock.calls.length===1);
    for(const text of ['B','C','D'])h.scheduler.submit(text);
    first.resolve('mesh A');await h.scheduler.whenIdle();
    expect(h.hooks.route.mock.calls.map(([raw])=>raw)).toEqual(['A','B','C','D']);
    expect(h.hooks.generate.mock.calls.map(([description])=>description)).toEqual(['A','D']);
    expect(h.hooks.install.mock.calls.map(([payload])=>payload)).toEqual(['mesh D']);
    expect(h.hooks.release.mock.calls.map(([payload])=>payload)).toEqual(['mesh A','mesh D']);
    expect(h.maxActive).toBe(1);expect(h.scheduler.accepted.every(e=>e.state==='applied')).toBe(true);
  });

  it('protects internal context from mutation by callers',async()=>{
    const h=setup();const returned=h.scheduler.current;returned.attributes.count=8;returned.target.form='vase';
    h.scheduler.submit('keep');await h.scheduler.whenIdle();
    expect(h.scheduler.current.attributes.count).toBe(1);expect(h.scheduler.current.target.form).toBe('sphere');
  });
});
