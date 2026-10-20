import {test,expect} from 'bun:test';
import {relationInstanceScale} from './relation-instance-scale';

const pose={rotation:[0,0,0],scale:[1,1,1]};
// Canal c332341f: three canal_house instances 7 m apart along the view, each 7 m deep and the same height, read as one continuous wall.
function canal(scales:number[][]=[[1,1,1],[1,1,1],[.9,.96,1]]):any{
 const house=(id:string,y:number,scale:number[])=>({...pose,scale,id,label:id,template:'canal_house',position:[-7.8,y,0],requirementIds:[]});
 return {program:{version:'geometry-v1',name:'运河',materials:[{id:'blockout',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],
  templates:[{id:'canal_house',parts:[{...pose,position:[0,0,3.85],id:'body',material:'blockout',shape:{type:'box',size:[5,7,7.7],radius:0}}]}],
  instances:[house('house_left_near',1.5,scales[0]),house('house_left_middle',8.5,scales[1]),house('house_left_bridge',15.5,scales[2])]},
  cameras:[{name:'参考',referenceIndex:0,position:[0,-12,3],target:[0,20,3],fov:1}],
  observedBindings:[{landmarkId:'left_houses',instanceIds:['house_left_near','house_left_middle','house_left_bridge']}]};
}
const observation={landmarks:[{id:'left_houses',views:[{referenceIndex:0,box:[0,.2,.4,.8]}]}],
 relations:[{id:'rel_housing_layers',critical:true,description:'近景民居较大，向桥后逐渐减小',landmarkIds:['left_houses']},{id:'rel_canal_depth',critical:false,landmarkIds:['left_houses']}]};
const review={relations:[{id:'rel_housing_layers',score:2.5},{id:'rel_canal_depth',score:3}]};

test('a failed relation lists each bound instance and flags equal heights that touch into one wall',()=>{
 const report=relationInstanceScale(canal(),observation,review)!;
 expect(report.relations.map((r:any)=>r.relationId)).toEqual(['rel_housing_layers']);
 const view=report.relations[0].views[0];
 expect(view.instances.map((i:any)=>i.instanceId)).toEqual(['house_left_near','house_left_middle','house_left_bridge']);
 expect(view.instances.every((i:any)=>i.worldSize[2]===7.7)).toBe(true);
 expect(view.instances[0].depth).toBeLessThan(view.instances[2].depth);
 expect(view.flags.map((f:any)=>f.kind)).toEqual(['uniformHeight','contiguous']);
 expect(view.flags[1].pairs).toEqual([['house_left_near','house_left_middle'],['house_left_middle','house_left_bridge']]);
});

test('stepped, separated instances raise no flag; a passed review produces no report',()=>{
 const s=canal([[1,.8,1],[.8,.8,.75],[.6,.8,.55]]);
 expect(relationInstanceScale(s,observation,review)!.relations[0].views[0].flags).toEqual([]);
 expect(relationInstanceScale(canal(),observation,{relations:[{id:'rel_housing_layers',score:3}]})).toBeNull();
});

test('a farther uncut instance drawn at least as tall as a nearer one is flagged',()=>{
 const s=canal([[.5,.5,.4],[1,.5,1],[2,.5,2]]);
 s.program.instances[0].position=[-7.8,10,0];
 const flags=relationInstanceScale(s,observation,review)!.relations[0].views[0].flags;
 expect(flags.find((f:any)=>f.kind==='fartherNotSmaller')?.pairs.length).toBeGreaterThan(0);
});

test('thin level surfaces such as water tiles are listed but never flagged',()=>{
 const s=canal();s.program.templates[0].parts[0].shape.size=[6,14,.03];
 const view=relationInstanceScale(s,observation,review)!.relations[0].views[0];
 expect(view.instances.length).toBe(3);expect(view.flags).toEqual([]);
});
