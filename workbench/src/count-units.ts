/** Defines the authored counting unit, never whether an object is visible in a frame. */
export function countUnitDefinitions(scene:any,semanticCounts:Record<string,number>){
 const kinds=Object.keys(semanticCounts).filter(k=>semanticCounts[k]>0);
 if(!scene?.program?.instances||!Array.isArray(scene.entities))return [];
 const instances=new Map<string,any>(scene.program.instances.map((i:any)=>[i.id,i]));
 return kinds.map(kind=>({kind,units:scene.entities.filter((e:any)=>e.category===kind).map((e:any)=>{
  const instance=instances.get(e.instanceId);if(!instance)throw Error('计数单位没有对应实例：'+e.instanceId);
  return {instanceId:instance.id,label:instance.label};
 })}));
}
export const COUNT_UNIT_GUIDANCE='countUnits只定义分类和计数单位，不是可见性证明或标准答案。每个units条目是一个组合实例：其多块墙面、杆件、螺栓等内部部件不拆成额外对象；两个不同条目即使相接也不随意合并。依据全部实际截图独立给出visibleMin/visibleMax并说明遮挡或缺失；不能直接复制units长度，也不能把完全看不见的实例判为可见。参考或冻结需求明确指定数量时仍独立核对，额外或重复的可见对象照常计入，不能因为不在units清单中就忽略。';
