import {externalProviderBlock} from './provider-external-block';
/** One provider admission window shared by all scenes in this coordinator. */
export function rateLimitDelay(error:unknown,attempt=0,now=Date.now()):number|null {
 const s=String(error);
 if(externalProviderBlock(error)||/MODEL_BUDGET_EXHAUSTED/i.test(s)||!/PROVIDER_HTTP_429|rate[ _-]?limit|too many requests|tokens? per min/i.test(s))return null;
 const ms=s.match(/retry[-_ ]after[-_ ]ms\s*[:=]\s*(\d+(?:\.\d+)?)/i);
 const seconds=s.match(/(?:retry[-_ ]after|try again in|retry in)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)?/i);
 const date=s.match(/retry-after:\s*([^\n]+)/i);
 const explicit=ms?Number(ms[1]):seconds?Number(seconds[1])*1000:date?Date.parse(date[1])-now:NaN;
 // Azure TPM errors often omit Retry-After. Allow the token window to refill.
 return Math.max(1000,Number.isFinite(explicit)?explicit:60000*2**Math.min(attempt,3));
}

export class ProviderPressure {
 until=0;ceiling=Infinity;healthy=0;epoch=0;events=0;
 constructor(readonly now=Date.now,readonly changed:(state:ReturnType<ProviderPressure['snapshot']>)=>void=()=>{}){}
 capacity(configured:number){return this.now()<this.until?0:Math.min(configured,this.ceiling);}
 limited(error:unknown,configured:number){
  const delay=rateLimitDelay(error,0,this.now());if(delay===null)return false;
  // Several responses from one in-flight wave count as one reduction.
  if(this.now()>=this.until)this.ceiling=Math.max(1,Math.floor(Math.min(configured,this.ceiling)/2));
  this.until=Math.max(this.until,this.now()+delay);this.healthy=0;this.epoch++;this.events++;
  this.changed(this.snapshot(configured));return true;
 }
 succeeded(dispatchEpoch:number,configured:number){
  if(dispatchEpoch!==this.epoch||this.now()<this.until||!Number.isFinite(this.ceiling))return;
  if(++this.healthy>=4){this.healthy=0;this.ceiling=Math.min(configured,this.ceiling+1);if(this.ceiling>=configured)this.ceiling=Infinity;this.changed(this.snapshot(configured));}
 }
 snapshot(configured=8){return {version:'provider-pressure-v1',cooldownUntil:this.until,effectiveLimit:this.capacity(configured),ceiling:Number.isFinite(this.ceiling)?this.ceiling:null,events:this.events,healthyCompletions:this.healthy};}
}
