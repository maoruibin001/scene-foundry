export function viewOnly(env:Record<string,string|undefined>=process.env){return env.PIPELINE_VIEW_ONLY==='1';}
export function viewOnlyRequestAllowed(method:string){return method==='GET'||method==='HEAD';}
export function observerBootstrap(env:Record<string,string|undefined>=process.env){return {initializeModels:!viewOnly(env),claimCoordinator:!viewOnly(env),resumeAutomatically:!viewOnly(env)};}
