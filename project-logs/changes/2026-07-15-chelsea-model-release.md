# 2026-07-15 切尔西球衣模型替换

## 目标

替换出现透视问题的 Arsenal 展示模型，直接使用用户提供的切尔西 GLB。

## 变更

- 新增 `public/models/chelsea-jersey.glb`，SHA-256 为 `D2809DA039DB6DFF7CA407C3A027C33EC2EE883C2E84913D6467B4739FFC5003`。
- 移除不再被产品定义引用的 `public/models/arsenal-jersey.glb`。
- 产品展示标题改为 `Chelsea Match Jersey`，内部产品 ID `fn8788-jersey` 保持不变，既有本地设计文件仍可导入。
- 切尔西 GLB 主网格名为 `Cloth`，与当前贴花网格筛选规则兼容。

## 验证

- 产品定义与页面测试覆盖了新标题及新 GLB 路径。
- 发布前运行完整 Vitest 测试和 `npm run build:showcase`。
