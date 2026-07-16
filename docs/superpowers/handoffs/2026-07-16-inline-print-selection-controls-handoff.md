# Name Set 贴边选中控件交接记录

日期：2026-07-16  
分支：`codex/inline-print-selection-controls`  
状态：已合入 `showcase`、已发布并完成公开静态资源验证

## 用户可见变化

- Name Set 未被点击时，只显示球衣上的文字/号码，不显示选中框或操作按钮。
- 点击 3D 文字后，显示紧贴该文字投影边界的细边框。
- 五个操作按钮围绕边框放置：左上编辑、右上顺时针旋转、左下删除、下中复制（`×2`）、右下缩放。
- 点击未命中 Name Set 的球衣区域会清除选中状态并隐藏覆盖层。
- 复制的新 Name Set 会自动成为选中项；删除会清除选中状态。删除最后一个 Name Set 后，重新选择 `Name set` 仍可创建默认 `PLAYER / 16`。

## 实现范围

- `src/features/configurator/scene/garmentRenderer.js`
  - 从“投影平面中心锚点”改为“投影平面四角矩形”。
  - 仅在矩形变化时通知 React。
  - 未命中 Name Set 的指针操作会发出取消选择事件。
- `src/features/configurator/scene/ProductStage.jsx`
  - 分离当前编辑项与用户显式选中项，防止初始自动显示工具框。
  - 复制、删除和状态变化均同步清理或更新选择状态。
- `src/features/configurator/scene/PrintToolbarOverlay.jsx`
  - 使用边框和五个独立角落按钮替换旧的侧边网格面板。
- `src/features/configurator/ui/configurator.css`
  - 边框不拦截画布手势，只有实际按钮接受指针事件。
- 对应 Vitest 测试已更新，另修正 `ConfiguratorPage` 的渲染器 mock，使其模拟新的直接选择事件。

## 验证证据

| 项目 | 结果 |
| --- | --- |
| 基线测试 | 18 个测试文件、59 个测试通过 |
| 最终测试 | 18 个测试文件、60 个测试通过 |
| Showcase 构建 | `npm run build:showcase` 成功 |
| 本地页面 | `http://127.0.0.1:5174/` 返回 HTTP 200，页面标题为 `3D Product Configurator` |
| 控制台 | 自动化浏览器未捕获 error 级日志 |
| Bundle 提示 | Vite 仍提示压缩后主 chunk 超过 500 kB；为既有非阻塞提示，本次未改动拆包策略 |

## 手工验收限制与待办

自动化浏览器环境未提供可用 WebGL，因此本地页面展示 `3D` fallback，无法自动点击真实球衣上的 Name Set。上线前或合入后需在具备 WebGL 的桌面浏览器手工确认：

1. 未点击文字时无边框和按钮。
2. 点击 Name Set 后边框紧贴文字，五个按钮都可用。
3. 点击球衣空白区域后控件消失。
4. 拖动、旋转、缩放 Name Set 与旋转球衣/相机时，边框和按钮跟随。
5. 复制后新副本被选中；删除后重新选择 `Name set` 可创建默认项。
6. 在移动端视口中，按钮仍可触达且不遮挡右侧配置面板。

## Git 与发布

本功能检查点已推送到：

- `origin`：`JasonTru03/jersey-3d-configurator`
- `backup`：`SuJianben/Custom-made-jerseys`

已在用户授权后合入并推送 `showcase`，合并提交为 `49aca14 merge: inline name set selection controls`。Cloudflare 的生产分支为 `showcase`，公开地址为：

`https://jersey-3d-configurator.jason1064969838.workers.dev/`

发布后验证结果：公开首页 HTTP 200，引用 `index-BS59VOV-.js`；该线上脚本包含 `print-selection-frame`、`Duplicate print` 和 `Selected print controls` 标识，确认本次贴边选中控件资源已部署。

若需要回退，不改写历史：对 `49aca14` 执行保留主线的 revert，再推送 `showcase`，并重新验证公开地址。
