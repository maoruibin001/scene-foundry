import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {read,save} from '../store';
import {voxelizeScene} from './voxelize';
import {voxelFile} from './program';

// CPU-bound rasterization runs outside the coordinator so terminal streams and navigation stay responsive.
const dir=process.argv[2];if(!dir)throw Error('缺少转换目录');
const input=read(join(dir,'voxelization-input.json'));
const result=voxelizeScene(input.source,input.plan,input.referenceCount,input.textures,input.options);
save(join(dir,'voxel-program.json'),result.program);
save(join(dir,'voxel-metrics.json'),result.metrics);
save(join(dir,'voxelization-report.json'),result.report);
save(join(dir,'voxelized-scene.json'),result.scene);
writeFileSync(join(dir,'scene.vox'),voxelFile(result.program,result.grid));
console.log(JSON.stringify({phase:'voxelized',cells:result.metrics.cells,triangles:result.metrics.triangles,entities:result.metrics.entities,gridSize:result.metrics.gridSize,palette:result.metrics.palette}));
