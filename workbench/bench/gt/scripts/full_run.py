# usage: GT_RUN_DATA=<dir> python -I full_run.py <out dir> [id...] — all scenes on the batch model (codex6 relay), as parallel as the backends allow.
# Each scene: create the job, wait for the first scored graybox round, cancel it, export and score against ground truth.
# A job the relay blocks (provider recovery exhausted, preflight timeout) is resumed through /recover after a backoff, up to
# MAX_RESUMES times; one that cannot be resumed is recreated once. Every event is one log line; state survives in <out>/state.json.
import json,os,sys,time,subprocess,threading,urllib.request,glob
from concurrent.futures import ThreadPoolExecutor
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# GT_RUN_DATA: parent of the backends' data dirs (<dir>/ordinary/data, <dir>/voxel/data); GT_UI / GT_PORT_*: their ports
V=os.environ['GT_RUN_DATA'];UI=os.environ.get('GT_UI','20084');PORTS={'voxel':int(os.environ.get('GT_PORT_VOXEL','20087')),'ordinary':int(os.environ.get('GT_PORT_ORDINARY','20086'))}
REPO=os.path.abspath(os.path.join(B,'..','..','..'))
sys.path.insert(0,B+'/scripts');from score import score
OUT=sys.argv[1];os.makedirs(OUT,exist_ok=True)
INPUTS={x['id']:{**x,'images':[os.path.join(B,i) for i in x['images']]} for x in json.load(open(B+'/inputs.json'))};IDS=sys.argv[2:] or list(INPUTS)
MAX_RESUMES,BACKOFF,POLL=4,90,30
# GT_UNTIL=graybox: let the graybox repair loop run until it passes, stops, or reaches GT_MAX_ROUNDS rounds; then score round 0 and the
# round the job retained (blockout.repairBasis). Default: cancel after round 0.
UNTIL=os.environ.get('GT_UNTIL','round0');MAX_ROUNDS=int(os.environ.get('GT_MAX_ROUNDS','4'))
lock=threading.Lock();statePath=OUT+'/state.json'
state=json.load(open(statePath)) if os.path.exists(statePath) else {}
def log(*a):
  with lock:print(time.strftime('%H:%M:%S'),*a,flush=True)
def save():
  with lock:json.dump(state,open(statePath,'w'),indent=1,default=float)
def port(kind):return PORTS['voxel' if kind=='voxel' else 'ordinary']
def api(p,path,method='GET'):
  r=urllib.request.Request(f'http://127.0.0.1:{p}{path}',method=method,data=b'{}' if method=='POST' else None,headers={'content-type':'application/json'})
  return json.loads(urllib.request.urlopen(r,timeout=60).read())
create_slots=threading.Semaphore(3)
def create(x):
  with create_slots:
    # create-job.cjs drives the workbench UI (needs playwright-core on NODE_PATH)
    env={**os.environ,'UI':UI}
    r=subprocess.run(['node',os.path.join(B,'scripts','create-job.cjs'),UI,'voxel/' if x['kind']=='voxel' else '',','.join(x['images']),x['prompt'],'go'],capture_output=True,text=True,env=env,timeout=600)
    for line in r.stdout.splitlines():
      if line.startswith('HASH #job/'):return line.split('/')[-1].strip()
    raise RuntimeError('create failed: '+(r.stdout+r.stderr)[-300:])
def run_dir(kind,job):return glob.glob(f'{V}/{"voxel" if kind=="voxel" else "ordinary"}/data/runs/{job}')[0]
def score_round(sid,x,d,n):
  o=f'{OUT}/{sid}';os.makedirs(o,exist_ok=True)
  gtp=f'{B}/hypersim/{sid}.json' if x['set']=='A' else f'{B}/voxel/{sid}.json'
  subprocess.run(['bun',B+'/scripts/scene_to_pred.ts',f'{d}/generation/blockout/{n}/render-scene.json',f'{o}/pred-{n}.json'],check=True,capture_output=True,env={**os.environ,'SF_REPO':REPO})
  r=score(json.load(open(gtp)),json.load(open(f'{o}/pred-{n}.json')));json.dump(r,open(f'{o}/score-{n}.json','w'),indent=1,default=float)
  gate=json.load(open(f'{d}/generation/blockout/{n}/gate.json'));s=r['summary']
  return {'round':n,'judge':gate['review']['score'],'passed':gate.get('passed'),'object3d':(gate.get('object3d') or {}).get('score'),**{k:s.get(k) for k in ('objectRecall','objectPrecision','centerErrM','sizeErr','meanIoU3d','cameraForwardErrDeg','cameraHeightErrM','vfovErrDeg','orthoHeightLogErr','scale')},'anchoredRecall':s['anchored']['objectRecall']}
def finish(sid,x,job,j=None):
  d=run_dir(x['kind'],job);r=score_round(sid,x,d,0)
  best=((j or {}).get('blockout') or {}).get('repairBasis') or {}
  if UNTIL=='graybox':r={**r,'rounds':len((j.get('blockout') or {}).get('rounds',[])),'blockoutStatus':(j.get('blockout') or {}).get('status'),'retained':score_round(sid,x,d,best['round']) if best.get('round') else r}
  return r
def one(sid):
  x=INPUTS[sid];p=port(x['kind']);st=state.setdefault(sid,{'jobs':[],'resumes':0,'recreated':0})
  if st.get('result') or st.get('failed'):return
  try:
    job=st['jobs'][-1] if st['jobs'] else None
    if not job:job=create(x);st['jobs'].append(job);save();log(sid,'created',job)
    while True:
      j=api(p,f'/api/jobs/{job}');rounds=[r for r in (j.get('blockout') or {}).get('rounds',[]) if (r.get('review') or {}).get('score') is not None]
      b=j.get('blockout') or {}
      done=bool(rounds) if UNTIL!='graybox' else bool(rounds) and (b.get('status') in('passed','stopped') or len(rounds)>=MAX_ROUNDS)
      if done and j['status'] in('running','queued'):
        api(p,f'/api/jobs/{job}/cancel','POST');log(sid,'graybox',len(rounds),'rounds, status',b.get('status'),'object3d',[(r.get('object3d') or {}).get('score') for r in rounds],'-> cancelled');time.sleep(5);continue
      if rounds and (j['status']=='cancelled' or (done and j['status'] not in('running','queued'))):
        st['result']=finish(sid,x,job,j);save();r=st['result']
        if UNTIL=='graybox':log(sid,'RETAINED',json.dumps({k:r['retained'].get(k) for k in ('round','object3d','passed','anchoredRecall','objectRecall')}))
        log(sid,'SCORE judge',r['judge'],'recall %.2f prec %.2f anchored %.2f'%(r['objectRecall'] or 0,r['objectPrecision'] or 0,r['anchoredRecall'] or 0));return
      if j['status'] in('blocked','failed','cancelled'):
        err=str(j.get('error'))[:160]
        if st['resumes']<MAX_RESUMES:
          st['resumes']+=1;save();log(sid,j['status'],'at',j.get('stage'),'->',err[:90],'| resume',st['resumes'],'after',BACKOFF,'s');time.sleep(BACKOFF)
          try:job=api(p,f'/api/jobs/{job}/recover','POST')['id'];st['jobs'].append(job);save();log(sid,'resumed as',job);continue
          except Exception as e:
            if st['recreated']<1:st['recreated']+=1;job=create(x);st['jobs'].append(job);save();log(sid,'recreated as',job,'(recover refused:',str(e)[:80],')');continue
        st['failed']=f"{j['status']} at {j.get('stage')}: {err}";save();log(sid,'FAILED',st['failed']);return
      time.sleep(POLL)
  except Exception as e:
    st['failed']='driver: '+str(e)[:300];save();log(sid,'FAILED driver',str(e)[:200])
log('start',len(IDS),'scenes')
# Every scene's driver thread starts at once; the backends' own scene limit (并行与队列, default 2 per kind) decides how many run,
# so the relay sees the same load as normal use. Jobs beyond the limit wait in the backend queue, not here.
with ThreadPoolExecutor(len(IDS)) as ex:list(ex.map(one,IDS))
done=[s for s in IDS if state.get(s,{}).get('result')];log('ALL DONE scored',len(done),'of',len(IDS),'failed',[s for s in IDS if state.get(s,{}).get('failed')])
