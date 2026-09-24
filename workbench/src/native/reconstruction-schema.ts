const str={type:'string'},num={type:'number'};
const arr=(items:any)=>({type:'array',items});
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const choice=(...values:string[])=>({type:'string',enum:values});
const vector={type:'array',items:num,minItems:3,maxItems:3};
const rect={type:'array',items:num,minItems:4,maxItems:4};
export function resolveSupports(layout:any){
 const nodes=new Map<string,any>(layout.assets.map((a:any)=>[a.id,a])),done=new Set<string>(),visiting=new Set<string>();
 const place=(node:any)=>{if(done.has(node.id))return;if(visiting.has(node.id))throw Error('物件支撑关系存在环');visiting.add(node.id);if(node.support){const parent=nodes.get(node.support.assetId),p=node.support.localPosition;if(!parent||!Array.isArray(p)||p.length!==3||p.some((v:number)=>!Number.isFinite(v)||Math.abs(v)>1))throw Error('物件支撑关系无效：'+node.id);place(parent);const c=Math.cos(parent.rotation),s=Math.sin(parent.rotation),x=p[0]*parent.size[0],y=p[1]*parent.size[1];node.position=[parent.position[0]+c*x-s*y,parent.position[1]+s*x+c*y,parent.position[2]+p[2]*parent.size[2]];}visiting.delete(node.id);done.add(node.id);};
 for(const node of nodes.values())place(node);return layout;
}
export const OBSERVATION_SCHEMA=obj({interpretation:str,topology:arr(str),items:arr(obj({id:str,kind:choice('arch','staff_door','service_window','entrance','arcade','booth','pendant','fallen_lamp','round_table','chair','window'),description:str,reference1:rect,reference2:rect,confidence:num})),view1:str,view2:str});
export function validateObservations(v:any){if(!v||v.items?.length<8||v.items.length>20)throw Error('需要8至20个共享结构与物件');const ids=new Set();for(const i of v.items){if(ids.has(i.id))throw Error('物体ID重复');ids.add(i.id);for(const k of ['reference1','reference2'])if(!Array.isArray(i[k])||i[k].length!==4||i[k].some((x:number)=>!Number.isFinite(x)||x<0||x>1)||i[k][0]>i[k][2]||i[k][1]>i[k][3])throw Error('标注框无效');}return v;}
export const OBSERVATION_PROMPT=`只做双图可见内容的对应标注，不求三维坐标或相机参数，不设计几何。两张图是同一间废弃餐厅的不同方向照片。输出8至16个关键结构/物件：主砖拱、员工门、服务窗口、玻璃入口、街机、两到三组可对应卡座、两到三盏吊灯、桌上破灯罩、圆桌与木椅。每个物体一个稳定id，reference1/reference2是它在原始整幅图中的归一化矩形[x0,y0,x1,y1]；图片包括黑边，按完整图计算。完全不可见的物体用[0,0,0,0]，不能凭空指定框。部分遮挡时框住可见部分，并在description说明。尽量用共享物体而不是把同一物体在两图当成两个。
topology 用最多六条中文描述窗墙、入口墙、砖拱隔墙、服务口、卡座和街机之间的方向与邻接关系，说明哪些关系确定、哪些有歧义。view1/view2 各一句描述相机站在哪个区域、朝向什么。不要推算米制尺寸，不做渲染，不输出其他步骤。所有描述简洁中文，仅输出给定JSON。`;
export const RECONSTRUCTION_SCHEMA=obj({
 name:str,interpretation:str,assumptions:arr(str),
 architecture:arr(obj({id:str,kind:choice('wall','floor','ceiling'),label:str,position:vector,size:vector,rotation:num,material:choice('plaster','brick','wood','tile','carpet'),openings:arr(obj({id:str,kind:choice('window','door','arch','service'),offset:num,width:num,bottom:num,height:num,rise:num}))})),
 assets:arr(obj({id:str,kind:choice('booth_set','arcade','pendant','fallen_lamp','round_table','chair','picture','debris','kitchen_shelf','fallen_table','booth_end'),label:str,position:vector,size:vector,rotation:num,description:str})),
 cameras:arr(obj({id:str,referenceIndex:{type:'integer',enum:[1,2]},position:vector,target:vector,verticalFov:num,reason:str})),
 landmarks:arr(obj({id:str,referenceIndex:{type:'integer',enum:[1,2]},targetId:str,anchor:choice('center','bottom','top'),uv:{type:'array',items:num,minItems:2,maxItems:2},confidence:num,description:str})),
});
export function validateReconstruction(v:any){
 if(!v||!Array.isArray(v.architecture)||!Array.isArray(v.assets)||!Array.isArray(v.cameras)||!Array.isArray(v.landmarks))throw Error('缺少共同空间、资产、相机或可见锚点');
 if(v.architecture.length<5||v.architecture.length>60||v.assets.length<8||v.assets.length>100)throw Error('空间或资产数量不在允许范围');
 const ids=new Set<string>();
 const point=(x:any,label:string)=>{if(!Array.isArray(x)||x.length!==3||x.some(n=>!Number.isFinite(n)||Math.abs(n)>40))throw Error(label+' 必须是有限三维米制坐标');};
 for(const n of [...v.architecture,...v.assets]){
  if(!/^[a-z][a-z0-9_-]{1,63}$/.test(n.id)||ids.has(n.id))throw Error('无效或重复的空间标识：'+n.id);ids.add(n.id);
  point(n.position,n.id);point(n.size,n.id);if(n.size.some((x:number)=>x<=0))throw Error(n.id+' 尺寸必须大于零');
  if(!Number.isFinite(n.rotation))throw Error(n.id+' 旋转无效');
  for(const o of n.openings??[]){if(!/^[a-z][a-z0-9_-]{1,63}$/.test(o.id)||ids.has(o.id))throw Error('无效或重复的开口标识：'+o.id);ids.add(o.id);if([o.offset,o.width,o.bottom,o.height,o.rise].some(x=>!Number.isFinite(x))||o.width<=0||o.height<=0||o.bottom<0||o.rise<0||o.rise>o.height||Math.abs(o.offset)+o.width/2>n.size[0]/2+.001||o.bottom+o.height>n.size[2]+.001)throw Error(n.id+' 的开口超出墙体或尺寸无效：'+o.id);}
 }
 if(v.cameras.length!==2||new Set(v.cameras.map((c:any)=>c.referenceIndex)).size!==2)throw Error('两张参考图必须各有一个相机');
 for(const c of v.cameras){point(c.position,c.id);point(c.target,c.id);if(Math.hypot(...c.position.map((x:number,i:number)=>x-c.target[i]))<.1||c.verticalFov<.5||c.verticalFov>1.5)throw Error('相机朝向或视野无效');}
 if(v.landmarks.length<10)throw Error('至少需要十个有可见依据的跨视角锚点');
 for(const l of v.landmarks){if(!ids.has(l.targetId))throw Error('锚点引用了不存在的资产：'+l.targetId);if(l.uv.length!==2||l.uv.some((x:number)=>!Number.isFinite(x)||x<0||x>1)||l.confidence<0||l.confidence>1)throw Error('图像锚点超出范围');}
 return v;
}
export const RECONSTRUCTION_PROMPT=`根据两张用户原始参考图，重建同一个废弃餐厅的共同三维布局，供确定性的 ForgeaX 原生资产生成器执行。只输出结构化布局，不输出程序代码。
必须先判断两幅照片中共享物体的对应关系：街机、砖拱与服务口、门、桌面落下的彩玻璃灯罩、卡座、窗。两张图不能分别建立两个互不一致的房间。不能仅仅列齐资产类别。注意第二图桌布与灯罩在前景，街机在左侧中景，玻璃入口在远处，右侧有整片砖墙及服务窗口。第一图左侧员工门、砖柱和中右街机之间的位置及遮挡关系同样重要。
坐标是米制、Z 向上，采用一个自选但固定的世界坐标系。position 是每件物体的底面中心，size 是世界旋转前的宽、深、高。rotation 是绕 Z 的弧度。所有墙的局部宽沿 X、厚沿 Y、墙脚为局部 Z=0，朝向房内的一面为局部 -Y。用 rotation 旋转整面墙。不得为了单幅图好看而扭曲另一视角的共用布局。建筑应闭合，但可见范围外的精确尺寸明确标推断。
architecture 中 floor 是地板厚片，顶面是 position.z+size.z；ceiling 是木梁屋顶的整体包络，position.z 为最低梁底，size.z 为梁架厚度。wall 可以有多个 openings，offset 沿墙局部 X，width 是开口宽，bottom 为离墙脚高度，height 是开口总高；rise 仅用于 arch/service 的椭圆拱顶高度（其余为0）。开口必须完整落在墙体内，不能用多堵重合墙伪造开口。material=plaster 的墙自动有下部木护墙板，brick 墙使用砖材质。
assets 中 booth_set 是一张长方桌与它两侧面对面的卡座：默认桌长沿局部Y，两张卡座位于局部X两侧，size是包含两侧卡座的整体包络。给出每组独立位置，不将全部卡座合为一件。arcade 是完整街机，正面朝局部-Y；pendant 包含彩玻璃罩与从房顶垂下的吊链，position 是灯罩底边的高度，size只表示灯罩本体。fallen_lamp 是桌上或地面的残缺灯罩，不悬挂。fallen_table 为倾倒并接地的圆桌，booth_end 为近景独立卡座；round_table、chair、picture、debris 分别为圆桌、椅子、挂画、成组散物，挂画正面为局部-Y。关键物体不能被近景椅背或墙遮住。description 说明原图中可见的形状、磨损与配件要求，后续资产步骤需要执行它。
两个 cameras 分别对应原始第一张和第二张图，使用 position/target/verticalFov（垂直弧度）。原图含上下黑边，构图只对齐中间房间画面，不把水印和黑边当场景。landmarks 使用原始整张图归一化uv，u向右、v向下；明确给出每幅至少五个可辨物体或结构的中心/顶点/底部锚点，targetId必须来自architecture或assets，center/top/bottom需与几何位置一致。看不清的点降低confidence，不凭空补精确位置。
请认真对照两图再输出，所有名称、解释、推断与描述使用中文；字段和枚举遵守给定JSON Schema。`;
