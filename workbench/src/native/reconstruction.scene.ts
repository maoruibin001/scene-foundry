import {addChild,emptyScene,sceneNode} from '@forgeax/scene';
import {MeshBuilder,type V} from './mesh';
import {placeNativeAsset} from './asset-library';
import {resolveTabletopItems} from './tabletop';
import {validateReconstruction,resolveSupports} from './reconstruction-schema';

// 所有世界坐标、开口、资产数量和两个相机均来自双图布局数据。
// 这里只定义可复用的构造方法，不针对截图分别摆两套场景。
export function openingTop(o:any,x:number){
 const spring=o.bottom+o.height-o.rise;
 return spring+o.rise*Math.sqrt(Math.max(0,1-((x-o.offset)/(o.width/2))**2));
}
export function architectureNode(g:MeshBuilder,n:any){g.at(n.id,n.position,n.rotation,()=>{
 const [w,d,h]=n.size;
 if(n.kind==='floor'){
  g.box('dark',[0,0,h/2-.025],[w,d,Math.max(.01,h-.05)]);
  g.floor(n.material,-w/2,-d/2,w/2,d/2,h,1.8);return;
 }
 if(n.kind==='ceiling'){
  if(n.material!=='wood'){g.box(n.material,[0,0,h/2],[w,d,h]);return;}
  g.box('roofWood',[0,0,h-.045],[w,d,.09]);
  for(let y=-d/2+.1;y<d/2;y+=.85)g.box('roofWood',[0,y,h-.16],[w,.12,.20]);
  for(let y=-d/2+1.3;y<d/2;y+=4.4)g.box('roofWood',[0,y,h*.35],[w,.24,h*.60]);
  for(let x=-w/2+.2;x<w/2;x+=2.8){g.box('roofWood',[x,0,h*.35],[.24,d,h*.60]);for(let y=-d/2+1.3;y<d/2;y+=4.4){g.tube('roofWood',[x,y,.01],[x+.65,y,h*.9],.09,.085,4);g.tube('roofWood',[x,y,.01],[x-.65,y,h*.9],.09,.085,4);}}
  return;
 }
 const openings=[...n.openings].sort((a,b)=>a.offset-b.offset);
 for(let i=1;i<openings.length;i++)if(openings[i-1].offset+openings[i-1].width/2>openings[i].offset-openings[i].width/2+.001)throw Error(n.id+' 开口互相重叠');
 const breaks=[-w/2,w/2];for(const o of openings){breaks.push(o.offset-o.width/2,o.offset+o.width/2);if(o.rise>0)for(let i=1;i<40;i++)breaks.push(o.offset+o.width/2*Math.cos(i/40*Math.PI));}
 const xs=[...new Set(breaks)].sort((a,b)=>a-b);
 const strip=(x0:number,x1:number,z0:number,z1:number,t0:number,t1:number)=>{
  if(x1-x0<1e-7||Math.max(t0-z0,t1-z1)<1e-7)return;
  const scale=n.material==='brick'?1.1:1.8,uv=[[x0/scale,1-z0/scale],[x1/scale,1-z1/scale],[x1/scale,1-t1/scale],[x0/scale,1-t0/scale]];
  g.quad(n.material,[[x0,-d/2,z0],[x1,-d/2,z1],[x1,-d/2,t1],[x0,-d/2,t0]],uv);
  g.quad(n.material,[[x0,d/2,z0],[x0,d/2,t0],[x1,d/2,t1],[x1,d/2,z1]],[uv[0],uv[3],uv[2],uv[1]]);
 };
 for(let i=0;i<xs.length-1;i++){
  const x0=xs[i],x1=xs[i+1],mid=(x0+x1)/2,o=openings.find(v=>Math.abs(mid-v.offset)<v.width/2);
  if(!o)strip(x0,x1,0,0,h,h);else{strip(x0,x1,0,0,o.bottom,o.bottom);strip(x0,x1,openingTop(o,x0),openingTop(o,x1),h,h);}
 }
 // 护墙板遵守真实门洞范围，不能把门下半部封住。
 if(n.material==='plaster')for(let x=-w/2;x<w/2-.01;x+=.19){const width=Math.min(.18,w/2-x),mid=x+width/2,o=openings.find(v=>Math.abs(mid-v.offset)<v.width/2),height=Math.min(1.18,o?o.bottom:h);if(height>.05){g.box('wood',[mid,-d/2-.022,height/2],[width,.045,height]);g.box('wood',[mid,-d/2-.052,height+.025],[width+.007,.10,.055]);}}
 // 墙体侧面闭合。
 for(const x of [-w/2,w/2])g.box(n.material,[x,0,h/2],[.015,d,h]);
 g.box(n.material,[0,0,h-.007],[w,d,.014]);
 for(const o of openings){
  const left=o.offset-o.width/2,right=o.offset+o.width/2,top=o.bottom+o.height;
  for(const x of [left,right])g.box(n.material,[x,0,(o.bottom+top-o.rise)/2],[.025,d,top-o.rise-o.bottom]);
  if(o.kind==='window'||o.kind==='door'){
   for(const x of [left,right])g.box('frame',[x,-d/2-.035,(o.bottom+top)/2],[.09,.16,o.height+.12]);
   for(const z of [o.bottom,top])g.box('frame',[o.offset,-d/2-.035,z],[o.width+.18,.18,.09]);
   if(o.kind==='window'){
    g.box('wood',[o.offset,-d/2-.11,o.bottom-.06],[o.width+.24,.34,.08]);
    const columns=Math.max(2,Math.round(o.width/.46)),rows=Math.max(3,Math.round(o.height/.45));
    for(let i=1;i<columns;i++)g.box('frame',[left+o.width*i/columns,-d/2-.045,(o.bottom+top)/2],[.030,.09,o.height]);
    for(let i=1;i<rows;i++)g.box('frame',[o.offset,-d/2-.05,o.bottom+o.height*i/rows],[o.width,.09,.024]);
    // 脏玻璃与远景作为窗面材质；屋外具体三维结构仍属于未验证的推断区域。
    g.quad('windowView',[[left,d/2+.012,o.bottom],[right,d/2+.012,o.bottom],[right,d/2+.012,top],[left,d/2+.012,top]]);
   }
   if(o.kind==='door'&&o.id==='staff_door_01'){
    // 门扇有厚度并绕真实门轴转入后厨；标牌文字来自原图，非 UI 提示。
    const angle=-1.1,cy=-d/2-o.width/2*Math.sin(angle),cx=right-o.width/2*Math.cos(angle);
    g.box('wood',[cx,cy,o.bottom+o.height/2],[o.width-.08,.05,o.height-.05],angle);
    for(const z of [o.bottom+o.height*.27,o.bottom+o.height*.73])g.box('wood',[cx+.03*Math.sin(angle),cy-.03*Math.cos(angle),z],[o.width*.72,.025,o.height*.34],angle);
    const hx=right-(o.width-.18)*Math.cos(angle),hy=-d/2-(o.width-.18)*Math.sin(angle);
    g.tube('metal',[hx,hy,o.bottom+1.02],[hx+.09*Math.sin(angle),hy-.09*Math.cos(angle),o.bottom+1.02],.024);
    g.box('dark',[o.offset,-d/2-.04,top+.22],[o.width+.12,.045,.24]);
    const glyphs:Record<string,string[]>={E:['11111','10000','10000','11110','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],P:['11110','10001','10001','11110','10000','10000','10000'],L:['10000','10000','10000','10000','10000','10000','11111'],O:['01110','10001','10001','10001','10001','10001','01110'],Y:['10001','10001','01010','00100','00100','00100','00100'],S:['01111','10000','10000','01110','00001','00001','11110'],N:['10001','11001','10101','10011','10001','10001','10001']};
    const text='EMPLOYEES ONLY',pixel=(o.width-.14)/(text.length*6),start=o.offset-(text.length*6-1)*pixel/2;
    for(let i=0;i<text.length;i++)for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(glyphs[text[i]]?.[row][col]==='1')g.box('cream',[start+(i*6+col)*pixel,-d/2-.065,top+.22+(3-row)*pixel],[pixel*.82,.004,pixel*.82]);
   }
   if(o.kind==='door'&&o.id==='entrance_01'){
    g.box('frame',[o.offset,-d/2-.05,top-.45],[o.width,.10,.055]);
    // 真正敞开的门洞：门扇侧开，远景退到室外，栏杆与门洞之间有实际空间。
    const leaf=o.width*.96,angle=.9,cx=left+leaf/2*Math.cos(angle),cy=d/2+leaf/2*Math.sin(angle),height=o.height-.45;
    for(const x of [-leaf/2,leaf/2])g.box('wood',[cx+x*Math.cos(angle),cy+x*Math.sin(angle),height/2],[.075,.075,height],angle);
    for(const z of [.18,height])g.box('wood',[cx,cy,z],[leaf,.075,z===.18?.36:.08],angle);
    g.box('metal',[cx+(leaf/2-.13)*Math.cos(angle)+.07*Math.sin(angle),cy+(leaf/2-.13)*Math.sin(angle)-.07*Math.cos(angle),1.05],[.03,.04,.24],angle);
    g.box('tile',[o.offset,1.05,-.04],[o.width+2.0,2.1,.08]);
    for(const x of [left-.7,right+.7])g.box('wood',[x,1.5,.58],[.085,.085,1.16]);
    for(const z of [.16,1.05])g.box('wood',[o.offset,1.5,z],[o.width+1.5,.07,.09]);
    for(let x=left-.6;x<right+.7;x+=.17)g.box('metal',[x,1.5,.58],[.025,.025,.90]);
    g.quad('windowView',[[left-2,2.6,-.1],[right+2,2.6,-.1],[right+2,2.6,top+1.2],[left-2,2.6,top+1.2]]);
   }
  }
  if(o.kind==='service')g.box('wood',[o.offset,0,o.bottom-.025],[o.width+.25,d+.35,.10]);
  if(o.rise>0){const rx=o.width/2,ry=o.rise,spring=top-ry,thickness=.22;
   for(let i=0;i<40;i++){const a=i/40*Math.PI+.002,b=(i+1)/40*Math.PI-.002,p=(r:number,z:number,t:number,y:number):V=>[o.offset+r*Math.cos(t),y,spring+z*Math.sin(t)];
    for(const side of [-1,1]){const y=side*(d/2+.007),ps=[p(rx,ry,a,y),p(rx,ry,b,y),p(rx+thickness,ry+thickness,b,y),p(rx+thickness,ry+thickness,a,y)];if(side===1)ps.reverse();g.quad('brick',ps,ps.map(q=>[q[0]/1.1,1-q[2]/1.1]));}
    g.quad('brick',[p(rx,ry,a,-d/2),p(rx,ry,a,d/2),p(rx,ry,b,d/2),p(rx,ry,b,-d/2)]);
   }
  }
 }
});}
export function reconstruction({atlas,layout}:any){
 validateReconstruction(layout);resolveSupports(layout);resolveTabletopItems(layout);const g=new MeshBuilder(atlas);
 for(const n of layout.architecture)architectureNode(g,n);
 const ceiling=Math.min(...layout.architecture.filter((n:any)=>n.kind==='ceiling').map((n:any)=>n.position[2]+n.size[2]));
 for(const n of layout.assets)placeNativeAsset(g,n,atlas,Number.isFinite(ceiling)?ceiling:4.5);
 return addChild({scene:emptyScene(),nodes:g.meshes().map(m=>sceneNode({name:m.name,key:m.name,geometry:m.geometry}).scene)});
}
