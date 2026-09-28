import {createRequire} from 'node:module';
import {accessSync,constants} from 'node:fs';
import {resolve} from 'node:path';
// Match the browser to the Engine capture driver, rather than the user's auto-updating Chrome.
export function captureBrowserExecutable(){
 const engineDriver=createRequire(new URL('../../engine/packages/engine/node_modules/@forgeax/engine-devkit/package.json',import.meta.url));
 const executable=resolve(process.env.FORGEAX_CAPTURE_BROWSER_EXECUTABLE||engineDriver('playwright').chromium.executablePath());
 try{accessSync(executable,constants.X_OK);}catch{throw Error('CAPTURE_BROWSER_MISSING：Engine 配套采集浏览器不可执行：'+executable+'；安装配套浏览器或配置 FORGEAX_CAPTURE_BROWSER_EXECUTABLE 后恢复，不回退到系统浏览器。');}
 return executable;
}
