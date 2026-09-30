// Experimental scheduler. A renderer can accept writing immediately while the
// local inference stages run one at a time. Used by the separate writing preview.
import { applyIntent, type ShapeContext, type ShapeIntent } from './intent';

export interface AcceptedWriting { id:number; raw:string; state:'queued'|'interpreting'|'applied'|'failed'|'cancelled' }
export interface ContinuousState { pending:number; phase:'idle'|'interpreting'|'generating'|'installing'; error:string; canRetry:boolean; canRetryGeneration:boolean }
interface Hooks<T> {
  accepted(writing:AcceptedWriting):void;
  route(text:string,current:ShapeContext,writing:Readonly<AcceptedWriting>):Promise<ShapeIntent>;
  generate(description:string):Promise<T>;
  known(current:ShapeContext):void;
  edit(current:ShapeContext):void;
  install(payload:T,current:ShapeContext,isCurrent:()=>boolean):Promise<boolean>;
  invalidate():void;
  changed(state:ContinuousState):void;
  release?(payload:T):void;
}
type Job={epoch:number;revision:number;description:string};
type Failure={kind:'route';entry:AcceptedWriting;epoch:number;revision:number}|{kind:'generation';job:Job};

export class ContinuousInput<T> {
  readonly accepted:AcceptedWriting[]=[];
  private context:ShapeContext;
  private queue:AcceptedWriting[]=[];
  private nextId=0;
  private epoch=0;
  private revision=0;
  private shownRevision=0;
  private wanted?:Job;
  private ready?:{job:Job;payload:T};
  private failure?:Failure;
  private generationFailure?:{job:Job;error:string};
  private error='';
  private phase:ContinuousState['phase']='idle';
  private worker?:Promise<void>;
  constructor(current:ShapeContext,private hooks:Hooks<T>,readonly limit=8) {
    if(!Number.isInteger(limit)||limit<1||limit>32)throw new Error('待機数は1から32の整数です。');
    this.context=structuredClone(current);
  }
  get current() { return structuredClone(this.context); }
  get state():ContinuousState {
    const valid=this.failure?.kind==='route'?this.failure.epoch===this.epoch&&this.failure.revision===this.revision:this.failure?.kind==='generation'&&this.matches(this.failure.job);
    const generationValid=Boolean(this.generationFailure&&this.matches(this.generationFailure.job));
    const generationError=generationValid?this.generationFailure!.error:'';
    const error=[...new Set([this.error,generationError].filter(Boolean))].join('\n');
    return {pending:this.queue.length,phase:this.phase,error,canRetry:Boolean(valid),canRetryGeneration:generationValid&&this.failure?.kind!=='generation'};
  }
  submit(raw:string):boolean {
    if(!raw.trim()||this.queue.length>=this.limit)return false;
    const entry:AcceptedWriting={id:++this.nextId,raw,state:'queued'};
    // Hooks may reject an over-capacity glyph input before any queue mutation.
    this.hooks.accepted({...entry});
    this.accepted.push(entry);this.queue.push(entry);this.emit();this.start();return true;
  }
  reset(current:ShapeContext) {
    this.epoch++;this.revision++;this.shownRevision=this.revision;
    for(const entry of this.queue)entry.state='cancelled';
    this.queue=[];this.context=structuredClone(current);this.wanted=undefined;
    this.discardReady();this.failure=undefined;this.generationFailure=undefined;this.error='';this.hooks.invalidate();this.emit();
  }
  retry():boolean {
    if(!this.state.canRetry||this.queue.length>=this.limit)return false;
    const failure=this.failure!;this.failure=undefined;this.error='';
    if(failure.kind==='route'){failure.entry.state='queued';this.queue.push(failure.entry);}
    else {this.wanted={...failure.job};this.generationFailure=undefined;}
    this.emit();this.start();return true;
  }
  retryGeneration():boolean {
    if(!this.state.canRetryGeneration)return false;
    this.wanted={...this.generationFailure!.job};this.generationFailure=undefined;
    this.emit();this.start();return true;
  }
  async whenIdle() { while(this.worker)await this.worker; }
  private matches(job:Job) { return job.epoch===this.epoch&&job.revision===this.revision; }
  private failedGeneration(job:Job,error:unknown) {
    const message=String(error instanceof Error?error.message:error);
    this.generationFailure={job,error:message};
    // A later command may have its own failure. Keep both retry paths available.
    if(this.failure?.kind!=='route'){this.failure={kind:'generation',job};this.error=message;}
  }
  private emit() { this.hooks.changed(this.state); }
  private discardReady() { if(this.ready)this.hooks.release?.(this.ready.payload);this.ready=undefined; }
  private start() {
    if(this.worker)return;
    // Delay the first hook until worker is assigned, including with sync throws.
    this.worker=Promise.resolve().then(()=>this.run()).finally(()=>{
      this.worker=undefined;this.phase='idle';this.emit();
      if(this.queue.length||this.wanted||this.ready)this.start();
    });
  }
  private async run() {
    while(this.queue.length||this.wanted||this.ready) {
      // Drain accepted writes before adopting a generated mesh. A trailing edit
      // uses the desired target, even while its mesh has not appeared yet.
      const entry=this.queue.shift();
      if(entry) {
        const epoch=this.epoch;
        entry.state='interpreting';this.phase='interpreting';this.emit();
        try {
          const intent=await this.hooks.route(entry.raw,this.current,Object.freeze({...entry}));
          if(epoch!==this.epoch){entry.state='cancelled';continue;}
          this.context=applyIntent(this.context,intent);
          if(intent.action==='new') {
            this.revision++;this.hooks.invalidate();this.discardReady();this.failure=undefined;this.generationFailure=undefined;this.error='';
            if(this.context.target.form) {
              this.wanted=undefined;this.hooks.known(this.current);this.shownRevision=this.revision;
            } else this.wanted={epoch,revision:this.revision,description:this.context.target.object_en};
          } else if(intent.action==='edit'&&this.shownRevision===this.revision) this.hooks.edit(this.current);
          entry.state='applied';
        } catch(error) {
          if(epoch!==this.epoch){entry.state='cancelled';continue;}
          entry.state='failed';this.failure={kind:'route',entry,epoch,revision:this.revision};this.error=String(error instanceof Error?error.message:error);
        }
        this.emit();continue;
      }
      if(this.ready) {
        const candidate=this.ready;this.ready=undefined;
        if(this.matches(candidate.job)) {
          this.phase='installing';this.emit();
          try {
            const applied=await this.hooks.install(candidate.payload,this.current,()=>this.matches(candidate.job));
            if(applied&&this.matches(candidate.job)){this.shownRevision=this.revision;this.generationFailure=undefined;}
          } catch(error) {
            if(this.matches(candidate.job))this.failedGeneration(candidate.job,error);
          }
        }
        this.hooks.release?.(candidate.payload);this.emit();continue;
      }
      if(this.wanted) {
        const job=this.wanted;this.wanted=undefined;this.phase='generating';this.emit();
        try {
          const payload=await this.hooks.generate(job.description);
          if(this.matches(job))this.ready={job,payload};
          else this.hooks.release?.(payload);
        } catch(error) {
          if(this.matches(job))this.failedGeneration(job,error);
        }
        this.emit();
      }
    }
  }
}
