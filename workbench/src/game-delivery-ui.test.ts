import {expect,test} from 'bun:test';
import {gameDeliveryCards} from '../public/game-delivery-ui.js';
const delivery={id:'r3',title:'Hall <reviewed>',previewUrl:'http://localhost:19786/',reportUrl:'/files/diagnostics/hall/index.html',coverUrl:'/files/diagnostics/hall/hero.png',playPassed:true,sourceJobId:'source',summary:'124 objects'};
test('accepted game appears beside its source and evidence without inheriting a visual grade',()=>{
 const html=gameDeliveryCards({viewOnly:true,items:[delivery]});
 expect(html).toContain('打开最新场景');expect(html).toContain('Hall &lt;reviewed&gt;');expect(html).toContain('#job/source');expect(html).toContain('不会启动生成');
});
test('unverified deliveries and unsafe destinations are not exposed as playable scenes',()=>{
 for(const bad of [{playPassed:false},{previewUrl:'javascript:alert(1)'},{previewUrl:'https://example.com/'},{reportUrl:'/files/diagnostics/../private'},{coverUrl:'/other.png'}])expect(gameDeliveryCards({items:[{...delivery,...bad}]})).toBe('');
 expect(gameDeliveryCards({items:[]})).toBe('');
});
