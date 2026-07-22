# 连续底纹投影与 UV Atlas 烘焙设计

**日期：** 2026-07-22

**状态：** 已确认，待实现
**范围：** `jersey-3d-configurator` 的整件球衣底纹编辑、设计文件保存和 Shopify 生产交接。

## 1. 已确认的产品决策

1. 底纹覆盖整件球衣：正面、背面、双袖、肩侧和领口所属的布料网格。
2. 底纹采用一套连续参数，不允许首版按正面/背面/袖子分别调整。
3. 编辑时位置、缩放、旋转和重复密度以模型自身坐标为基准，不以原有 UV 岛为操作坐标。
4. 用户在 3D 预览中看到的效果，点击保存或加入购物车后，必须被烘焙成与该预览一致的 UV Atlas。
5. 设计 JSON 保存可编辑的参数和资源引用；生产交接保存实际烘焙生成的 PNG、设计编号和校验值。

## 2. 当前状态与问题

`src/features/configurator/scene/garmentAppearanceTexture.js` 目前通过 `UV_REGIONS` 把颜色模板直接画入固定二维 UV 多边形，`garmentRenderer.js` 再把该 Canvas 作为模型材质贴图。

这让条纹、渐变等模板的起点和尺寸由每个 UV 岛的边界决定：前后片、袖子和肩侧并非同一个连续图案空间。直接把完整 PNG 放入 Shopify 购物车属性也不合适：当前 `cartHandoff.js` 仅传递小型文本配置，且 URL/购物车属性不适合承载图像二进制。

## 3. 推荐架构

### 3.1 单一的模型空间投影

新增 `bottomPattern` 状态，使用球衣标准化包围盒作为稳定坐标系。对每个布料顶点的模型局部坐标 `(x, y, z)` 计算连续的圆柱投影坐标：

```text
angleU = atan2(x - centerX, z - centerZ) / (2 * PI) + 0.5
heightV = (y - minY) / (maxY - minY)

projectedUV = rotate(scale * [angleU, heightV] + offset, rotation)
```

- `offset`：用户在编辑器拖动底纹时更新的二维偏移；
- `scale`：图案尺寸/密度；
- `rotation`：图案绕模型纵轴的旋转；
- 输入图片使用 repeat wrapping，因此 `angleU` 从 1 回到 0 时仍保持连续重复；
- 这套计算只使用模型空间和用户参数，原模型 UV 只在最终输出 Atlas 时作为“落图坐标”。

需要为 GLB 的实际朝向建立 `modelProjection` 配置（中心、竖直轴、正面角度和覆盖网格名单），并用当前 `chelsea-jersey.glb` 的实际顶点/法线验证。配置与底纹数据一起版本化，避免未来更换模型时静默错位。

### 3.2 编辑预览

新增 `BottomPatternEditor`，提供：启用开关、图片/预设选择、拖动、缩放、旋转、重复密度和重置。它更新唯一的 `bottomPattern.transform`。

`garmentRenderer` 为所有 `decorationMeshes` 应用模型空间投影材质（优先以 Three.js shader material / `onBeforeCompile` 实现），而不是修改原始几何 UV。相机旋转不会改变投影位置；前后/袖子共享同一图案坐标，达到“整块布包住球衣”的效果。

### 3.3 确定性 UV Atlas 烘焙

新增 `bottomPatternBaker`：

1. 读取与预览相同的源图片、`bottomPattern.transform`、`modelProjection` 和投影算法版本。
2. 对每个布料三角形，以原始几何 UV 为输出位置、以模型空间投影坐标为采样位置，离屏渲染到 2048 × 2048 Canvas/WebGL RenderTarget。
3. 按现有 UV 岛形状写入 Atlas，并保留透明背景/边缘扩展（padding），减少 MIP 采样在 UV 边缘产生的接缝。
4. 将 Atlas 回设为预览材质并比较多视角截图/像素采样，确保烘焙结果与编辑预览一致。
5. 产出 `image/png` Blob、SHA-256、尺寸、`projectionVersion` 和设计状态快照。

预览与烘焙必须调用同一个投影函数和同一版本配置；任何参数变更使上一份 Atlas 失效。首版目标是 2048px，后续可为生产端增加 4096px 导出，而不改变编辑数据结构。

## 4. 数据契约

### 4.1 前端状态与 JSON 设计文件

```json
{
  "overrides": {
    "bottomPattern": {
      "enabled": true,
      "source": {
        "kind": "preset",
        "id": "diagonal-gold",
        "assetRef": "pattern:diagonal-gold"
      },
      "transform": {
        "offset": { "u": 0, "v": 0 },
        "scale": 1,
        "rotationDeg": 0,
        "repeat": { "u": 3, "v": 4 }
      },
      "projectionVersion": 1,
      "modelProjectionId": "chelsea-jersey-cylindrical-v1"
    }
  }
}
```

- `source.kind = preset`：设计文件保存稳定的预设 ID；
- `source.kind = uploaded`：保存受控资源 ID 和内容哈希，不把 Data URL 写入 JSON；
- 旧设计文件缺少 `bottomPattern` 时，归一化为 `enabled: false`，保持兼容；
- 设计文档版本从 1 升至 2，并保留 v1 读取迁移。

### 4.2 生产资产和购物车属性

在用户点击“加入 Shopify 购物车”前完成烘焙和上传：

```json
{
  "designId": "dsg_xxx",
  "atlasUrl": "https://assets.example/designs/dsg_xxx/uv-atlas.png",
  "atlasSha256": "...",
  "atlasSize": 2048,
  "projectionVersion": 1
}
```

购物车行项目属性只保存 `Design ID`、`UV Atlas URL`、`UV Atlas SHA-256` 和 `Projection Version`；生产端通过设计编号读取完整状态与 PNG。不得把图片 Base64、访问令牌或大体积 JSON 放入 URL 或 Shopify 属性。

当前 Cloudflare Worker 是静态资源 Worker。实现生产交接时需新增受控的设计资产 API 和对象存储绑定（例如 R2），由服务端生成设计 ID 和可读资产 URL；该能力作为本方案第二实施阶段，不改变现有商品/变体映射。

## 5. 用户流程

1. 用户在“底纹”面板选预设或上传图片，开启连续底纹。
2. 在 3D 模型上拖动、缩放、旋转；每次变化都更新同一套整衣参数和实时预览。
3. 点击 **Save design**：下载可编辑 JSON；若底纹启用，先本地烘焙并校验，再把参数、资源引用和烘焙元数据写入 JSON（PNG 本身由资源 ID 指向）。
4. 点击 **Add to Shopify cart**：确保 Atlas 为最新版本；上传 Atlas 与设计状态，取得设计资产引用后跳转 Shopify 购物车。
5. 生产人员根据购物车行项目属性读取 Atlas，直接用于 UV 切片生产。

## 6. 实施边界与文件落点

| 文件/模块 | 变更职责 |
| --- | --- |
| `config/appearance.js` | 底纹状态常量、默认值、输入归一化与版本迁移 |
| `config/state.js` | 深合并 `bottomPattern.transform` |
| `scene/modelProjection.js`（新增） | GLB 网格筛选、模型空间投影、投影配置 |
| `scene/bottomPatternBaker.js`（新增） | 离屏 UV Atlas 烘焙与哈希输入 |
| `scene/garmentAppearanceTexture.js` | 保留基础外观画布；移除其对连续底纹定位的职责 |
| `scene/garmentRenderer.js` | 预览材质、Atlas 生命周期、参数同步 |
| `ui/BottomPatternPanel.jsx`（新增） | 底纹素材与变换控件 |
| `ui/ConfiguratorPage.jsx` | 面板接入、保存/加购的异步状态与错误展示 |
| `designs/designDocument.js` | v2 设计文档及 v1 迁移 |
| `shopify/cartHandoff.js` | 仅接收已上传的设计资产引用 |
| Cloudflare Worker（新增 API） | Atlas/设计状态上传与读取 |

## 7. 验收与测试

1. 旋转相机、切换正背面或袖子时，底纹位置固定在衣服上，不随屏幕移动。
2. 拖动一次底纹后，正面、背面、袖子和肩侧均按一套连续规律变化。
3. 使用包含高对比斜线、文字和边缘元素的测试图，验证每个 UV 岛中的烘焙结果与 3D 预览一致。
4. 对不同旋转、缩放、重复密度和偏移生成 Atlas，验证哈希与状态一致、变更后哈希变化。
5. 保存后重新打开 JSON，渲染结果一致；读取旧 v1 JSON 保持既有外观。
6. 加购前先完成资产上传；购物车行项目只出现设计引用和校验值，不含图像二进制。
7. 覆盖单元测试、投影/烘焙集成测试、设计文件迁移测试和真实 Shopify 加购回读。

## 8. 风险与缓解

- **GLB UV 重叠或错误网格被纳入：** 在实施前做网格/UV 诊断，显式白名单布料网格。
- **圆柱投影在腋下或领口变形：** 首版以连续底纹为目标；若真实模型验证出现明显失真，再按同一语义坐标体系加入局部投影校正配置。
- **上传素材跨会话失效：** 上传后立即生成受控资源 ID；本地临时预览资源与生产资产分离。
- **WebGL/Canvas 兼容性与性能：** 交互阶段限制预览纹理尺寸，保存/加购阶段在后台烘焙 2048px 并展示进度。

## 9. 非目标

- 首版不开放每个面片各自不同的底纹变换。
- 首版不改变现有徽章、文字/号码贴花的编辑方式。
- 首版不把生产图片塞进设计 JSON 或 Shopify URL。
