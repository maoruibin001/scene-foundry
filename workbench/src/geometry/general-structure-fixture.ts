const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const box=(id:string,size:number[],position:number[])=>({...pose,id,position,shape:{type:'box',size,radius:0}});
export function generalStructureFixture(){
 const groups=[
  {templateId:'furniture',parts:[box('seat',[1.4,1.2,.15],[0,0,1]),box('left_leg',[.15,1,.9],[-.5,0,.45]),box('right_leg',[.15,1,.9],[.5,0,.45]),box('back',[1.4,.12,1],[0,.5,1.5])]},
  {templateId:'frame',parts:[box('left_post',[.2,.3,2.4],[-.8,0,1.2]),box('right_post',[.2,.3,2.4],[.8,0,1.2]),box('lintel',[1.8,.3,.2],[0,0,2.5])]},
  {templateId:'organic',parts:[{...pose,id:'connected',position:[0,0,1.2],shape:{type:'branchCrown',size:[1.4,1.4,2],habit:'spreading',stems:3,leafPairs:4,leafLength:.2,leafWidth:.6,curl:.1,seed:12,segments:2,layer:'whole'}}]},
 ];
 const space:any={program:{version:'geometry-v1',name:'通用结构控制',templates:groups.map(g=>({id:g.templateId,label:g.templateId,maxParts:8,materialIds:['blockout'],bounds:{min:[-1,-1,0],max:[1,1,3]}})),instances:groups.map((g,n)=>({...pose,id:'i'+n,label:g.templateId,template:g.templateId,position:[n*3,0,0],requirementIds:[]}))},spatialOpenings:[],spatialContacts:[]};
 const source={program:{...space.program,materials:[{id:'blockout',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:groups.map(g=>({id:g.templateId,parts:[{...box('proxy',[1.8,1.5,2.8],[0,0,1.5]),material:'blockout'}]}))}};
 return {space,source,groups};
}
