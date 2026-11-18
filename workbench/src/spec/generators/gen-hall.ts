/**
 * GEN-HALL-01(规格化新增;叶资产 ENV-001..005、ENV-024):大厅结构骨架。局部原点在完成地面中心,宽沿 X、长沿局部 Z;
 * 规格 -Y(南墙入口)= 局部 +Z,规格 +Y(北墙远端工业门)= 局部 -Z。
 * 周边工字柱按柱距排布,长边檐梁连柱顶,横跨 X 的屋顶桁架(上下弦 + 竖杆 + 斜腹杆)落在柱线上,屋面板沿中脊留天窗带;
 * 墙板按柱间 × 分层拼成,留缝体现模块;视高一层每隔若干块换成检修板(凸起 + 角部螺栓);墙脚踢脚带。
 * 入口与远端门洞只留开口,门本身属于 GEN-ENTRY-01 / 远端门族。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';

export const GEN_HALL=defineGenerator({
 id:'GEN-HALL-01',label:'大厅结构骨架',assembly:true,
 params:{
  width:{type:'number',default:48,min:10,max:120},
  length:{type:'number',default:55,min:10,max:120},
  height:{type:'number',default:20,min:4,max:80},
  columnPitch:{type:'number',default:6,min:3,max:15},
  wallThickness:{type:'number',default:0.3,min:0.1,max:1.5},
  panelHeight:{type:'number',default:2.5,min:1,max:6},
  panelGap:{type:'number',default:0.03,min:0.005,max:0.2},
  inspectionEvery:{type:'int',default:3,min:0,max:20},
  trussDepth:{type:'number',default:1.6,min:0.4,max:4},
  skylightWidth:{type:'number',default:4,min:0,max:20},
  entryWidth:{type:'number',default:8,min:0,max:40},
  entryHeight:{type:'number',default:4.5,min:0,max:20},
  wallDetail:{type:'bool',default:true},
  farDoorWidth:{type:'number',default:8,min:0,max:40},
  farDoorHeight:{type:'number',default:6,min:0,max:20},
 },
 slots:['column','beam','roofTruss','roofDeck','wallPanel','inspectionPanel','panelBolt','skirting','skylight'],
 adapt(raw){const e=nums(raw.envelope,3);return e?{...raw,width:e[0],length:e[1],height:e[2]}:raw;},
 build(m:Model,p){
  const W=p.width,L=p.length,H=p.height,t=p.wallThickness,hw=W/2,hl=L/2,col=0.5;
  if(p.entryWidth>=W-2*p.columnPitch||p.farDoorWidth>=W-2*p.columnPitch)throw Error('GEN-HALL-01: 门洞宽度必须小于端墙除两端柱距外的宽度');
  if(Math.max(p.entryHeight,p.farDoorHeight)>=H-p.trussDepth)throw Error('GEN-HALL-01: 门洞高度必须低于桁架下弦');
  // 柱线:沿一条边均分,柱距不超过 columnPitch。
  const stations=(span:number)=>{const n=Math.max(1,Math.ceil(span/p.columnPitch));return Array.from({length:n+1},(_,i)=>-span/2+span*i/n);};
  const xs=stations(W),zs=stations(L),eave=H-p.trussDepth;
  const column=(x:number,z:number)=>{
   // 工字截面:两块翼缘 + 腹板,翼缘朝向室内。
   const inward=Math.abs(x)>=hw-1e-6?[-Math.sign(x),0]:[0,-Math.sign(z)],cx=x+inward[0]*col/2,cz=z+inward[1]*col/2;
   const along=inward[0]!==0?'z':'x',f=0.05,w=col;
   for(const s of [-1,1]){
    const off=s*(w/2-f/2);
    m.box({size:along==='z'?[f,eave,w]:[w,eave,f],center:[cx+(along==='z'?off:0),eave/2,cz+(along==='x'?off:0)],material:'column',label:'column-flange'});
   }
   m.box({size:along==='z'?[w-0.1,eave,0.04]:[0.04,eave,w-0.1],center:[cx,eave/2,cz],material:'column',label:'column-web'});
  };
  for(const x of xs)for(const z of [-hl,hl])column(x,z);
  for(const z of zs.slice(1,-1))for(const x of [-hw,hw])column(x,z);
  // 檐梁沿长边连接柱顶。
  for(const s of [-1,1])m.box({size:[0.4,0.7,L],center:[s*(hw-col/2),eave-0.35,0],material:'beam',label:'eave-beam'});
  for(const s of [-1,1])m.box({size:[W,0.7,0.4],center:[0,eave-0.35,s*(hl-col/2)],material:'beam',label:'end-beam'});
  // 屋顶桁架:每条柱线一榀,横跨 X;上下弦 + 竖杆 + 交替斜腹杆。
  const chord=0.22,bays=Math.max(4,Math.round(W/3));
  for(const z of zs){
   const zc=Math.abs(z)>=hl-1e-6?z-Math.sign(z)*col:z;
   m.box({size:[W,chord,chord],center:[0,eave+chord/2,zc],material:'roofTruss',label:'truss-bottom'});
   m.box({size:[W,chord,chord],center:[0,H-chord/2,zc],material:'roofTruss',label:'truss-top'});
   for(let i=0;i<=bays;i++){
    const x=-hw+W*i/bays;
    m.box({size:[0.12,p.trussDepth-2*chord,0.12],center:[x,(eave+H)/2,zc],material:'roofTruss',label:'truss-post'});
    if(i<bays){
     // 原语不带旋转:先沿 X 放好斜杆,再绕自身中心转到对角方向;标签逐根唯一,保证只转这一根。
     const dx=W/bays,dy=p.trussDepth-2*chord,len=Math.hypot(dx,dy),ang=Math.atan2(dy,dx)*180/Math.PI*(i%2?-1:1);
     const label=`truss-diagonal-${zc.toFixed(2)}-${i}`,center:[number,number,number]=[x+dx/2,(eave+H)/2,zc];
     m.box({size:[len,0.1,0.1],center,material:'roofTruss',label});
     m.rotate(sel.createdBy(label),'z',ang,center);
    }
   }
  }
  // 屋面板留出中脊天窗带;天窗是独立的薄板。
  const sky=p.skylightWidth,deck=(W-sky)/2;
  for(const s of [-1,1])m.box({size:[deck,0.15,L],center:[s*(sky/2+deck/2),H+0.075,0],material:'roofDeck',label:'roof-deck'});
  // 天窗:发光玻璃面 + 横向窗棂(每 1.5m)+ 两道纵向窗框,读作格栅玻璃而不是一条白带。
  if(sky>0){m.box({size:[sky,0.04,L],center:[0,H+0.02,0],material:'skylight',label:'skylight'});
   for(let z=-hl+0.75;z<hl;z+=1.5)m.box({size:[sky,0.12,0.1],center:[0,H-0.04,z],material:'roofTruss',label:'sky-mullion'});
   for(const s of [-1,0,1])m.box({size:[0.12,0.14,L],center:[s*sky/2,H-0.05,0],material:'roofTruss',label:'sky-rail'});}
  // 墙板:四面墙按柱间 × 分层;门洞区不铺板。板内表面在包络边界,厚度向外。
  const tiers=Math.max(1,Math.round(eave/p.panelHeight)),ph=eave/tiers,g=p.panelGap;
  const openings=[{z:hl,w:p.entryWidth,h:p.entryHeight},{z:-hl,w:p.farDoorWidth,h:p.farDoorHeight}];
  let panelIndex=0;
  const panel=(a0:number,a1:number,y0:number,y1:number,wall:'x'|'z',s:number)=>{
   const inspection=p.inspectionEvery>0&&y0<2.6&&y1>1&&(panelIndex++%p.inspectionEvery===0);
   const len=a1-a0-g,hgt=y1-y0-g,mid=(a0+a1)/2,yc=(y0+y1)/2,raise=inspection?0.04:0;
   const depth=t+raise,offset=s*((wall==='x'?hw:hl)+t/2-raise/2);
   m.box({size:wall==='x'?[depth,hgt,len]:[len,hgt,depth],center:wall==='x'?[offset,yc,mid]:[mid,yc,offset],material:inspection?'inspectionPanel':'wallPanel',label:inspection?'inspection-panel':'wall-panel'});
   if(inspection)for(const da of [-1,1])for(const dy of [-1,1]){
    const a=mid+da*(len/2-0.12),y=yc+dy*(hgt/2-0.12),face=s*((wall==='x'?hw:hl)-raise-0.012);
    m.box({size:wall==='x'?[0.025,0.06,0.06]:[0.06,0.06,0.025],center:wall==='x'?[face,y,a]:[a,y,face],material:'panelBolt',label:'panel-bolt'});
   }
  };
  for(const s of [-1,1])for(let i=0;i<zs.length-1;i++)for(let k=0;k<tiers;k++)panel(zs[i],zs[i+1],k*ph,(k+1)*ph,'x',s);
  for(const o of openings){
   const s=Math.sign(o.z);
   for(let i=0;i<xs.length-1;i++)for(let k=0;k<tiers;k++){
    const a0=xs[i],a1=xs[i+1],y0=k*ph,y1=(k+1)*ph;
    if(y0>=o.h||a1<=-o.w/2||a0>=o.w/2){panel(a0,a1,y0,y1,'z',s);continue;}
    // 与门洞相交的板裁成门洞两侧与上方的部分。
    if(a0<-o.w/2)panel(a0,-o.w/2,y0,y1,'z',s);
    if(a1>o.w/2)panel(o.w/2,a1,y0,y1,'z',s);
    if(y1>o.h)panel(Math.max(a0,-o.w/2),Math.min(a1,o.w/2),o.h,y1,'z',s);
   }
  }
  // 墙面细节:每层墙板分界处一道外凸檩条,每个柱间一根贴墙小立管,打破大面积平板(门洞处不加)。
  if(p.wallDetail){
   for(let k=1;k<tiers;k++){const y=k*ph;
    for(const s of [-1,1])m.box({size:[0.12,0.18,L-2*col],center:[s*(hw-0.06),y,0],material:'beam',label:'girt'});
    for(const o of openings){const s=Math.sign(o.z);if(y<o.h+0.2){const seg=hw-o.w/2-col;for(const side of [-1,1])m.box({size:[seg,0.18,0.12],center:[side*(o.w/2+seg/2),y,s*(hl-0.06)],material:'beam',label:'girt'});}else m.box({size:[W-2*col,0.18,0.12],center:[0,y,s*(hl-0.06)],material:'beam',label:'girt'});}
   }
   for(let i=0;i+1<zs.length;i++){const z=(zs[i]+zs[i+1])/2+0.8;for(const s of [-1,1])m.cylinder({radiusTop:0.07,radiusBottom:0.07,height:eave-0.4,radialSegments:8,center:[s*(hw-0.12),eave/2,z],material:'panelBolt',label:'riser'});}
  }
  // 踢脚带贴墙内侧,门洞处断开。
  const sk=0.3,sd=0.06;
  for(const s of [-1,1])m.box({size:[sd,sk,L-2*col],center:[s*(hw-sd/2),sk/2,0],material:'skirting',label:'skirting'});
  for(const o of openings){
   const s=Math.sign(o.z),seg=(hw-o.w/2-col);
   for(const side of [-1,1])m.box({size:[seg,sk,sd],center:[side*(o.w/2+seg/2),sk/2,s*(hl-sd/2)],material:'skirting',label:'skirting'});
  }
 },
});
