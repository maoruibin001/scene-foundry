import {digest} from '../store';
import type {AssetBrief,SceneLayout} from './layout';
import type {Texture} from './program';
/** Keep all shared anchors and cameras; remove other assets' detailed material instructions. */
export function assetInput(prompt:string,plan:any,layout:SceneLayout,brief:AssetBrief,textures:Record<string,Texture>){
 const materials=layout.program.materials.filter(m=>brief.materialIds.includes(m.id)),ids=new Set(materials.map(m=>m.textureId).filter(Boolean));
 return {originalPrompt:prompt,plan,brief,spatialOpenings:(layout.spatialOpenings??[]).filter(o=>layout.program.instances.find(i=>i.id===o.instanceId)?.template===brief.id),sceneContext:{name:layout.program.name,instances:layout.program.instances,templateAnchors:layout.program.templates.map(t=>({id:t.id,label:t.label,origin:t.origin,bounds:t.bounds})),cameras:layout.cameras,assumptions:layout.assumptions},materials,textures:layout.textures.filter(t=>ids.has(t.id)),textureRegistry:Object.entries(textures).filter(([id])=>ids.has(id)).map(([id,t])=>({id,width:t.width,height:t.height,colorSpace:t.colorSpace,rgbaSha256:digest(t.rgba8)}))};
}
