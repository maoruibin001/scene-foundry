import {microSurface} from './micro-surface';
import {MeshBuilder as GeometryBuilder,sub,type V} from '../geometry/mesh';
export * from '../geometry/mesh';
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
// 历史辅助样例的材质和 UV 配置；通用几何不依赖这里。
export class MeshBuilder extends GeometryBuilder {
 constructor(public atlas:any){super(()=>{throw Error('历史材质需要通过适配器解析');});this.group='room';}
 material(name:string){
  const cells:Record<string,number>={brick:0,plaster:1,wood:2,roofWood:2,leather:3,cloth:4,carpet:5,tile:6,arcade:7,glassArt:8,windowView:9,painting:10,arcadeMarquee:11,arcadePanel:12,arcadeFront:13,cabinetPaint:14};
  const colors:Record<string,number[]>={brick:[.88,.86,.83],plaster:[.84,.81,.75],wood:[.90,.86,.80],roofWood:[.56,.51,.45],leather:[.93,.83,.77],cloth:[.95,.89,.80],carpet:[.69,.70,.59],tile:[.84,.81,.73],arcade:[1,1,1],arcadeMarquee:[1,1,1],arcadePanel:[1,1,1],arcadeFront:[1,1,1],cabinetPaint:[1,1,1],glassArt:[1,1,.95],dark:[.065,.053,.042],metal:[.26,.21,.14],screen:[.055,.064,.057],paper:[.66,.61,.49],red:[.43,.055,.026],green:[.065,.19,.08],cream:[.68,.62,.48],soil:[.14,.11,.065],foliage:[.24,.29,.14],leafLight:[.36,.38,.18],paintingSky:[.48,.44,.31],frame:[.18,.11,.064],painting:[1,1,1],sky:[.64,.67,.51]};
  const rgb=colors[name]??colors.wood,cell=cells[name],micro=microSurface(name);return {cell:undefined,surface:{baseColor:[...rgb.map(linear),1],roughness:micro?1:name==='screen'?.16:name==='glassArt'?.40:name==='metal'?.48:name==='leather'?.62:name==='cloth'?.97:.85,metallic:name==='metal'?.62:0,...micro,...(cell!==undefined?{baseColorTexture:this.atlas[cell]}:{}),...(name==='sky'?{emissive:[.13,.15,.10],emissiveIntensity:1}:{} ),...(name==='windowView'?{emissive:[.7,.65,.50],emissiveIntensity:1}:{})}};
 }
 box(mat:string,p:V,s:V,yaw=0){const [x,y,z]=p,[w,d,h]=s.map(v=>v/2);const v:V[]=[[-w,-d,-h],[w,-d,-h],[w,d,-h],[-w,d,-h],[-w,-d,h],[w,-d,h],[w,d,h],[-w,d,h]].map(a=>[a[0]*Math.cos(yaw)-a[1]*Math.sin(yaw)+x,a[0]*Math.sin(yaw)+a[1]*Math.cos(yaw)+y,a[2]+z] as V);for(const f of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]){const q=f.map(i=>v[i]);const tile=mat==='brick'?1.25:(mat==='wood'||mat==='roofWood')?1.6:mat==='plaster'?1.8:0;const u=tile?Math.hypot(...sub(q[1],q[0]))/tile:1,vv=tile?Math.hypot(...sub(q[2],q[1]))/tile:1;const uv=(mat==='wood'||mat==='roofWood')&&u>vv?[[0,0],[0,u],[vv,u],[vv,0]]:[[0,vv],[u,vv],[u,0],[0,0]];this.quad(mat,q,uv);}}
}
