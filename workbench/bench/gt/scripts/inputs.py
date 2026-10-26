# Fixed prompt template per scene: room type + categories covering >=2 objects or the 6 largest, in Chinese, no counts/positions.
import json,glob,collections,os
ZH={'chair':'椅子','sofa':'沙发','table':'桌子','bed':'床','cabinet':'柜子','door':'门','window':'窗','bookshelf':'书架','picture':'挂画','counter':'台面','blinds':'百叶帘','desk':'书桌','shelves':'置物架','curtain':'窗帘','dresser':'梳妆柜','pillow':'靠枕','mirror':'镜子','floor mat':'地毯','clothes':'衣物','books':'书','refrigerator':'冰箱','television':'电视','paper':'纸张','towel':'毛巾','box':'箱子','whiteboard':'白板','night stand':'床头柜','toilet':'马桶','sink':'水槽','lamp':'灯','bathtub':'浴缸','bag':'包','otherstructure':None,'otherfurniture':None,'otherprop':None,
 'tent':'帐篷','campfire':'篝火','tree':'松树','rock':'岩石','log':'圆木','barrel':'木桶','crate':'木箱','workbench':'工作台','fence':'木栅栏','signpost':'路标','stump':'树桩','bedroll':'睡袋'}
ROOM={'Living room':'客厅','Bedroom':'卧室','Kitchen':'厨房','Restaurant':'餐厅','Office':'办公室','Dining room':'餐厅','Hotel lobby':'酒店大堂','Retail space':'零售店铺','Lecture theater':'阶梯教室','Hallway':'走廊','Bathroom':'浴室'}
def cats(objs):
  c=collections.Counter(o['label'] for o in objs);big=sorted(objs,key=lambda o:-o['size'][0]*o['size'][1]*o['size'][2])
  keep=[l for l,n in c.items() if n>=2]+[o['label'] for o in big[:6]];seen=[]
  for l in keep:
    z=ZH.get(l)
    if z and z not in seen:seen.append(z)
  return seen
rows=[]
for f in sorted(glob.glob('gt/*.json')):
  g=json.load(open(f));imgs=[]
  for c in g['cameras']:cam,fid=c['frame'].split('/');imgs.append(os.path.abspath(f'hypersim/{g["scene"]}/images/scene_{cam}_final_preview/frame.{fid}.color.jpg'))
  rows.append({'set':'A','id':g['scene'],'kind':'ordinary','images':imgs,'prompt':f'依据参考图生成一个可从多个机位观察的完整三维室内场景：{ROOM.get(g["type"],"室内")}。保留{"、".join(cats(g["objects"]))}。'})
for f in sorted(glob.glob('voxel/vox_*.json')):
  if f.endswith('.scene.json'):continue
  g=json.load(open(f));imgs=[os.path.abspath(f'voxel/render/{g["scene"]}/capture/candidate-{i}.png') for i in (1,2)]
  rows.append({'set':'B','id':g['scene'],'kind':'voxel','images':imgs,'prompt':f'根据参考图片生成同一个体素营地 diorama：方形草地底座上保留{"、".join(cats(g["objects"]))}。'})
json.dump(rows,open('inputs.json','w'),ensure_ascii=False,indent=1)
for r in rows[:3]+rows[-2:]:print(r['set'],r['id'],r['prompt'])
print(len(rows))
