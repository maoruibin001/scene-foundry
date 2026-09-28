import {test,expect} from 'bun:test';
import {captureBrowserExecutable} from './capture-browser.mjs';
test('显式配置缺失时拒绝采集，不隐式回退到用户Chrome',()=>{
 const previous=process.env.FORGEAX_CAPTURE_BROWSER_EXECUTABLE;process.env.FORGEAX_CAPTURE_BROWSER_EXECUTABLE='/not-installed/forgeax-capture-browser';
 try{expect(()=>captureBrowserExecutable()).toThrow('CAPTURE_BROWSER_MISSING');}finally{if(previous===undefined)delete process.env.FORGEAX_CAPTURE_BROWSER_EXECUTABLE;else process.env.FORGEAX_CAPTURE_BROWSER_EXECUTABLE=previous;}
});
