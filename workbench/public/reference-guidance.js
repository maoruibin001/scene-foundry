/** Advice only: existing single-image scenes and text-only creation stay supported. */
export function referenceImageAdvice(count){
 if(!count)return '建议至少选择 2 张同一场景、不同机位的图片，空间关系更容易核对。';
 if(count===1)return '已上传 1 张。建议再补充至少 1 张不同机位；也可继续使用单张。';
 return `已上传 ${count} 张，将共同作为同一场景的参考。请确认主体、地点和风格一致。`;
}
