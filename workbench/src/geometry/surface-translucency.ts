export const SURFACE_TRANSLUCENCY='surface-translucency-v1';
/** Only new ordinary jobs created under the policy receive the translucency guidance; voxel and historical jobs are unchanged. */
export function surfaceTranslucencyRule(job:any){return job?.surfaceTranslucencyPolicy===SURFACE_TRANSLUCENCY;}
// Alpha already lives in the material color's 4th channel and is exported to the Engine; the model is simply never told when to drop it below 1.
export const SURFACE_TRANSLUCENCY_GUIDANCE='surface-translucency-v1 透光表面：原图明确透光的表面——织物/膜布遮阳棚与雨棚、玻璃或阳光板、薄纱与网、浅水面——用材质 color 的第4位 alpha 表达透光，不透光表面 alpha 保持 1。参考强度：厚织物、磨砂或染色玻璃约 0.7–0.85；较薄膜布、清玻璃、细网约 0.3–0.6；只在原图可见其后方景物或透出光线时才降到 1 以下。透光面在逆光下仍偏亮，保留照片中的本体颜色与饱和度，不要用压暗 alpha 或调深颜色冒充阴影或脏旧。alpha 已随 color 导出并由 Engine 渲染；开口射线检查把 alpha>=0.95 视为不透明，因此只对真正透视的表面降 alpha，透光棚膜会让其后方在开口与遮挡检查中被看到（符合真实透光），但不能把实心墙面改成透光来伪造开口。透光是材质属性，不替代正确的几何轮廓、厚度与颜色；每个降到 1 以下的 alpha 都是估计，必须在 assumptions 中以中文标注依据，并以真实 Engine 画面为准，不预测得分。';
