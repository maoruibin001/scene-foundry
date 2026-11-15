import type {Generator,ParamValue,AdaptContext} from './generators/kit';
/** Explicit dimensional aliases, never a guessed replacement for an unsupported shape. */
export function bindDimensionalAliases(gen:Generator,raw:Record<string,ParamValue>,ctx:AdaptContext){
 const out={...(gen.adapt?gen.adapt(raw,ctx):raw)},derived:{key:string;value:ParamValue}[]=[];
 const bind=(key:string,value:ParamValue)=>{if(out[key]!==undefined&&JSON.stringify(out[key])!==JSON.stringify(value))return false;out[key]=value;derived.push({key,value});return true;};
 const dims=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)?v as number[]:null;
 const apply=(v:number[])=>{
  if(gen.params.size?.type==='vec3')return bind('size',v);
  if('diameter' in gen.params&&v.every(n=>n===v[0])&&v[0]>0)return bind('diameter',v[0]);
  const keys=['width','length' in gen.params?'length':'depth','height'];
  if(!keys.slice(0,2).every(k=>k in gen.params))return false;
  if(v.some((n,i)=>n>0&&!(keys[i] in gen.params)))return false;
  if(v.some((n,i)=>n>0&&out[keys[i]]!==undefined&&out[keys[i]]!==n))return false;
  for(let i=0;i<3;i++)if(v[i]>0)bind(keys[i],v[i]);return true;
 };
 const size=dims(raw.size);
 if(size&&apply(size)&&!('size' in gen.params))delete out.size;
 // Only a pure dimension expression is an alias. Descriptions, orientations and paths remain unresolved.
 if(typeof raw.envelope==='string'&&/^\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*$/.test(raw.envelope)){
  const v=raw.envelope.split(/[x×*]/).map(Number);if(apply(v))delete out.envelope;
 }
 return {values:out,derived};
}
