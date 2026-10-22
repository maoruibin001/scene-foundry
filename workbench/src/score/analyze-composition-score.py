# python3 analyze-composition-score.py <validation.json>
import json,statistics as S,collections,math,sys
d=json.load(open(sys.argv[1]))
def rank(x):
    o=sorted(range(len(x)),key=lambda i:x[i]);r=[0]*len(x);i=0
    while i<len(x):
        j=i
        while j+1<len(x) and x[o[j+1]]==x[o[i]]: j+=1
        for k in range(i,j+1): r[o[k]]=(i+j)/2
        i=j+1
    return r
def pear(a,b):
    ma,mb=S.mean(a),S.mean(b);sa=math.sqrt(sum((x-ma)**2 for x in a));sb=math.sqrt(sum((y-mb)**2 for y in b));return sum((x-ma)*(y-mb) for x,y in zip(a,b))/(sa*sb)
sp=lambda a,b:pear(rank(a),rank(b))
def auc(pos,neg):
    return sum((p>n)+.5*(p==n) for p in pos for n in neg)/(len(pos)*len(neg)) if pos and neg else None
print('candidates',len(d),'jobs',len({r['job'] for r in d}),'reproduced',sum(r.get('reproduced',False) for r in d),'errors',sum('recomputeError' in r for r in d))
v=[r for r in d if r['stored']['score'] is not None]
print('scored',len(v),'coverage median',round(S.median(r['stored']['coverage'] for r in v),2),'mean',round(S.mean(r['stored']['coverage'] for r in v),2))
# 1 judge noise
rep=[r for r in d if r.get('replicas') and len(r['replicas'])>=2 and all(x['score'] is not None for x in r['replicas'])]
rng=[max(x['score'] for x in r['replicas'])-min(x['score'] for x in r['replicas']) for r in rep]
sd=[S.pstdev([x['score'] for x in r['replicas']]) for r in rep]
pd=sum(len({x['passed'] for x in r['replicas']})>1 for r in rep)
fd=sum(len({x['failed']>0 for x in r['replicas']})>1 for r in rep)
print('\n[1] judge replicas: candidates',len(rep),'score range mean',round(S.mean(rng),3),'max',max(rng),'sd mean',round(S.mean(sd),3),'| pass/fail disagree',pd,'| failed-critical-relation presence disagree',fd)
print('    range distribution',collections.Counter(round(x,1) for x in rng))
# 2 agreement
a=[r['stored']['score'] for r in v];b=[r['judge'] for r in v]
print('\n[2] program vs judge: spearman',round(sp(a,b),3),'pearson',round(pear(a,b),3))
for ver in sorted({r['version'] for r in v}):
    vv=[r for r in v if r['version']==ver]
    if len(vv)>5: print('   ',ver,len(vv),'spearman',round(sp([r['stored']['score'] for r in vv],[r['judge'] for r in vv]),3))
# within job consecutive
byjob=collections.defaultdict(list)
for r in v: byjob[(r['root'],r['job'])].append(r)
agree=dis=tie=0;pairs=[]
for k,rs in byjob.items():
    rs.sort(key=lambda r:int(r['round'].split('/')[-1]))
    for x,y in zip(rs,rs[1:]):
        dj=y['judge']-x['judge'];dp=y['stored']['score']-x['stored']['score'];pairs.append((dp,dj))
        if abs(dj)<1e-9: tie+=1
        elif dj*dp>0: agree+=1
        else: dis+=1
print('    within-job round deltas: agree',agree,'disagree',dis,'judge-tie',tie, 'spearman of deltas',round(sp([p[0] for p in pairs],[p[1] for p in pairs]),3) if len(pairs)>3 else None)
# pass discrimination
print('    AUC program score: passed vs failed rounds',round(auc([r['stored']['score'] for r in v if r['passed']],[r['stored']['score'] for r in v if not r['passed']]),3),'(passed',sum(r['passed'] for r in v),'failed',sum(not r['passed'] for r in v),')')
# 3 probes
print('\n[3] corruption probes (program):')
for name in ['delete','move','shrink','camera','mirror']:
    ps=[r for r in d if 'probe_'+name in r and 'error' not in r['probe_'+name] and r['stored']['score'] is not None]
    err=sum('probe_'+name in r and 'error' in r['probe_'+name] for r in d)
    drops=[r['probe_'+name]['drop'] for r in ps]
    tgt=[r for r in ps if r['probeTarget'].get('baseFit') is not None and r['probe_'+name]['targetFit'] is not None]
    tdrop=[r['probeTarget']['baseFit']-r['probe_'+name]['targetFit'] for r in tgt]
    miss=sum((r['probe_'+name].get('criticalMisses') or 0)>(r.get('baseCriticalMisses') or 0) for r in ps)
    print('   %-7s n=%3d err=%d | total drop>0: %3d (%.0f%%) median %.1f | drop>=5: %.0f%% | target fit drop>=0.2: %.0f%% | criticalMisses+: %.0f%%'%(name,len(ps),err,sum(x>0 for x in drops),100*sum(x>0 for x in drops)/max(1,len(ps)),S.median(drops) if drops else float('nan'),100*sum(x>=5 for x in drops)/max(1,len(ps)),100*sum(x>=.2 for x in tdrop)/max(1,len(tdrop)),100*miss/max(1,len(ps))))
