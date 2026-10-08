export function orthographicBounds(view: any) {
  const height = view.orthographicHeight, aspect = view.frame ? view.frame.width / view.frame.height : 16 / 9;
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(aspect) || aspect <= 0) throw Error("体素正交相机范围无效");
  return { left: -height * aspect / 2, right: height * aspect / 2, bottom: -height / 2, top: height / 2, near: .1, far: 1000 };
}
/** Extend the fixed Engine's camera route only when an authored view requests orthographic projection. */
export function voxelProjection(world: string, controller: string, views: any[]) {
  if (!views.some(view => view.projection === "orthographic")) return { world, controller };
  world = world.replace("Skylight, perspective", "Skylight, perspective, orthographic")
    .replace("SpotLight, perspective", "SpotLight, perspective, orthographic")
    .replace("PointLight, perspective", "PointLight, perspective, orthographic");
  const first = views[0];
  if (first.projection === "orthographic") {
    const expression = /perspective\(\{fov:[^,}]+,aspect:16\/9,near:0\.1,far:1000\}\)/;
    if (!expression.test(world)) throw Error("固定 Engine 相机模板变化，未应用体素正交投影");
    world = world.replace(expression, "orthographic(" + JSON.stringify(orthographicBounds(first)) + ")");
  }
  const old = "if(audit.views[selected].fov)ctx.world.set(camera,Camera,{fov:audit.views[selected].fov}).unwrap();";
  if (!controller.includes(old)) throw Error("固定 Engine 机位切换模板变化");
  const replace = `const v=audit.views[selected] as any;if(v.projection==='orthographic'){const h=v.orthographicHeight,a=v.frame?v.frame.width/v.frame.height:16/9;ctx.world.set(camera,Camera,{projection:1,fov:0,left:-h*a/2,right:h*a/2,bottom:-h/2,top:h/2,near:.1,far:1000}).unwrap();}else if(v.fov)ctx.world.set(camera,Camera,{projection:0,fov:v.fov}).unwrap();`;
  return { world, controller: controller.replace(old, replace) };
}
