# python3 inventory-composition-score.py <inventory.json> <runs-dir>...
import json,os,glob,collections,sys
ROOTS=sys.argv[2:]
rows=[]
def load(p):
    try: return json.load(open(p))
    except Exception: return None
for R in sorted(set(ROOTS)):
    for job in os.listdir(R):
        jd=os.path.join(R,job)
        if not os.path.isfile(os.path.join(jd,'job.json')): continue
        folders=[('root','')]+[('graybox','generation/blockout/'+n) for n in os.listdir(jd+'/generation/blockout')] if os.path.isdir(jd+'/generation/blockout') else [('root','')]
        if os.path.isdir(jd+'/iterations'): folders+=[('iteration','iterations/'+n) for n in os.listdir(jd+'/iterations')]
        for kind,f in folders:
            b=os.path.join(jd,f)
            rc=load(b+'/reference-composition.json') if os.path.exists(b+'/reference-composition.json') else None
            gate=load(b+'/gate.json') if os.path.exists(b+'/gate.json') else None
            q=load(b+'/quality.json') if os.path.exists(b+'/quality.json') else None
            rows.append(dict(root=R,job=job,kind=kind,folder=f,rc=rc.get('version') if rc else None,rcRows=len(rc.get('rows',[])) if rc else 0,
              gate=(gate.get('review') or {}).get('score') if gate else None, gatePassed=gate.get('passed') if gate else None,
              q=q.get('score') if q else None,render=os.path.exists(b+'/render-scene.json'),cons=os.path.isdir(b+'/judge-consensus')))
json.dump(rows,open(sys.argv[1],'w'))
c=collections.Counter((r['kind'],bool(r['rc']),r['gate'] is not None,r['q'] is not None,r['render']) for r in rows)
for k,v in sorted(c.items(),key=lambda x:-x[1]): print(v,'kind=%s rc=%s gate=%s quality=%s render=%s'%k)
print('jobs',len({r['job'] for r in rows}),'consensus folders',sum(r['cons'] for r in rows))
print(collections.Counter(r['rc'] for r in rows if r['rc']))
