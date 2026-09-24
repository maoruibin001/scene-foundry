import {test,expect} from 'bun:test';
import {validateBrief,assertBuiltState} from './pipeline';
import brief from '../brief.json';
test('does not mislabel external search as procedural success',()=>{expect(()=>validateBrief({...brief,externalAssets:{required:true}})).toThrow('external-asset-provider-not-configured')});
test('rejects unstable output identity and unsupported scope',()=>{expect(()=>validateBrief({...brief,sourceKey:'Scene/Draft 2'})).toThrow();expect(()=>validateBrief({...brief,targets:['full-game']})).toThrow()});

test("refuses stale or failed build evidence",()=>{const good={stages:{"engine-build":{status:"passed"},catalog:{status:"passed"}},buildInputDigest:"A"};expect(()=>assertBuiltState(good,"A")).not.toThrow();expect(()=>assertBuiltState(good,"B")).toThrow();expect(()=>assertBuiltState({...good,stages:{...good.stages,"engine-build":{status:"failed"}}},"A")).toThrow()});
