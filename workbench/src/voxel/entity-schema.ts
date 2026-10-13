import {assetSchema} from '../geometry/layout';
import {validateVoxelLattice,type VoxelLattice} from './scene-lattice';

export type VoxelEntitySchemaContext={voxelLattice?:VoxelLattice;templateId?:string;materialIds?:string[];maxParts?:number};
/** Same asset handoff and tools, restricted to a single frozen native voxel template. */
export function voxelEntitySchema(context:VoxelEntitySchemaContext={}){
 const lattice=validateVoxelLattice(context.voxelLattice);
 const schema=assetSchema(true,lattice),template=schema.properties.template;
 if(context.templateId)template.properties.id={type:'string',enum:[context.templateId]};
 if(context.maxParts!==undefined)template.properties.parts.maxItems=context.maxParts;
 if(context.materialIds?.length)template.properties.parts.items.properties.material={type:'string',enum:context.materialIds};
 return schema;
}
