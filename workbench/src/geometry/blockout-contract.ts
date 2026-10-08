import {validateCrown,CROWN_RULES} from './branch-crown';
import {geometryProgramSchema} from './program-schema';

export const BLOCKOUT_PART_LIMIT=8;
/** Local geometry depends on its brief and openings, not on world placement or camera. */
export function blockoutTemplateInput(space:any,brief:any){const ids=new Set(space.program.instances.filter(i=>i.template===brief.id).map(i=>i.id));return {contract:'local-graybox-v1',brief:{...brief,maxParts:Math.min(32,brief.maxParts),materialIds:['blockout']},spatialOpenings:(space.spatialOpenings??[]).filter(o=>ids.has(o.instanceId))};}
const types=new Set(['box','tube','lathe','extrusion','cushion','branchCrown']);
/** Wire contract for composition only. Finished assets keep the full geometry contract. */
export function compactBlockoutSchema(){
 const schema:any=structuredClone(geometryProgramSchema().properties.templates),part=schema.items.properties.parts.items;
 schema.items.properties.parts.minItems=1;schema.items.properties.parts.maxItems=BLOCKOUT_PART_LIMIT;
 for(const k of ['material','uvProjection','uvTransform','smoothAngle','uvScale'])delete part.properties[k];
 part.required=Object.keys(part.properties);
 part.properties.shape.anyOf=part.properties.shape.anyOf.filter((s:any)=>types.has(s.properties.type.enum[0]));
 for(const s of part.properties.shape.anyOf){
  if(s.properties.type.enum[0]==='branchCrown'){s.properties.segments={type:'integer',enum:[2]};s.properties.layer={type:'string',enum:['whole']};}
  else if(s.properties.segments)s.properties.segments.maximum=s.properties.type.enum[0]==='cushion'?8:12;
  for(const k of ['profile','outline'])if(s.properties[k])s.properties[k].maxItems=12;
 }
 return {type:'object',properties:{templates:schema},required:['templates'],additionalProperties:false};
}

export function assertBlockoutGeneration(value:any){
 if(!Array.isArray(value?.templates))throw Error('灰模需要templates数组');
 for(const t of value.templates){
  if(!Array.isArray(t.parts)||!t.parts.length||t.parts.length>BLOCKOUT_PART_LIMIT)throw Error(`灰模每模板仅允许1–${BLOCKOUT_PART_LIMIT}个轮廓部件；不制作逐叶或逐花细节`);
  for(const p of t.parts){
   const s=p.shape;
   if(!s||!types.has(s.type))throw Error('灰模仅允许box、tube、lathe、extrusion、cushion、branchCrown构造；详细资产阶段保留完整几何能力');
   if(s.type==='branchCrown'){validateCrown(s);if(s.segments!==2||s.layer!=='whole')throw Error('灰模枝冠须segments=2、layer=whole，保持与详细阶段同一结构');continue;}
   if(s.segments>(s.type==='cushion'?8:12)||(s.profile?.length??0)>12||(s.outline?.length??0)>12)throw Error('灰模轮廓最多12点/分段，cushion最多8分段；请保留大轮廓和通透开口');
  }
 }
 return value;
}

export function expandBlockoutGeometry(value:any){
 assertBlockoutGeneration(value);
 return {...value,templates:value.templates.map((t:any)=>({...t,parts:t.parts.map((p:any)=>({...p,material:'blockout',uvScale:[1,1],uvProjection:null,uvTransform:null,smoothAngle:null}))}))};
}

export const COMPACT_BLOCKOUT_RULES=CROWN_RULES+`
此阶段只构造共同空间中的大轮廓、占幅、通道和开口，每模板1–8个部件，不逐叶、逐花或逐砖建模。植物可用branchCrown在少量参数下表达真实连接枝冠、叶簇与空隙，简单植物也可用粗枝与数个冠体；不得把通道、门窗或冠体间空隙填成整块箱体。详细叶形、花瓣、UV、贴图和光照材质由后续资产阶段处理。
只输出id、position、rotation、scale、shape；系统统一附加灰材质和无纹理默认值。位置以米为单位，Z向上，旋转为依次XYZ的弧度；遵守brief的局部原点、bounds和朝向，实例和机位由系统处理。
box以中心为原点，size为宽深高，radius不可超过最短边的一半；tube连接from/to，radius/endRadius定义两端半径；lathe用最多12个[半径,高度]轮廓点绕Z旋转，arc/start的null表示完整圆周/0，闭合端应有半径0；extrusion用最多12点简单不自交XY轮廓沿+Z挤出depth；cushion以size定义封闭圆滑冠体，roundness=2..8、seamDepth=0、segments=4..8。旋转构造最多12分段，尺寸和scale须0.001..100。保留真实粗略轮廓，不用无关堆叠填满预算。`;
