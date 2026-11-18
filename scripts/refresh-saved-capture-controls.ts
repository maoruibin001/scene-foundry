import {refreshSavedCaptureControls} from '../workbench/src/geometry/refresh-controls';
import {writeFileSync} from 'node:fs';
const [project,receipt]=process.argv.slice(2);if(!project||!receipt)throw Error('Expected copied saved project and receipt path');
const r=refreshSavedCaptureControls(project);writeFileSync(receipt,JSON.stringify(r,null,2));console.log(JSON.stringify(r));
