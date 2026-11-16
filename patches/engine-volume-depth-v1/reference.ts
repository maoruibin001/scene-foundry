/** Offline oracle for the adaptive invocation policy, not an Engine render receipt. */
export function adaptiveResolve(width:number,height:number,depths:Float64Array,integrate:(x:number,y:number,depth:number)=>number){
 if(depths.length!==width*height||[...depths].some(d=>!Number.isFinite(d)||d<0))throw Error('finite nonnegative depth grid required');
 const result=new Float64Array(width*height);let fullPixels=0,integrations=0;
 for(let y=0;y<height;y+=8)for(let x=0;x<width;x+=8){
  let min=Infinity,max=0;for(let j=y;j<Math.min(height,y+8);j++)for(let i=x;i<Math.min(width,x+8);i++){min=Math.min(min,depths[j*width+i]);max=Math.max(max,depths[j*width+i]);}
  const edge=max-min>Math.max(.025,min*.005),corners:number[]=[];
  if(!edge)for(const [dx,dy]of [[0,0],[7,0],[0,7],[7,7]]){const i=Math.min(x+dx,width-1),j=Math.min(y+dy,height-1);corners.push(integrate(i,j,depths[j*width+i]));integrations++;}
  for(let j=y;j<Math.min(height,y+8);j++)for(let i=x;i<Math.min(width,x+8);i++){
   if(edge){result[j*width+i]=integrate(i,j,depths[j*width+i]);fullPixels++;integrations++;}
   else{const u=(i-x)/7,v=(j-y)/7;result[j*width+i]=(corners[0]*(1-u)+corners[1]*u)*(1-v)+(corners[2]*(1-u)+corners[3]*u)*v;}
  }
 }
 return {result,integrations,fullPixels};
}
