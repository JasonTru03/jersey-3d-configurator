# 2026-08-12 Shopify App Proxy 双版本刷新

## 目标

刷新开发商店 `testcsj-secure-bundle.myshopify.com` 的既有 App Proxy 安装状态，使 `/apps/jersey-configurator` 重新绑定腾讯云服务。

## 发布前保护

- 发布前活跃版本：`phase3-test-20260810`，版本 ID `1082427277313`。
- 私有配置备份：`shopify-app/local-config/shopify.app.phase3-test.pre-proxy-refresh-20260812.toml`。
- 备份 SHA-256：`F675362FC60DCB3E1D865727A3F1C1FE84D7AB25BFD45FB869DEA4D6B5C76051`。
- `deploy:check` 通过。
- 安装 Rust 与 Visual Studio 2022 Build Tools 后，两个既有 Shopify Functions 完整构建通过。

## 已发布版本

1. `phase3-proxy-clear-20260812`
   - 版本 ID：`1085604757505`
   - 变更：临时移除 `[app_proxy]`，清除已有安装中的旧 Proxy 目标。
2. `phase3-tencent-proxy-20260812`
   - 版本 ID：`1085605314561`
   - 变更：恢复 `/apps/jersey-configurator`，目标为 `https://139.199.202.173/apps/jersey-configurator`。

第二个版本已由 Shopify CLI 确认为 active；第一个版本与原活跃版本均为 inactive。恢复后的私有配置 SHA-256 与发布前备份完全一致。

## 验证与遗留

- Shopify CLI 的版本发布与 Active 状态核验通过。
- 未修改主题、结账或订单。
- 开发商店公开请求会先跳转密码页；Chrome 自动化访问 `/apps/...` 仍被本机客户端拦截为 `ERR_BLOCKED_BY_CLIENT`，因此真实 `cart_handoff` 与购物车验证仍需在已登录且未拦截该路径的浏览器中完成。

## 回滚

如第二版出现配置问题，可在 Shopify Developer Dashboard 重新激活 `phase3-test-20260810`（版本 ID `1082427277313`）。本地私有配置可从上述备份恢复。
