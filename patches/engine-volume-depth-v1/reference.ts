/** CPU optical oracle for depth-matched reconstruction; not a GPU receipt. */
export function adaptiveResolve(width:number,height:number,depths:Float64Array,integrate:(x:number,y:number,depth:number)=>number,compact=false){
 if(depths.length!==width*height||[...depths].some(d=>!Number.isFinite(d)||d<0))throw Error('finite nonnegative depth grid required');
 const cw=Math.ceil(width/8),ch=Math.ceil(height/8),coarse=new Float64Array(cw*ch),coarseDepth=new Float64Array(cw*ch);
 for(let j=0;j<ch;j++)for(let i=0;i<cw;i++){const x=(i+.5)/cw*width-.5,y=(j+.5)/ch*height-.5,depth=depths[Math.min(height-1,Math.floor(y+.5))*width+Math.min(width-1,Math.floor(x+.5))];coarseDepth[j*cw+i]=depth;coarse[j*cw+i]=integrate(x,y,depth);}
 const jobs:number[]=[];const result=new Float64Array(width*height);let fullPixels=0,integrations=cw*ch;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const px=(x+.5)/width*cw-.5,py=(y+.5)/height*ch-.5,bx=Math.floor(px),by=Math.floor(py),fx=px-bx,fy=py-by,target=depths[y*width+x];let sum=0,weight=0;
  for(let j=0;j<2;j++)for(let i=0;i<2;i++){const ix=Math.max(0,Math.min(cw-1,bx+i)),iy=Math.max(0,Math.min(ch-1,by+j)),k=iy*cw+ix,spatial=(i?fx:1-fx)*(j?fy:1-fy);if(Math.abs(coarseDepth[k]-target)<=Math.max(.025,target*.005)){sum+=coarse[k]*spatial;weight+=spatial;}}
  if(weight>1e-5)result[y*width+x]=sum/weight;else{if(compact)jobs.push(y*width+x);else result[y*width+x]=integrate(x,y,target);fullPixels++;integrations++;}
 }
 for(const n of jobs)result[n]=integrate(n%width,Math.floor(n/width),depths[n]);
 return {result,integrations,fullPixels,jobs};
}
