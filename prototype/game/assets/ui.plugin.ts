import type {} from '@forgeax/engine/app';
import type {Plugin} from '@forgeax/engine/plugin';
export default {
 name:'micro-garden/ui',inject:['gameHost'],
 apply(ctx){ctx.effect(()=>{
  const host=ctx.gameHost;
  if(!host)throw new Error('GameHost unavailable');
  const hud=document.createElement('section');hud.id='scene-hud';
  hud.style.cssText='position:fixed;left:24px;top:24px;color:#f4f6e8;background:rgba(9,27,31,.90);padding:18px 24px;border-left:3px solid #e9ad5e;border-radius:3px;font:14px/1.8 system-ui;pointer-events:none;z-index:20';
  hud.innerHTML='<div style="letter-spacing:.22em;font-size:11px;color:#deb879">MICRO GARDEN / OBSERVATORY</div><strong style="font-size:25px;font-weight:500">根界 · 微观温室检修站</strong><div>Space 巡航 / 暂停 · ← → 环绕 · ↑ ↓ 推近 / 拉远</div><div>H 隐藏全部界面 / 恢复</div><div style="color:#b6c8bf;font-size:12px">放大花盆与根系，观察结构、尺度与遮挡变化</div>';
  (host.uiRoot??document.body).append(hud);
  const toggle=(e:KeyboardEvent)=>{if((e.code==='KeyH'||e.code==='F1')&&!e.repeat){e.preventDefault();hud.hidden=!hud.hidden;}};
  document.addEventListener('keydown',toggle);
  return()=>{document.removeEventListener('keydown',toggle);hud.remove()};
 },'micro-garden/ui');}
} satisfies Plugin;
