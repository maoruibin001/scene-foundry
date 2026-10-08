// 画幅由原始图片尺寸派生；模型只决定机位与垂直视场，不决定采集比例。
export function referenceFrame(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('参考图尺寸无效');
 const scale=Math.min(1600/width,1440/height),w=Math.max(2,Math.round(width*scale/2)*2),h=Math.max(2,Math.round(height*scale/2)*2);
 return {width:w,height:h,sourceWidth:width,sourceHeight:height,source:'reference-image'};
}
export function captureFrame(camera){
 const f=camera?.frame??{width:1600,height:900};
 if(!Number.isInteger(f.width)||!Number.isInteger(f.height)||f.width<2||f.height<2||f.width>1600||f.height>1440)throw Error('采集画幅无效');
 return {width:f.width,height:f.height};
}
export function cameraAspect(camera){const f=captureFrame(camera);return f.width/f.height;}
export function diagnosticFrame(camera){const {width,height}=captureFrame(camera),scale=320/Math.max(width,height);return {width:Math.max(8,Math.round(width*scale)),height:Math.max(8,Math.round(height*scale))};}
