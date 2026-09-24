import { addChild, box, defineMaterial, emptyScene, paintSurface, sceneNode, transform } from '@forgeax/scene';

// Scene Script uses Z-up. The existing exporter owns the Engine Y-up conversion.
export function garden({ segments = 16, seed = 23 } = {}) {
  const nodes: any[] = [];
  const colors = {
    soil: [0.14, 0.075, 0.038, 1], ceramic: [0.66, 0.24, 0.095, 1],
    rim: [0.91, 0.47, 0.20, 1], metal: [0.12, 0.29, 0.33, 1],
    deck: [0.48, 0.58, 0.52, 1], root: [0.42, 0.27, 0.12, 1],
    leaf: [0.14, 0.50, 0.25, 1], marker: [0.96, 0.71, 0.18, 1],
  };
  const materials = Object.fromEntries(Object.entries(colors).map(([name, baseColor]) =>
    [name, defineMaterial({name, surface: () => ({baseColor, roughness: name === 'metal' ? 0.35 : 0.85, metallic: name === 'metal' ? 0.55 : 0})})]));
  function add(name: string, geometry: any, material: string) {
    const painted = paintSurface({ geometry, material: materials[material] });
    nodes.push(sceneNode({ name, key: name, geometry: painted }).scene);
  }
  function slab(name: string, w: number, d: number, h: number, x: number, y: number, z: number, material: string, yaw = 0) {
    add(name, transform({geometry: box({width:w, depth:d, height:h}), x,y,z,yaw}), material);
  }
  // Frustum between arbitrary endpoints; plain geometry keeps creation model-neutral.
  function branch(name: string, a: number[], b: number[], r0: number, r1: number, material: string, sides=8) {
    const axis = b.map((v,i)=>v-a[i]); const length = Math.hypot(...axis); const n=axis.map(v=>v/length);
    const ref=Math.abs(n[2])>0.9?[1,0,0]:[0,0,1];
    const u=[n[1]*ref[2]-n[2]*ref[1],n[2]*ref[0]-n[0]*ref[2],n[0]*ref[1]-n[1]*ref[0]];
    const ul=Math.hypot(...u); for(let k=0;k<3;k++)u[k]/=ul;
    const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
    const positions:number[]=[],indices:number[]=[];
    for(let j=0;j<2;j++)for(let i=0;i<sides;i++) {
      const theta=i/sides*Math.PI*2, r=j?r1:r0, c=j?b:a;
      positions.push(...c.map((q,k)=>q+r*(Math.cos(theta)*u[k]+Math.sin(theta)*v[k])));
    }
    for(let i=0;i<sides;i++){const next=(i+1)%sides;indices.push(i,next,sides+i,next,sides+next,sides+i);}
    for(let i=1;i<sides-1;i++){indices.push(0,i+1,i,sides,sides+i,sides+i+1);}
    add(name,{kind:'mesh',positions,indices},material);
  }
  slab('inspection-plinth',28,28,0.7,0,0,-0.7,'deck');
  branch('soil-bed',[0,0,0],[0,0,3.2],4.4,5.1,'soil',segments);
  for(let i=0;i<segments;i++){
    const a=i/segments*Math.PI*2, x=Math.cos(a),y=Math.sin(a);
    slab('ceramic-panel-'+i,2.15,0.5,3.5,5*x,5*y,0,'ceramic',a+Math.PI/2);
    slab('thick-rim-'+i,2.3,0.85,0.55,5.15*x,5.15*y,3.4,'rim',a+Math.PI/2);
  }
  branch('trunk-base',[0,0,3],[0.5,0,8],1.25,0.9,'root');
  branch('trunk-crown',[0.5,0,8],[-0.3,0.7,13],0.9,0.5,'root');
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2+seed*0.03, x=Math.cos(a),y=Math.sin(a);
    branch('exposed-root-'+i,[0,0,4.4],[4.4*x,4.4*y,3.1],0.6,0.17,'root');
    branch('leaf-stem-'+i,[0.2,0.3,9+i*0.6],[4*x,4*y,10+i*0.65],0.18,0.07,'leaf');
    branch('leaf-blade-'+i,[2*x,2*y,10+i*0.65],[6*x,6*y,11+i*0.65],1.15,0.025,'leaf',5);
  }
  for(let i=0;i<4;i++){
    const a=i/4*Math.PI*2+0.3,x=Math.cos(a)*8,y=Math.sin(a)*8;
    slab('inspection-deck-'+i,4,2.8,0.4,x,y,2.3,'metal',a);
    for(const s of [-1,1]){
      slab('support-'+i+'-'+s,0.38,0.38,6.8,x+s*1.2,y,0,'metal');
      slab('warning-cap-'+i+'-'+s,0.65,0.65,0.55,x+s*1.2,y,6.8,'marker');
    }
    slab('handrail-'+i,4,0.18,0.18,x,y+1.2,3.7,'marker',a);
  }
  return addChild({scene:emptyScene(),nodes});
}
