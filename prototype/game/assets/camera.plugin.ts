import type {} from '@forgeax/engine/app';
import {Time,Update} from '@forgeax/engine/ecs';
import {INPUT_SNAPSHOT_RESOURCE_KEY,FRAME_START_SCAN_SYSTEM_NAME,type InputSnapshot} from '@forgeax/engine/input';
import {quat} from '@forgeax/engine/math';
import type {Plugin} from '@forgeax/engine/plugin';
import {Transform,sceneEntity,worldResolveSceneEntity} from '@forgeax/engine/scene';

export default {
 name:'micro-garden/camera',inject:['world','gameHost'],
 apply(ctx){
  const host=ctx.gameHost;
  if(host?.defaultSceneRoot === undefined)throw new Error('Main scene did not instantiate');
  const camera=worldResolveSceneEntity(ctx.world,host.defaultSceneRoot,sceneEntity('scene/main','camera')).unwrap();
  let angle=Math.PI/4, radius=Math.sqrt(800), running=false, elapsed=0, frames=0;
  ctx.effect(function*(){
   ctx.world.addSystem(Update,{name:'micro-garden-camera',after:[FRAME_START_SCAN_SYSTEM_NAME],queries:[],fn:()=>{
    const input=ctx.world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
    const dt=Math.min(ctx.world.getResource(Time).delta,0.1);frames++;
    if(input.keyboard.justPressedCode('Space'))running=!running;
    const axis=Number(input.keyboard.downCode('ArrowRight'))-Number(input.keyboard.downCode('ArrowLeft'));
    angle+=(axis*0.7+(running?0.16:0))*dt;
    angle+=(Number(input.keyboard.justPressedCode('ArrowRight'))-Number(input.keyboard.justPressedCode('ArrowLeft')))*0.035;
    const dollyStep=(Number(input.keyboard.justPressedCode('ArrowDown'))-Number(input.keyboard.justPressedCode('ArrowUp')))*0.35;
    radius=Math.max(19,Math.min(32,radius+dollyStep+(Number(input.keyboard.downCode('ArrowDown'))-Number(input.keyboard.downCode('ArrowUp')))*5*dt));
    if(running)elapsed+=dt;
    const pos=[Math.cos(angle)*radius,10,Math.sin(angle)*radius] as const;
    const q=quat.fromLookAt(quat.create(),pos,[0,5,0],[0,1,0]);
    ctx.world.set(camera,Transform,{pos,quat:Array.from(q)}).unwrap();
   }}).unwrap();
   yield()=>ctx.world.removeSystem(Update,'micro-garden-camera').unwrap();
   const unregister=host.gameProjection?.registerRead({id:'micro-garden.camera',title:'Recording camera position',description:'Read-only telemetry of the real input-driven camera',read:()=>({angle,radius,running,elapsed,frames,position:[Math.cos(angle)*radius,10,Math.sin(angle)*radius]})});
   if(unregister)yield unregister;
  },'micro-garden/camera');
 }
} satisfies Plugin;
