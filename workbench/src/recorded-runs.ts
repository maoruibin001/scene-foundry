import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Recorded runs are local evidence and never part of the repository. Point PIPELINE_RECORDED_RUNS_DIR at a folder holding
 * copies (or links) of the run directories; without it the replays that need them are reported as skipped, not passed.
 */
export const RECORDED_RUNS_DIR=process.env.PIPELINE_RECORDED_RUNS_DIR?.trim()||null;

/** The recorded run whose id starts with `prefix`, or null when this machine has no copy of it. */
export function recordedRun(prefix:string){
 if(!RECORDED_RUNS_DIR||!existsSync(RECORDED_RUNS_DIR))return null;
 const id=readdirSync(RECORDED_RUNS_DIR).find(d=>d.startsWith(prefix));
 return id?join(RECORDED_RUNS_DIR,id):null;
}
