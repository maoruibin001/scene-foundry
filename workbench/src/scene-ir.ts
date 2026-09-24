import {inspectGeometry,supportTop} from './spatial';
export const IR_INSTRUCTIONS=`只返回简洁 JSON，不生成代码。使用语义实体规划静态低模场景，由固定编译器导出当前 ForgeaX Engine 资产。
结构为 {name,entities:[{id,label,kind,role,position:[x,y,z],size:[w,d,h],color:'#RRGGBB',accent:'#RRGGBB',rotation:number,requirementIds:string[]}],relations:[{type:'around'|'on'|'leftOf'|'rightOf',subjects:string[],target:string,radius?:number,gap?:number}]}。
坐标为 Z 向上，position 是底面中心，size 是宽、深、高。名称及标签使用中文，ID 保留接口允许的字母数字。类型仅有 potted_plant、platform、lighthouse、rock、ground、box、sphere、frustum、building、tree、lamp、crate。role 仅为 subject/context/ground。
盆栽包含盆、盆沿、土、根、树干、分枝和宽叶，color 是盆色，accent 是叶色。平台包含台面、支撑、栏杆和警示端帽；灯塔包含塔身、塔顶和入口；建筑为含屋顶、门窗的小屋；树含干和块状树冠；路灯含底座、杆和灯；箱子含对比色边框。它们都是完整预制构件，不要额外叠屋顶或叶片凑数量。
ID 唯一。requirementIds 只可引用 plan.requirements 的 ID，不能引用规范 S01–S14；可选设计用空数组。最多 32 个实体含地面，并遵守所选档位的非地面实体预算。最多一个 ground 且 role 为 ground，其他类型必须为 subject/context。主要可辨实体标记为 subject。
先按 generationBrief 中的方法确定主体与锚点，再按功能分区、分配实体数量、布置大结构，最后布置必要配件。前中后景采用当前尺寸范围内的相对层次，不套用外部文档的米数。不得输出额外字段、代码或未实现的渲染器设置。
复杂场景要分成有意义的组群并留空隙；次要配件通常宽深 0.7–2、高 0.5–3，地面宽深最多 24，主体保持高大可读。不能用大量重复箱子凑数，也不能在狭小环带塞入大物件。总尺寸每分量 0.1..24，位置每分量 -20..20，旋转后底面仍要有足够间距。
地面顶面设为 z=0，position.z=-height。求解器默认让物体落地；每个架高物体都必须写显式 on 关系。on 保留水平偏移并把底面放到支撑面；平台支撑面是台面而非栏杆顶。整个底面必须包含在宿主支撑面中，不能浮空、重叠或用薄片叠地面掩盖结构问题。
以 relations 声明有依据的相对关系。around 的 radius 是中心距，须容纳主体与配件；如盆径约 5、总高约 10、平台宽约 3，可用约 6 的半径。只有参考依据足够时才使用 4–6 个平台，不把图片中不确定的数量当硬要求。
保留图片主要结构与文字明确修改，不虚构精确图片计数。使用可信块状轮廓与可区分的中深色，避免白地面上的近白物体。保留明确要求的尺寸、数量和关系，不缩小或遗漏主体。不得添加当前静态生成器未支持的角色、动画或交互。`;
export const KINDS=['potted_plant','platform','lighthouse','rock','ground','box','sphere','frustum','building','tree','lamp','crate'];
export function validateIR(ir:any,plan:any){
 if(!Array.isArray(ir?.entities)||!ir.entities.length||ir.entities.length>32||!Array.isArray(ir.relations))throw Error('语义场景需 1–32 个实体及关系数组');
 if(ir.entities.filter((e:any)=>e.kind==='ground').length>1||ir.entities.some((e:any)=>(e.kind==='ground')!==(e.role==='ground')))throw Error('仅允许一个 ground 地面；地面角色不能用于其他构件');
 const ids=new Set();for(const e of ir.entities){if(!/^[a-zA-Z][\w-]{0,55}$/.test(e.id)||ids.has(e.id)||!KINDS.includes(e.kind)||!['subject','context','ground'].includes(e.role))throw Error('非法语义实体');ids.add(e.id);
  for(const k of ['position','size'])if(!Array.isArray(e[k])||e[k].length!==3||e[k].some((x:any)=>!Number.isFinite(x)||Math.abs(x)>24)||(k==='size'&&e[k].some((x:number)=>x<.1)))throw Error('语义实体尺寸/位置无效');
  if(!/^#[\da-f]{6}$/i.test(e.color)||!/^#[\da-f]{6}$/i.test(e.accent)||!Number.isFinite(e.rotation)||!Array.isArray(e.requirementIds))throw Error('语义实体颜色、旋转或需求数组格式无效：'+e.id);const unknown=e.requirementIds.filter((id:string)=>!plan.requirements.some((r:any)=>r.id===id));if(unknown.length)throw Error('实体 '+e.id+' 引用了未知用户需求 '+unknown.join(',')+'；只允许 '+plan.requirements.map((r:any)=>r.id).join(',')+'。规范编号 S01–S14 不能放进 requirementIds。');
 }
 if(!ir.entities.some((e:any)=>e.role==='subject'))throw Error('缺少主体声明');
 for(const r of ir.relations){if(!['around','on','leftOf','rightOf'].includes(r.type)||!ids.has(r.target)||!Array.isArray(r.subjects)||!r.subjects.length||new Set(r.subjects).size!==r.subjects.length||r.subjects.some((id:string)=>!ids.has(id)||id===r.target))throw Error('关系引用无效');for(const k of ['radius','gap'])if(r[k]!==undefined&&(!Number.isFinite(r[k])||r[k]<0||r[k]>24))throw Error('关系参数无效');}
 return ir;
}
export function solveIR(input:any){const ir=structuredClone(input),map=new Map<string,any>(ir.entities.map((e:any)=>[e.id,e]));const checks:any[]=[],layoutAdjustments:any[]=[];
 // Non-ground supports move as one stack; floors constrain height, not horizontal placement.
 const support=new Map<string,string>();for(const r of ir.relations.filter((r:any)=>r.type==='on'))for(const id of r.subjects)if(map.get(r.target).kind!=='ground')support.set(id,r.target);
 const chain=(id:string)=>{const result=[id];while(support.has(id)){id=support.get(id)!;if(result.includes(id))throw Error('空间约束形成循环');result.push(id);}return result;};
 const shift=(id:string,x:number,y:number,target:string)=>{const e=map.get(id),dx=x-e.position[0],dy=y-e.position[1],anchors=new Set(chain(target)),lineage=chain(id);let group=id;for(const ancestor of lineage.slice(1)){if(anchors.has(ancestor))break;group=ancestor;}for(const p of ir.entities)if(chain(p.id).includes(group)){p.position[0]+=dx;p.position[1]+=dy;}};
 const done=new Set<string>();const active=new Set<string>();const place=(id:string)=>{if(done.has(id))return;if(active.has(id))throw Error('空间约束形成循环');active.add(id);const entity=map.get(id),floor=ir.entities.find((e:any)=>e.role==='ground');if(entity.role!=='ground'&&!ir.relations.some((r:any)=>r.type==='on'&&r.subjects.includes(id))){const z=floor?floor.position[2]+floor.size[2]:0;if(Math.abs(entity.position[2]-z)>.001){const before=[...entity.position];entity.position[2]=z;layoutAdjustments.push({id,before,after:[...entity.position],reason:'未声明其他支撑关系的实体按默认地面落地；尺寸与水平位置不变'});}}for(const r of ir.relations.filter((r:any)=>r.subjects.includes(id))){place(r.target);const t=map.get(r.target),e=map.get(id),i=r.subjects.indexOf(id);if(r.type==='around'){const angle=i/r.subjects.length*Math.PI*2+.35,rad=r.radius??Math.max(t.size[0],t.size[1])/2+Math.max(e.size[0],e.size[1])/2+1;shift(id,t.position[0]+Math.cos(angle)*rad,t.position[1]+Math.sin(angle)*rad,r.target);e.rotation=angle;}
 if(r.type==='on'){e.position[2]=supportTop(t);}
 if(r.type==='leftOf'||r.type==='rightOf')shift(id,t.position[0]+(r.type==='leftOf'?-1:1)*(t.size[0]/2+e.size[0]/2+(r.gap??.5)),e.position[1],r.target);
 }active.delete(id);done.add(id);};for(const e of ir.entities)place(e.id);
 for(const r of ir.relations)for(const id of r.subjects){const e=map.get(id),t=map.get(r.target);let pass=true;
 if(r.type==='around')pass=Math.hypot(e.position[0]-t.position[0],e.position[1]-t.position[1])>=Math.max(t.size[0],t.size[1])/2+Math.max(e.size[0],e.size[1])/2;
 if(r.type==='on')pass=Math.abs(e.position[2]-supportTop(t))<.001;
 if(r.type==='leftOf'||r.type==='rightOf')pass=(e.position[0]-t.position[0])*(r.type==='leftOf'?-1:1)>=t.size[0]/2+e.size[0]/2+(r.gap??.5)-.001;
 checks.push({type:r.type,subject:id,target:r.target,passed:pass});}
 // Only optional props with no horizontal relation or supported children may be nudged.
 // A finite nearest-first search checks the whole scene after every move.
 let geometry=inspectGeometry(ir,compileIR(ir));
 for(const e of ir.entities){
  if(e.role!=='context'||e.requirementIds.length||ir.relations.some((r:any)=>r.target===e.id||r.subjects.includes(e.id)&&r.type!=='on'))continue;
  if(!geometry.checks.some(c=>!c.passed&&['solidIntersection','support'].includes(c.type)&&(c.subject===e.id||c.target===e.id)))continue;
  const before=[...e.position];let moved=false;
  for(let distance=.25;distance<=3&&!moved;distance+=.25)for(let step=0;step<16;step++){
   const a=step*Math.PI/8;e.position=[before[0]+Math.cos(a)*distance,before[1]+Math.sin(a)*distance,before[2]];
   if(e.position.some((n:number)=>Math.abs(n)>24))continue;
   const candidate=inspectGeometry(ir,compileIR(ir));
   if(candidate.checks.some(c=>!c.passed&&(c.subject===e.id||c.target===e.id))||candidate.suspects.some(c=>c.subject===e.id||c.target===e.id))continue;
   geometry=candidate;layoutAdjustments.push({id:e.id,before,after:[...e.position],reason:'可选环境物体的确定性避让；保留主体、需求、数量、支撑与显式空间关系'});moved=true;break;
  }
  if(!moved)e.position=before;
 }
 geometry=inspectGeometry(ir,compileIR(ir));return {ir,structure:{passed:checks.every(x=>x.passed)&&geometry.passed,geometry,layoutAdjustments,checks:[...checks,...geometry.checks],semanticCounts:Object.fromEntries(KINDS.map(k=>[k,ir.entities.filter((e:any)=>e.kind===k).length]))}};
}
const linear=(x:number)=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
export function compileIR(ir:any){const materials:any[]=[],objects:any[]=[];
 const material=(id:string,color:string)=>{materials.push({id,color:[...color.slice(1).match(/../g)!.map(h=>linear(parseInt(h,16)/255)),1],roughness:.75,metallic:.05});return id;};
 for(const e of ir.entities){const [w,d,h]=e.size;const primary=material(e.id+'_color',e.color),accent=material(e.id+'_accent',e.accent);const plant=e.kind==='potted_plant';
 const soil=plant?material(e.id+'_soil','#493622'):primary,stem=plant?material(e.id+'_stem','#756044'):primary;
 const add=(key:string,shape:string,p:number[],s:number[],m:string,extra:any={})=>{const a=e.rotation,c=Math.cos(a),q=Math.sin(a);objects.push({id:e.id+'__'+key,label:e.label+' / '+key,entityId:e.id,role:e.role,requirementIds:e.requirementIds,shape,position:[e.position[0]+c*p[0]-q*p[1],e.position[1]+q*p[0]+c*p[1],e.position[2]+p[2]],size:s,rotation:a+(extra.rotation??0),material:m,...Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='rotation'))});};
 if(plant){
  add('pot','frustum',[0,0,0],[w,d,h*.27],primary,{radiusBottom:w*.38,radiusTop:w*.5,sides:12});
  add('rim','frustum',[0,0,h*.25],[w*1.05,d*1.05,h*.06],primary,{radiusBottom:w*.525,radiusTop:w*.525,sides:12});
  add('soil','frustum',[0,0,h*.308],[w*.94,d*.94,h*.015],soil,{radiusBottom:w*.47,radiusTop:w*.47,sides:12});
  add('trunk','frustum',[0,0,h*.32],[w*.2,w*.2,h*.55],stem,{radiusBottom:w*.10,radiusTop:w*.035,sides:8});
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2;add('root'+i,'box',[Math.cos(a)*w*.20,Math.sin(a)*w*.20,h*.325],[w*.42,w*.055,h*.022],stem,{rotation:a});const z=h*(.55+i*.055);add('leaf'+i,'leaf',[0,0,z],[w*.62,w*.24,h*.13],accent,{rotation:a+.5});}
 }else if(e.kind==='platform'){
  add('deck','box',[0,0,h*.35],[w,d,h*.07],primary);
  for(const x of [-1,1])for(const y of [-1,1]){add('post'+x+'_'+y,'box',[x*w*.38,y*d*.38,0],[w*.055,d*.07,h*.86],primary);add('cap'+x+'_'+y,'box',[x*w*.38,y*d*.38,h*.86],[w*.12,d*.14,h*.1],accent);}
  add('rail','box',[0,d*.38,h*.7],[w*.82,d*.05,h*.05],accent);
 }else if(e.kind==='lighthouse'){
  add('tower','frustum',[0,0,0],[w,d,h*.8],primary,{radiusBottom:w*.5,radiusTop:w*.33,sides:12});add('band','frustum',[0,0,h*.43],[w,d,h*.09],accent,{radiusBottom:w*.42,radiusTop:w*.4,sides:12});add('lantern','box',[0,0,h*.8],[w*.67,d*.67,h*.13],accent);add('roof','frustum',[0,0,h*.93],[w,d,h*.07],primary,{radiusBottom:w*.52,radiusTop:0,sides:12});add('door','box',[0,-d*.48,0],[w*.24,d*.08,h*.2],accent);
 }else if(e.kind==='building'){
  add('walls','box',[0,0,0],[w,d,h*.76],primary);
  add('roof','frustum',[0,0,h*.76],[w,d,h*.24],accent,{radiusBottom:Math.min(w,d)*.5,radiusTop:0,sides:4});
  add('door','box',[0,-d*.495,0],[w*.24,d*.03,h*.48],accent);
  for(const x of [-1,1])add('window'+x,'box',[x*w*.29,-d*.495,h*.43],[w*.17,d*.03,h*.18],accent);
 }else if(e.kind==='tree'){
  add('trunk','box',[0,0,0],[w*.18,d*.18,h*.6],primary);
  add('canopy','frustum',[0,0,h*.35],[w,d,h*.65],accent,{radiusBottom:Math.min(w,d)*.5,radiusTop:0,sides:7});
 }else if(e.kind==='lamp'){
  add('base','box',[0,0,0],[w,d,h*.08],primary);
  add('pole','box',[0,0,h*.08],[w*.18,d*.18,h*.78],primary);
  add('light','box',[0,0,h*.86],[w*.8,d*.8,h*.14],accent);
 }else if(e.kind==='crate'){
  add('body','box',[0,0,0],[w,d,h],primary);
  for(const x of [-1,1])add('brace'+x,'box',[x*w*.33,-d*.495,0],[w*.12,d*.03,h],accent);
 }else add('body',e.kind==='ground'?'box':e.kind==='rock'?'sphere':e.kind,[0,0,0],[w,d,h],primary,e.kind==='frustum'?{radiusBottom:w*.5,radiusTop:w*.3,sides:8}:{});
 }
 return {name:ir.name,materials,objects,semanticEntities:ir.entities,relations:ir.relations};
}
export function applyPatches(ir:any,patches:any[]){const next=structuredClone(ir);if(!Array.isArray(patches)||patches.length>8)throw Error('局部修改最多 8 项');for(const p of patches){const e=next.entities.find((e:any)=>e.id===p.id);if(!e||!['color','accent','size','position'].includes(p.field))throw Error('局部修改目标无效');e[p.field]=p.value;}return next;}
