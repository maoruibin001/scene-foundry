# 规格场景光学编译与观测契约

本候选增加光学审计、程序化法线编译和受控采集状态门禁。未修改 Engine、冻结规格、几何或评分标准；不代表视觉已达70分。历史50/46/52/58分保留。

- `spec/optics.ts` 统一计算光照射程/锥体、潜在镜面热点、输出反射质量预算，以及固定 Engine 能表达的单介质光源组合。审计不自动修改输入；潜在热点的遮挡若没有测量，明确为unknown。
- `optics-audit.json` 保留光学编译选项、贴图乘数范围、生成法线的最大坡度和默认强度调整。最终shader还有mip、导数抗锯齿和粗糙度下界，输入审计不能冒充GPU测量。
- 对未指定normalStrength的程序化纹理，默认强度按原始法线最大坡度约束：光滑材质8度、其余30度。显式强度和外部PBR贴图保留；不修改输入的roughness或clearcoat。编译出的材质及`surface-optics.json`记录实际派生值。
- 水体可显式声明attenuationColor与attenuationDistance，必须同时提供且启用透射，不为旧水材质捏造吸收参数。
- 平面反射目标由输出尺寸和1280×720上限推导；雾使用固定Engine接受的有界high/64/16档，并调用实际validateRenderProfile验证。反射仍是单mip；此候选不声称实现了新的反射算法或性能优化。
- volumetric.lights可选择一盏灯，或固定Engine支持的Point+Spot组合。保持一个密度owner与一次消光；Direction+Point等不支持组合明确拒绝，不复制重叠雾冒充多光源。未声明时保持原fog.light。

采集先保留原60个真实完成帧预热，再从正常frontend插件借用实际App的只读inspectRenderer接口。每机位核对真实pose、探针发布状态、SSR稳定历史、volume accepted状态、资源版本与完成owner。Browser/Source帧号与Renderer帧号是两个命名空间，禁止直接比较。Renderer待完成列表截断、观测缺失、设备/世界变更、资源变更、未就绪或超时均不能通过，不以固定sleep替代。

回执说明的是稳定机位时对应Renderer快照已从完整待完成列表退役，同时同世界浏览器GPU完成帧推进；不制造未提供的GPU覆盖计数，不声称采样了cubemap像素或各pass辐射分量。独立视觉评审仍需要同组原图与真实截图。

真实验证固定同一份保留的58分规格，0外观修订调用，最多一次构建采集和一次cbc5/hy4flash-dev/medium评审。overall≥70、各维≥2、verdict非mismatch，评分协议不变；运行硬检查另记。观测失败就停止依赖评审，质量不达标不追加轮次。线上服务不部署本候选，未验收不合main。

外部证据目录：`/Users/maoruibin/extensions/github/critical-zerog-remake/builds/pipeline-visual-repair-20261115/optics-pipeline-repair-20261115`。定向测试与冻结规格CPU导出证据先完成，真实结果随后单列，不覆盖旧结果。
