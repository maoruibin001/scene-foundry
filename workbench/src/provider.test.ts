import {test,expect} from 'bun:test';
import {parseModelJson} from './provider';
test('deterministic syntax repair parses numbers without executing generated code',()=>{expect(parseModelJson('```json\n{"rotation":1.047],"material":"blue"}\n```')).toEqual({rotation:1.047,material:'blue'});expect(()=>parseModelJson('{"rotation":process.exit()}')).toThrow()});
