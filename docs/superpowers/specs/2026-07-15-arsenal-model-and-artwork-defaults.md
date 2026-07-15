# 阿仙奴球衣模型与默认贴花位置

日期：2026-07-15  
状态：已确认，待实施  
分支：`codex/arsenal-model-artwork-defaults`

## 目标

- 使用用户提供的阿仙奴 GLB 作为独立定制器展示模型，标题显示为 `Arsenal Match Jersey`。
- 保持现有内部产品 ID `fn8788-jersey`，使此前保存的设计 JSON 仍可导入。
- 修复同一部位连续添加素材时完全重叠的问题；Golden Stripe、Night Grid 等新增后必须能看见。
- 将贴花和文字印花的可命中网格限定为球衣布料，排除阿仙奴模型中的 `Topstitch` 缝线网格。

## 已确认事实

- 用户提供的 `阿仙奴球衣GLB模型.glb` 是 GLB 2.0，约 12.97 MB，含 13 个网格、12 个材质、纹理和一个动画。
- 其中有一个 `Cloth_mesh` 和多条 `Topstitch_*` 网格。现有模型也使用 `Cloth_mesh`，可作为跨模型的稳定布料选择规则。
- 当前 `getDefaultDecorationPlacement` 对同一 `region` 始终返回同一个中心射线命中点；多次添加会在相同位置重叠，后添加的素材遮挡先添加的素材。

## 方案

### 模型接入

- 将 GLB 复制到 `public/models/arsenal-jersey.glb`；保留旧模型文件，便于本地回退。
- 在 `productDefinitions.js` 只更新展示名称和 `model.glbUrl` / `assetName`；不变更 `id`、价格、选项或设计文件版本。
- `GarmentRenderer` 保留所有网格用于可见渲染，但额外维护 `decorationMeshes`：优先选择名称匹配 `cloth|fabric|body` 的网格；没有匹配时才回退全部网格。
- Artwork 与文字印花的射线检测使用 `decorationMeshes`，避免细缝线截获射线并产生不可见的小贴花。

### 默认位置分布

- 为每个区域生成固定顺序的九个局部偏移候选：中心、左上、右上、左中、右中、左下、右下、上中、下中。
- 每个候选从区域法线方向朝球衣布料射线检测，得到真实网格交点和法线。
- 新增或旧设计迁移时，跳过与同区域既有贴花位置距离小于贴花最小间距的候选，选择第一个空位；全部被占用时回退中心候选，不丢失用户添加动作。
- 用户拖动后保存的 `placement` 不被自动重排；切换区域后才按新区域重新分配默认位置。

## 不做的事情

- 不删除旧 GLB，不调整定价、购物车、Checkout、Shopify 嵌入页或支付。
- 不修改阿仙奴原始纹理文件，不新增 UV 编辑器。
- 不自动改变用户已保存的有效 `placement`，仅迁移缺失或区域不匹配的位置。

## 验收

- 模型文件存在于公开资源目录，产品配置指向它，展示名称正确，内部产品 ID 不变。
- 对同一区域连续添加 Golden Stripe、Night Grid、Crest Badge 时，三者的 `placement.position` 不相同，且都会被渲染。
- `Topstitch_*` 网格不进入贴花目标网格列表，`Cloth_mesh` 会进入。
- 旧设计 JSON 可导入，新素材可保存并恢复。
- 每阶段均运行目标 Vitest 测试；最终运行 `npm test`、`npm run build:showcase`，并在合入 `showcase` 后检查公开地址。

## 风险与回退

阿仙奴模型体积约为现有模型的 22 倍，首次网络加载会变慢。保留旧 GLB 和每阶段独立提交；若公开站异常，可回退 `showcase` 的合并提交而不改写历史。
