import {geometryProgramSchema} from './program-schema';
import {validateAsset} from './layout';
import {stable} from '../validated-cache';
import {validateScene} from './scene-contract';
import {spatialInstances} from './spatial-order';
import {compactBlockoutSchema,assertBlockoutGeneration,expandBlockoutGeometry} from './blockout-contract';

export const GRAYBOX_PART_EDITS=24;
const fields=['templateId','partId','position','rotation','scale'];
const fail=(ok:any,message:string)=>{if(!ok)throw Error('灰模部件修正：'+message);};
const vector=(v:any)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function grayboxPartEditSchema(){
 const p=geometryProgramSchema().properties.templates.items.properties.parts.items.properties;
 const shape=compactBlockoutSchema().properties.templates.items.properties.parts.items.properties.shape;
 return {type:'array',maxItems:GRAYBOX_PART_EDITS,items:{type:'object',properties:{templateId:p.id,partId:p.id,position:p.position,rotation:p.rotation,scale:p.scale,shape:{anyOf:[...shape.anyOf,{type:'null'}]}},required:fields,additionalProperties:false}};
}

/** Existing identities, materials and budgets stay fixed; a few coarse contours may be replaced. */
export function applyGrayboxLocalParts(source:any,space:any,edits:any[],groups:any[]=[],generalGroups=true){
 fail(Array.isArray(edits)&&edits.length<=GRAYBOX_PART_EDITS,'部件编辑额度无效');
 const templates=structuredClone(source.program.templates),seen=new Set(),changed:string[]=[];
 fail(Array.isArray(groups)&&groups.length<=3,'组群重建最多3个已有模板');
 const groupIds=new Set<string>();
 for(const group of groups){
  fail(group&&Object.keys(group).length===2&&typeof group.templateId==='string'&&Array.isArray(group.parts),'组群需templateId与parts');
  fail(!groupIds.has(group.templateId),'组群模板重复');groupIds.add(group.templateId);
  const t=templates.find(t=>t.id===group.templateId);fail(t&&space.program.templates.some(t=>t.id===group.templateId),'组群只能重建已有模板');
  fail(!edits.some(e=>e.templateId===group.templateId),'组群与局部部件不能重复修改同一模板');
  if(!generalGroups)fail(group.parts.some(p=>p.shape?.type==='branchCrown'),'历史组群重建须有连接式branchCrown结构依据');
  const expanded=expandBlockoutGeometry({templates:[{id:group.templateId,parts:group.parts}]}).templates[0];
  if(stable(t.parts)!==stable(expanded.parts)){t.parts=expanded.parts;changed.push(group.templateId+'/*');}
 }
 fail(new Set(edits.map(e=>e?.templateId)).size<=4,'最多调整4个已有模板');
 const replacements=edits.filter(e=>e?.shape!=null);
 fail(replacements.length<=6&&new Set(replacements.map(e=>e.templateId)).size<=2,'轮廓替换最多2模板6部件；其余部件只调整姿态');
 for(const e of edits){
  fail(e&&(Object.keys(e).length===fields.length||Object.keys(e).length===fields.length+1)&&fields.every(k=>Object.hasOwn(e,k))&&Object.keys(e).every(k=>[...fields,'shape'].includes(k)),'只允许已有部件的姿态和有界粗轮廓，不能改身份、材质或预算');
  const key=e.templateId+'/'+e.partId;fail(!seen.has(key),'部件身份重复');seen.add(key);
  const ts=templates.filter(t=>t.id===e.templateId),bs=space.program.templates.filter(t=>t.id===e.templateId);
  fail(ts.length===1&&bs.length===1,'只能调整已有模板');
  const ps=ts[0].parts.filter(p=>p.id===e.partId);fail(ps.length===1,'只能调整已有部件');const p=ps[0],brief=bs[0];
  fail(['position','rotation','scale'].every(k=>vector(e[k])),'坐标必须为有限三元组');
  fail(e.scale.every((n,k)=>n>0&&n/p.scale[k]>=.5&&n/p.scale[k]<=2),'局部尺度须为来源的0.5至2倍');
  fail(e.rotation.every(n=>Math.abs(n)<=Math.PI*2),'局部旋转范围无效');
  fail(e.position.every((n,k)=>Math.abs(n-p.position[k])<=(brief.bounds.max[k]-brief.bounds.min[k])*.5),'局部位移不能超过冻结边界跨度的一半');
  if(e.shape!=null)assertBlockoutGeneration({templates:[{id:e.templateId,parts:[{...p,shape:e.shape}]}]});
  if(stable([p.position,p.rotation,p.scale,p.shape])!==stable([e.position,e.rotation,e.scale,e.shape??p.shape]))changed.push(key);
  for(const k of ['position','rotation','scale'])p[k]=structuredClone(e[k]);
  if(e.shape!=null)p.shape=structuredClone(e.shape);
 }
 for(const id of new Set(changed.map(k=>k.split('/')[0]))){
  const brief=space.program.templates.find(t=>t.id===id),template=templates.find(t=>t.id===id);
  // Use the final asset validator, including actual compiled bounds, openings and contact samples.
  validateAsset({version:'asset-geometry-v1',template},{...brief,maxParts:32,materialIds:['blockout']},{...space,program:{...space.program,materials:source.program.materials}},{});
 }
 return {templates,changed};
}

/** The normal gate must use exactly the reviewed geometry rather than regenerating old proxies. */
export function assertGrayboxPartHandoff(source:any,space:any,patch:any,scene:any){
 const expected=applyGrayboxLocalParts(source,space,patch.parts,patch.groups??[],patch.version==='graybox-space-repair-v5');
 if(stable(scene.program.templates)!==stable(expected.templates)||stable(scene.program.materials)!==stable(source.program.materials))throw Error('GRAYBOX_PREVIEW_GEOMETRY_FROZEN：实际几何必须与已有部件补丁完全一致');
 return expected;
}

export function buildGrayboxPartScene(source:any,space:any,patch:any,plan:any,referenceCount:number){
 const local=applyGrayboxLocalParts(source,space,patch.parts,patch.groups??[],patch.version==='graybox-space-repair-v5');
 return validateScene({...source,cameras:space.cameras,spatialContacts:space.spatialContacts,program:{...source.program,templates:local.templates,instances:spatialInstances(space.program.instances)}},plan,referenceCount);
}
