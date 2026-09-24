export function phaseStage(label:string){
 if(label.includes('逐图观察'))return 'observe';
 if(label.includes('规划空间')||label.includes('规划共享布局'))return 'space';
 if(label.includes('规划材质'))return 'surface';
 if(label.includes('提取并记录材质'))return 'materials';
 if(label.startsWith('生成资产'))return 'assets';
 if(label.includes('组装并检查'))return 'assembly';
 return null;
}
export function displayStage(job:any){return job.stage==='generate'&&job.stageTrackingVersion!=='exclusive-stages-v1'?phaseStage(job.generationProgress?.phase??'')??'generate':job.stage;}
