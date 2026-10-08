import {type TextureBundle,type TexturePixels,validTextureBundle} from './texture-bundle';

/** Generated, tileable material response. It is not measured PBR recovered from a photograph. */
export type MasonryPattern={kind:'masonry';columns:number;rows:number;jointWidth:number;jointContrast:number;stagger:boolean};
export type SurfacePattern={kind:'wood-grain'|'stone-veins';direction:'u'|'v';warp:number}|MasonryPattern;
export type SurfaceDetail={pattern?:SurfacePattern|null;seed:number;frequency:number;colorVariation:number;roughnessVariation:number;normalStrength:number;wearCoverage:number;wearColor:[number,number,number];wearRoughness:number;wearMetallic:number};
export const SURFACE_DETAIL_SIZE=256;
export const surfaceDetailSize=(d?:SurfaceDetail|null)=>d?.pattern?512:SURFACE_DETAIL_SIZE;
const unit={type:'number',minimum:0,maximum:1};
const patternProperties={kind:{type:'string',enum:['wood-grain','stone-veins']},direction:{type:'string',enum:['u','v']},warp:unit};
const masonryProperties={kind:{type:'string',enum:['masonry']},columns:{type:'integer',minimum:1,maximum:16},rows:{type:'integer',minimum:1,maximum:16},jointWidth:{type:'number',minimum:.001,maximum:.08},jointContrast:{type:'number',minimum:0,maximum:.5},stagger:{type:'boolean'}};
const properties={pattern:{anyOf:[{type:'null'},...[patternProperties,masonryProperties].map(properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false}))]},seed:{type:'integer',minimum:0,maximum:4294967295},frequency:{type:'integer',minimum:1,maximum:32},colorVariation:{...unit,maximum:.4},roughnessVariation:{...unit,maximum:.5},normalStrength:{...unit,maximum:.5},wearCoverage:{...unit,maximum:.5},wearColor:{type:'array',items:unit,minItems:3,maxItems:3},wearRoughness:unit,wearMetallic:unit};
export const surfaceDetailSchema=()=>({anyOf:[{type:'null'},{type:'object',properties,required:Object.keys(properties),additionalProperties:false}]});
export const SURFACE_DETAIL_GUIDANCE='surfaceDetail 为 null 时完全保留原材质。需要有图像依据的细微起伏、磨损或非均匀反光时，可声明 seed、frequency(1..32，单张UV内斑块频率)、colorVariation(0..0.4)、roughnessVariation(0..0.5)、normalStrength(0..0.5)、wearCoverage(0..0.5)、wearColor(线性RGB)、wearRoughness、wearMetallic。程序生成确定性的无缝多尺度材质通道；已有照片颜色与已验证通道仍参与合成，roughness/metallic先作为原基底值，再叠加变化。wearCoverage=0不覆盖颜色；其余表示有观察依据的磨损斑块面积，不能凭空增加锈蚀或把所有面都磨花。该能力不是从照片推断法线或恢复特定磨损位置，不解决几何轮廓、照片拼缝和错误UV比例；按真实预览决定参数，不能把有通道称为写实通过。pattern 为 null 或历史未声明时保留原各向同性噪声；有原图依据的连续木纹可选 {kind:\'wood-grain\',direction:\'u\'或\'v\',warp:0..1}，石材细脉可选 kind:\'stone-veins\'。direction 指纹理延伸方向，frequency 控制横向纹理次数，warp 控制连续纹理弯曲，强度仍由 colorVariation/roughnessVariation/normalStrength 决定；无照片贴图时使用512像素无缝通道，已有照片维持原分辨率。木纹必须和部件的实际UV及木构件长轴一致；石面没有可见脉纹时不要强加大理石图案。它们是显式程序表达，不能冒称真实扫描或逐点恢复；不增加几何、不生成环境反射或全局光照。原图有砌块或铺装分缝时，可声明pattern={kind:"masonry",columns:1..16,rows:1..16,jointWidth:0.001..0.08,jointContrast:0..0.5,stagger:boolean}；rows/columns是一个UV重复单元内的块数，错缝stagger=true时rows必须为偶数以保持无缝。jointWidth为UV单元内的缝宽且不得超过最小块边的30%，jointContrast控制缝相对块面的暗度；normalStrength为浅表凹凸，不生成真实几何开口、厚度或支承。用world-box的metersPerRepeat和origin确定实际块尺寸并让相邻墙片对缝，未观察到缝的柱身不要共用此材质；不同表面可克隆材质后单独绑定。已有照片仍按原像素合成，不自动去除照片光照，也不把程序块面称为扫描纹理。';
export function validateSurfaceDetail(d:SurfaceDetail|null|undefined){
 if(d==null)return;
 const valid=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 if(typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!(k in properties))||!Number.isInteger(d.seed)||!valid(d.seed,0,0xffffffff)||!Number.isInteger(d.frequency)||!valid(d.frequency,1,32)||!valid(d.colorVariation,0,.4)||!valid(d.roughnessVariation,0,.5)||!valid(d.normalStrength,0,.5)||!valid(d.wearCoverage,0,.5)||!Array.isArray(d.wearColor)||d.wearColor.length!==3||!d.wearColor.every(n=>valid(n,0,1))||!valid(d.wearRoughness,0,1)||!valid(d.wearMetallic,0,1))throw Error('程序化表面参数无效');
 const p=d.pattern;if(p==null)return;
 if(typeof p!=='object'||Array.isArray(p))throw Error('程序化纹理图案无效');
 if(p.kind==='masonry'){
  if(Object.keys(p).some(k=>!(k in masonryProperties))||!Number.isInteger(p.columns)||!valid(p.columns,1,16)||!Number.isInteger(p.rows)||!valid(p.rows,1,16)||typeof p.stagger!=='boolean'||p.stagger&&p.rows%2!==0||!valid(p.jointWidth,.001,.08)||p.jointWidth*Math.max(p.columns,p.rows)>.3||!valid(p.jointContrast,0,.5))throw Error('程序化砌块图案无效：错缝须为偶数行，分缝不能覆盖砖面');
 }else if(Object.keys(p).some(k=>!(k in patternProperties))||!['wood-grain','stone-veins'].includes(p.kind)||!['u','v'].includes(p.direction)||!valid(p.warp,0,1))throw Error('程序化纹理图案无效');
}
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const t=clamp(n);return t*t*(3-2*t)};
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const srgb=(v:number)=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
function lattice(x:number,y:number,frequency:number,seed:number){
 x=(x%frequency+frequency)%frequency;y=(y%frequency+frequency)%frequency;
 let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^seed)>>>0;
 n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;
}
function noise(u:number,v:number,frequency:number,seed:number){
 const x=u*frequency,y=v*frequency,ix=Math.floor(x),iy=Math.floor(y),fx=smooth(x-ix),fy=smooth(y-iy);
 return lerp(lerp(lattice(ix,iy,frequency,seed),lattice(ix+1,iy,frequency,seed),fx),lerp(lattice(ix,iy+1,frequency,seed),lattice(ix+1,iy+1,frequency,seed),fx),fy);
}
const isotropic=(u:number,v:number,d:SurfaceDetail)=>noise(u,v,d.frequency,d.seed)*.58+noise(u,v,d.frequency*2,d.seed+19)*.28+noise(u,v,d.frequency*4,d.seed+53)*.14;
/** UV-periodic joints and per-block tone; this is surface relief, never a structural opening. */
function masonry(u:number,v:number,p:MasonryPattern,seed:number){
 const row=Math.floor(v*p.rows),x=u*p.columns+(p.stagger&&row%2!==0?.5:0),column=Math.floor(x);
 const fx=x-column,fy=v*p.rows-row;
 const distance=Math.min(Math.min(fx,1-fx)/p.columns,Math.min(fy,1-fy)/p.rows);
 const face=smooth((distance-p.jointWidth*.25)/(p.jointWidth*.5));
 const tone=lattice(column%p.columns,row%p.rows,256,seed);
 return {height:face*(.44+.12*tone),shade:1-(1-face)*p.jointContrast};
}
/** Periodic warped bands express direction and veins, not just higher-amplitude noise. */
function field(u:number,v:number,d:SurfaceDetail){
 const p=d.pattern;if(!p)return isotropic(u,v,d);
 if(p.kind==='masonry')return masonry(u,v,p,d.seed).height;
 const across=p.direction==='u'?v:u,along=p.direction==='u'?u:v;
 const warp=(noise(across,along,2,d.seed+71)-.5)*3+(noise(across,along,4,d.seed+113)-.5)*.5;
 const phase=Math.PI*2*(across*d.frequency+warp*p.warp+d.seed/4294967295);
 const fine=isotropic(u,v,d),wave=.5+.5*Math.sin(phase);
 return p.kind==='wood-grain'?.64*wave+.22*(.5+.5*Math.sin(phase*3))+.14*fine:.6*fine+.4*Math.pow(wave,8);
}
type BaseMaterial={color:[number,number,number,number];roughness:number;metallic:number;surfaceDetail?:SurfaceDetail|null};
/** Final physical factors are baked once, so maps are not multiplied by base roughness twice. */
export function detailedSurface(m:BaseMaterial,t?:TextureBundle){
 const d=m.surfaceDetail;validateSurfaceDetail(d);if(!d)throw Error('缺少程序化表面声明');if(t&&!validTextureBundle(t))throw Error('程序化表面来源贴图无效');
 const width=t?.width??surfaceDetailSize(d),height=t?.height??surfaceDetailSize(d),base=t?Buffer.from(t.rgba8,'base64'):null,oldNormal=t?.normalTexture?Buffer.from(t.normalTexture.rgba8,'base64'):null,oldMR=t?.metallicRoughnessTexture?Buffer.from(t.metallicRoughnessTexture.rgba8,'base64'):null;
 const color=Buffer.alloc(width*height*4),normal=Buffer.alloc(color.length),mr=Buffer.alloc(color.length),values=new Float32Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=field(x/Math.max(1,width-1),y/Math.max(1,height-1),d);
 const bins=new Uint32Array(1024);for(const n of values)bins[Math.min(1023,Math.floor(n*1024))]++;
 const target=(1-d.wearCoverage)*values.length;let cumulative=0,bin=0;for(;bin<1023;bin++){cumulative+=bins[bin];if(cumulative>=target)break;}const threshold=(bin+.5)/1024;
 // The last row/column repeats the first; wrap derivatives over the unique samples too.
 const wx=Math.max(1,width-1),wy=Math.max(1,height-1),at=(x:number,y:number)=>values[((y%wy+wy)%wy)*width+(x%wx+wx)%wx];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,k=i*4,n=values[i],wear=d.wearCoverage?smooth((n-threshold)/.025+.5):0;
  const shade=d.pattern?.kind==='masonry'?masonry(x/Math.max(1,width-1),y/Math.max(1,height-1),d.pattern,d.seed).shade:1;
  for(let channel=0;channel<3;channel++){
   const sample=base?base[k+channel]/255:1,reflectance=(t?.colorSpace==='linear'?sample:linear(sample))*m.color[channel];
   color[k+channel]=Math.round(srgb(clamp(lerp(reflectance*shade*(1+(n-.5)*2*d.colorVariation),d.wearColor[channel],wear)))*255);
  }
  color[k+3]=base?base[k+3]:255;
  const dx=(at(x+1,y)-at(x-1,y))*width/Math.max(1,d.frequency),dy=(at(x,y+1)-at(x,y-1))*height/Math.max(1,d.frequency);
  const nx=(oldNormal?oldNormal[k]/255*2-1:0)-dx*d.normalStrength,ny=(oldNormal?oldNormal[k+1]/255*2-1:0)-dy*d.normalStrength,nz=oldNormal?Math.max(.01,oldNormal[k+2]/255*2-1):1,length=Math.hypot(nx,ny,nz);
  normal.set([nx,ny,nz].map(a=>Math.round((a/length*.5+.5)*255)),k);normal[k+3]=255;
  const rough=clamp(m.roughness*(oldMR?oldMR[k+1]/255:1)+(n-.5)*2*d.roughnessVariation),metal=m.metallic*(oldMR?oldMR[k+2]/255:1);
  mr.set([255,Math.round(lerp(rough,d.wearRoughness,wear)*255),Math.round(lerp(metal,d.wearMetallic,wear)*255),255],k);
 }
 const texture=(b:Buffer,colorSpace:'linear'|'srgb'):TexturePixels=>({width,height,rgba8:b.toString('base64'),colorSpace});
 return {baseColor:[1,1,1,m.color[3]],roughness:1,metallic:1,baseColorTexture:texture(color,'srgb'),normalTexture:texture(normal,'linear'),metallicRoughnessTexture:texture(mr,'linear')};
}
