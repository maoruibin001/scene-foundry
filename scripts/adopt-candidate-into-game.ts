import {readFileSync,writeFileSync} from 'node:fs';
import {adoptCandidate} from '../workbench/src/spec/integration/adopt-candidate';
const request=JSON.parse(readFileSync(process.argv[2]!,'utf8'));
const result=await adoptCandidate(request);
writeFileSync(process.argv[3]!,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
