import {createRequire} from 'node:module';
import {accessSync,constants} from 'node:fs';
import {resolve} from 'node:path';
const engineDriver=createRequire(new URL('../../engine/packages/engine/node_modules/@forgeax/engine-devkit/package.json',import.meta.url));

/**
 * Engine devkit 的 launchCapturePage 写死 chromiumSandbox:true，在 WorkBuddy / CI 沙箱里
 * 会让渲染进程直接 Target crashed，导致 runtime 采集阶段必失败。
 * devkit 与这里解析到同一个 playwright 实例，因此在 workbench 侧只覆盖 launch 的沙箱参数：
 * 不改私有包、不改浏览器二进制、不改其它启动参数；正常环境仍可用环境变量关闭此覆盖。
 */
export function installCaptureNoSandbox(){
 if(process.env.SPEC_CAPTURE_KEEP_SANDBOX==='1')return;
 const pw=engineDriver('playwright');
 if(pw.__sceneFoundryNoSandbox)return;
 const original=pw.chromium.launch.bind(pw.chromium);
 pw.chromium.launch=(options={})=>original({...options,chromiumSandbox:false,
  args:[...(options.args??[]),'--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox']});
 pw.__sceneFoundryNoSandbox=true;
}

// Match the browser to the Engine capture driver, rather than the user's auto-updating Chrome.
export function captureBrowserExecutable(){
 const executable=resolve(process.env.FORGEAX_CAPTURE_BROWSER_EXECUTABLE||engineDriver('playwright').chromium.executablePath());
 try{accessSync(executable,constants.X_OK);}catch{throw Error('CAPTURE_BROWSER_MISSING：Engine 配套采集浏览器不可执行：'+executable+'；安装配套浏览器或配置 FORGEAX_CAPTURE_BROWSER_EXECUTABLE 后恢复，不回退到系统浏览器。');}
 return executable;
}
