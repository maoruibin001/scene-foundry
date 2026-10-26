# usage: python -I exposure.py <views.json> — reject a pair if either preview is mostly clipped white or black.
# Thresholds fixed before looking at scores: clipped-white (L>250) > 35%, or clipped-black (L<12) > 50%, or mean L < 25.
import json,sys,numpy as np
from PIL import Image
v=json.load(open(sys.argv[1]));res={}
for s,x in v.items():
  if not x:res[s]={'ok':False,'reason':'no view pair'};continue
  stats=[]
  for f in x['views']:
    cam,fid=f.split('/');L=np.asarray(Image.open(f'hypersim/{s}/images/scene_{cam}_final_preview/frame.{fid}.color.jpg').convert('L'),float)
    stats.append({'white':round(float((L>250).mean()),3),'black':round(float((L<12).mean()),3),'mean':round(float(L.mean()),1)})
  bad=[st for st in stats if st['white']>.35 or st['black']>.5 or st['mean']<25]
  res[s]={'ok':not bad,'stats':stats}
json.dump(res,open('exposure.json','w'),indent=1)
for s,r in res.items():print(s,'OK ' if r['ok'] else 'REJ',r.get('stats'))
