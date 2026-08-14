# 2026-08-13 Shopify client-credentials Token 兼容

## 目标

让店铺配置工具接受 Shopify 2026 client-credentials grant 返回的短期 Admin
Token 格式。

## 修改

- `shopify-app/scripts/store-config-core.mjs`：Admin Token 白名单增加 `shpca_`
  前缀，同时保留既有 `shpat_` 与 `shpua_`。
- `shopify-app/scripts/store-config.test.mjs`：增加 client-credentials Token
  回归测试。

## 验证

- `npm run test:store-config`：13/13 通过。
- 测试和日志均未输出真实 Token。

## 影响与回滚

- 只扩展受控 Token 前缀，不改变 GraphQL 请求、店铺配置或 secret 存储。
- 回滚时恢复上述两个文件即可；无数据库或远程配置变更。

