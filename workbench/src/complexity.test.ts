import {test,expect} from 'bun:test';
import {complexityOf,generationBrief,inspectComplexity,exportBudget} from './complexity';
import {compileIR,validateIR,solveIR} from './scene-ir';
import {validateRecipe} from './recipe';
import {evidenceSpans} from './grounding';
const plan={name:'测试',summary:'',requirements:[{id:'main',text:'红白灯塔',critical:true,weight:5}]};
function scene(n:number){return {name:'海岛站',entities:[{id:'floor',label:'地面',kind:'ground',role:'ground',position:[0,0,-.2],size:[24,24,.2],color:'#879376',accent:'#879376',rotation:0,requirementIds:[]},...Array.from({length:n},(_,i)=>({id:'asset'+i,label:'设施'+i,kind:['lighthouse','building','tree','lamp','crate'][i%5],role:i===0?'subject':'context',position:[-8+(i%5)*4,-8+Math.floor(i/5)*4,0],size:[1.5,1.5,2],color:'#916D50',accent:'#3F7660',rotation:0,requirementIds:i===0?['main']:[]}))],relations:[]};}
test('level defaults and enriched directions preserve the exact original input',()=>{
 expect(complexityOf(undefined)).toBe('simple');for(const x of [null,'__proto__','ultra',3])expect(()=>complexityOf(x)).toThrow();
 const prompt='只要一个红白灯塔，旁边两个箱子';for(const level of ['simple','medium','complex'] as const){const b=generationBrief(prompt,level);expect(b.originalPrompt).toBe(prompt);expect(b.preservation).toContain('不能删改');}
});
test('all three levels compile deterministic prefab assemblies with valid spatial support',()=>{
 for(const [level,n] of [['simple',4],['medium',10],['complex',20]] as const){const s=solveIR(validateIR(scene(n),plan)),recipe=validateRecipe(compileIR(s.ir),plan),r=inspectComplexity(s.ir,recipe,level);expect(s.structure.passed).toBe(true);expect(r.passed).toBe(true);expect(r.entityCount).toBe(n);expect(r.partCount).toBeGreaterThan(n);}
});
test('a complex label cannot pass a simple scene or repeated boxes',()=>{
 expect(inspectComplexity(scene(4),compileIR(scene(4)),'complex').passed).toBe(false);
 const repeated=scene(20);for(const e of repeated.entities.filter(e=>e.role!=='ground'))e.kind='box';expect(inspectComplexity(repeated,compileIR(repeated),'complex').passed).toBe(false);
 const counterfeit=scene(20);counterfeit.entities[1].role='ground';expect(()=>validateIR(counterfeit,plan)).toThrow();
 expect(inspectComplexity(scene(20),compileIR(scene(20)),'simple').passed).toBe(false);
});
test('semicolon joined evidence must still resolve to ordered literal prompt spans',()=>{
 const prompt='一个低多边形的红白灯塔立在岩石上。灯塔是画面主体。';
 expect(evidenceSpans('一个低多边形的红白灯塔；灯塔是画面主体',prompt)).toEqual(['一个低多边形的红白灯塔','灯塔是画面主体']);
 expect(()=>evidenceSpans('一个低多边形的蓝白灯塔；灯塔是画面主体',prompt)).toThrow();
 expect(()=>evidenceSpans('灯塔是画面主体；一个低多边形的红白灯塔',prompt)).toThrow();
 expect(evidenceSpans('“红白灯塔”以及“灯塔是画面主体”',prompt)).toEqual(['红白灯塔','灯塔是画面主体']);
 expect(()=>evidenceSpans('“红白灯塔”不得“灯塔是画面主体”',prompt)).toThrow();
 expect(()=>evidenceSpans('“蓝白灯塔”以及“灯塔是画面主体”',prompt)).toThrow();
});
test('optional props are separated without moving the subject or overriding explicit relations',()=>{
 const ir=scene(4);ir.entities[2].position=[...ir.entities[1].position];ir.entities[2].kind='crate';
 const solved=solveIR(ir);expect(solved.structure.passed).toBe(true);expect(solved.structure.layoutAdjustments.length).toBeGreaterThan(0);expect(solved.ir.entities[1]).toEqual(ir.entities[1]);expect(solveIR(solved.ir).ir).toEqual(solved.ir);
 ir.entities[2].requirementIds=['main'];expect(solveIR(ir).structure.passed).toBe(false);
 ir.entities[2].requirementIds=[];ir.relations=[{type:'around',subjects:['asset1'],target:'asset0',radius:0} as never];expect(solveIR(ir).structure.passed).toBe(false);
});

test('export resource budgets follow complexity while triangle and build ceilings remain fixed',()=>{
 const base={maxTriangles:20000,maxMaterials:16,consumerBuildMs:15000};
 expect(exportBudget('complex',base)).toEqual({maxTriangles:20000,maxMaterials:128,consumerBuildMs:15000});
 expect(exportBudget('simple',base).maxMaterials).toBe(32);expect(base.maxMaterials).toBe(16);
});
test('implicit grounding derives bottom height before resolving elevated support stacks',()=>{
 const ir=scene(3);ir.entities[1].kind='rock';ir.entities[1].size=[3,3,2];ir.entities[1].position[2]=1;
 ir.entities[2].position=[...ir.entities[1].position];ir.entities[2].kind='lighthouse';
 ir.relations=[{type:'on',subjects:['asset1'],target:'asset0'} as never];
 const result=solveIR(ir);expect(result.ir.entities[1].position).toEqual([-8,-8,0]);expect(result.ir.entities[2].position).toEqual([-8,-8,2]);expect(result.structure.passed).toBe(true);expect(result.structure.layoutAdjustments[0].reason).toContain('默认地面');
});

test('reference guidance is frozen without adding invented user requirements or changing budgets',()=>{
 const original='一个红白灯塔旁边一个蓝色平台';
 const a=generationBrief(original,'simple'),b=generationBrief(original,'complex');
 expect(b.language).toBe('zh-CN');expect(b.engine).toBe('ForgeaX Engine');expect(b.reference.sha256).toBe('11fd449997884f46438a5ad05e1b6ebca5b71bfc2002d86a1239609c7636545b');
 expect(a.originalPrompt).toBe(original);expect(b.originalPrompt).toBe(original);
 expect(a.budget.nonGroundEntities).toEqual([1,8]);expect(b.budget.nonGroundEntities).toEqual([17,28]);
 expect(b.planningMethod.zones).toContain('至少三个');expect(b.planningMethod.evidence).toContain('不是用户关键需求');
});
