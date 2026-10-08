import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const pipelineDataDir=(env=process.env)=>resolve(env.PIPELINE_DATA_DIR??fileURLToPath(new URL('../data/',import.meta.url)));
export const reconstructionPython=(env=process.env)=>join(pipelineDataDir(env),'reconstruction-env/bin/python');
