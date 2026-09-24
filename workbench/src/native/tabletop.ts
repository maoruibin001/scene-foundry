// 卡座桌面的真实局部尺寸与物件占地；先满足支撑、净距，再构造网格。
export const BOOTH_BASE=[2.22,2,1.08] as const;
export const TABLE_HALF=[.55,.88] as const;
export const TABLE_SURFACE=.872;
export const TABLE_ITEMS_EXTENT=[-.245,-.075,.37,.075] as const;
export function resolveTabletopItems(layout:any){
 for(const table of layout.assets.filter((n:any)=>n.kind==='booth_set')){
  const sx=table.size[0]/BOOTH_BASE[0],sy=table.size[1]/BOOTH_BASE[1];
  const occupied=layout.assets.filter((n:any)=>n.support?.assetId===table.id).map((n:any)=>{
   const dx=n.position[0]-table.position[0],dy=n.position[1]-table.position[1],c=Math.cos(table.rotation),s=Math.sin(table.rotation),a=n.rotation-table.rotation;
   const x=(dx*c+dy*s)/sx,y=(-dx*s+dy*c)/sy;
   const rx=(n.kind==='fallen_lamp'?Math.hypot(Math.cos(a)*n.size[0],Math.sin(a)*n.size[1]):Math.abs(Math.cos(a))*n.size[0]+Math.abs(Math.sin(a))*n.size[1])/2/sx,ry=(n.kind==='fallen_lamp'?Math.hypot(Math.sin(a)*n.size[0],Math.cos(a)*n.size[1]):Math.abs(Math.sin(a))*n.size[0]+Math.abs(Math.cos(a))*n.size[1])/2/sy;
   if(Math.abs(x)+rx>TABLE_HALF[0]+.001||Math.abs(y)+ry>TABLE_HALF[1]+.001)throw Error(n.id+' 超出卡座桌面边界');
   return [x-rx,y-ry,x+rx,y+ry];
  });
  const candidate=[[-.23,.65],[-.23,-.65]].find(([x,y])=>{
   const b=TABLE_ITEMS_EXTENT.map((v,i)=>v+(i%2?y:x));
   return b[0]>=-TABLE_HALF[0]&&b[2]<=TABLE_HALF[0]&&b[1]>=-TABLE_HALF[1]&&b[3]<=TABLE_HALF[1]&&occupied.every(o=>b[2]+.04<=o[0]||b[0]-.04>=o[2]||b[3]+.04<=o[1]||b[1]-.04>=o[3]);
  });
  if(!candidate)throw Error(table.id+' 桌面物件没有可用净距');
  table.tableItemsPosition=candidate;
  table.tableContactAreas=[...occupied,TABLE_ITEMS_EXTENT.map((v,i)=>v+candidate[i%2])];
  table.tableLitterKeepClear=[table.tableContactAreas.at(-1)];
  table.tableLitterLampAreas=occupied;
  delete table.tableCupPosition;
  if(layout.assets.some((n:any)=>n.kind==='fallen_lamp'&&n.support?.assetId===table.id)){
   const cup=[[.24,-.30],[-.25,-.30],[.24,.30],[-.25,.30]].find(([x,y])=>{
    const b=[x-.12,y-.15,x+.12,y+.15];
    return table.tableContactAreas.every((o:number[])=>b[2]+.025<=o[0]||b[0]-.025>=o[2]||b[3]+.025<=o[1]||b[1]-.025>=o[3]);
   });
   if(!cup)throw Error(table.id+' 倒杯没有可用净距');
   table.tableCupPosition=cup;
   const b=[cup[0]-.12,cup[1]-.15,cup[0]+.12,cup[1]+.15];
   table.tableContactAreas.push(b);table.tableLitterKeepClear.push(b);
  }
 }
 return layout;
}
