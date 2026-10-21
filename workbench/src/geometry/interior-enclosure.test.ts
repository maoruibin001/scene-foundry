import {test,expect} from 'bun:test';
import {enclosureVoids,withInteriorEnclosure,interiorEnclosureRule,INTERIOR_ENCLOSURE} from './interior-enclosure';

const pose={rotation:[0,0,0],scale:[1,1,1]};
const box=(id:string,size:number[])=>({id,parts:[{...pose,position:size.map(v=>v/2),id:'body',material:'blockout',shape:{type:'box',size,radius:0}}],bounds:{min:[0,0,0],max:size}});
// Workshop 64ed7618 in miniature: an 8×8 m room, walls on the -x and +y sides only, a ceiling, the camera looking back at the open -y side.
function room(walls=['west','north']){
 const t=[box('floor',[8,8,.2]),box('ceiling',[8,8,.2]),box('wall',[8,.3,4])];
 const instances:any[]=[{...pose,id:'floor',template:'floor',position:[0,0,-.2]},{...pose,id:'ceiling',template:'ceiling',position:[0,0,4]}];
 if(walls.includes('west'))instances.push({...pose,id:'west',template:'wall',position:[0,0,0],rotation:[0,0,Math.PI/2]});
 if(walls.includes('north'))instances.push({...pose,id:'north',template:'wall',position:[0,8,0]});
 if(walls.includes('east'))instances.push({...pose,id:'east',template:'wall',position:[8.3,0,0],rotation:[0,0,Math.PI/2]});
 if(walls.includes('south'))instances.push({...pose,id:'south',template:'wall',position:[0,-.3,0]});
 const program={version:'geometry-v1',name:'房间',materials:[{id:'blockout',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:t,instances:instances.map(i=>({...i,label:i.id,requirementIds:[]}))};
 const cameras=[{name:'参考',referenceIndex:1,position:[6,2,1.6],target:[2,6,1.2],fov:1},{name:'回望',referenceIndex:null,position:[4,6,1.6],target:[4,0,1.2],fov:1}];
 const entities=program.instances.map((i:any)=>({instanceId:i.id,role:['floor','ceiling'].includes(i.id)?'ground':'context',category:i.id==='floor'?'地面':i.id==='ceiling'?'顶面':'砖墙'}));
 return {scene:{program,cameras},space:{program,entities,cameras,assumptions:[],spatialOpenings:[]}};
}

test('a camera that looks out of the open side of a roofed room gets that side walled with the existing wall template',()=>{
 const {scene,space}=room(),before=JSON.stringify(space);
 const report=enclosureVoids(scene);
 expect(report.interior).toBe(true);expect(report.cameras[1].voidShare).toBeGreaterThan(.12);
 const closed=withInteriorEnclosure(space,scene);
 expect(closed.report.added.map((w:any)=>w.id)).toEqual(['enclosure_posx','enclosure_negy']);
 const wall=closed.space.program.instances.find((i:any)=>i.id==='enclosure_negy');
 expect(wall.template).toBe('wall');expect(closed.space.entities.find((e:any)=>e.instanceId==='enclosure_negy')).toEqual({instanceId:'enclosure_negy',role:'ground',category:'砖墙'});
 expect(enclosureVoids({...scene,program:closed.space.program}).cameras[1].voidShare).toBeLessThan(.02);
 expect(JSON.stringify(space)).toBe(before);
 // Running again on the closed space adds nothing.
 expect(withInteriorEnclosure(closed.space,{...scene,program:closed.space.program}).report.added).toEqual([]);
});

test('a window in an existing wall is an opening, not a missing side',()=>{
 const {scene,space}=room(['west','north','east','south']);
 // Cut the north wall into two piers with a 2 m gap between them; the camera looking north sees through it.
 const pier={...scene.program.templates[2],id:'pier',parts:[{...scene.program.templates[2].parts[0],position:[1.5,.15,2],shape:{type:'box',size:[3,.3,4],radius:0}}],bounds:{min:[0,0,0],max:[3,.3,4]}};
 const program={...scene.program,templates:[...scene.program.templates,pier],instances:[...scene.program.instances.filter((i:any)=>i.id!=='north'),{...pose,id:'pierL',label:'pierL',template:'pier',position:[0,8,0],requirementIds:[]},{...pose,id:'pierR',label:'pierR',template:'pier',position:[5,8,0],requirementIds:[]}]};
 const cameras=[scene.cameras[0],{...scene.cameras[1],position:[4,1,1.6],target:[4,9,1.4]}];
 const r=withInteriorEnclosure({...space,program,entities:[...space.entities.filter((e:any)=>e.instanceId!=='north'),{instanceId:'pierL',role:'context',category:'砖墙'},{instanceId:'pierR',role:'context',category:'砖墙'}]},{program,cameras});
 expect(r.report.cameras[1].faces['+y']).toBeGreaterThan(0);expect(r.report.covered['+y']).toBeGreaterThanOrEqual(.5);expect(r.report.added).toEqual([]);
});
test('a closed room and an unroofed scene are left unchanged; the policy is opt-in per job',()=>{
 const closedRoom=room(['west','north','east','south']);
 expect(withInteriorEnclosure(closedRoom.space,closedRoom.scene).report.added).toEqual([]);
 const open=room();open.scene.program.instances=open.scene.program.instances.filter((i:any)=>i.id!=='ceiling');
 const r=withInteriorEnclosure(open.space,open.scene);expect(r.report.interior).toBe(false);expect(r.space).toBe(open.space);
 expect(interiorEnclosureRule({grayboxEnclosurePolicy:INTERIOR_ENCLOSURE})).toBe(true);expect(interiorEnclosureRule({})).toBe(false);
});
