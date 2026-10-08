import {test,expect} from 'bun:test';
import {countUnitDefinitions,COUNT_UNIT_GUIDANCE} from './count-units';
test('相连零件组不合并、转角墙面不拆计，定义不提供可见数量答案',()=>{
 const scene={entities:[{instanceId:'body',category:'机械'},{instanceId:'lever',category:'机械'},{instanceId:'wall',category:'墙体'}],program:{instances:[{id:'body',label:'筒体与端盖',template:'t'},{id:'lever',label:'操纵杆组',template:'l'},{id:'wall',label:'连续转角墙',template:'w'}],templates:[{id:'w',parts:[{id:'rear'},{id:'return'},{id:'reveal'}]}]}};
 const before=JSON.stringify(scene),defs=countUnitDefinitions(scene,{机械:2,墙体:1});expect(defs).toEqual([{kind:'机械',units:[{instanceId:'body',label:'筒体与端盖'},{instanceId:'lever',label:'操纵杆组'}]},{kind:'墙体',units:[{instanceId:'wall',label:'连续转角墙'}]}]);expect(JSON.stringify(scene)).toBe(before);
 expect(JSON.stringify(defs)).not.toContain('visible');expect(COUNT_UNIT_GUIDANCE).toContain('不能直接复制');expect(COUNT_UNIT_GUIDANCE).toContain('额外或重复');
});
test('无旧场景数据保持原计数请求，损坏关联必须显式报错',()=>{
 expect(countUnitDefinitions(null,{墙:1})).toEqual([]);
 expect(()=>countUnitDefinitions({entities:[{instanceId:'missing',category:'墙'}],program:{instances:[]}},{墙:1})).toThrow('对应实例');
});
