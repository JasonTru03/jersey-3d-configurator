# 2026-08-12 多 Shopify 店铺后台部署结果

## 部署结果

- 上线前备份：`/opt/jersey/backups/20260812-162356-pre-multishop`，包含应用目录、私有环境配置、SQLite 与对象目录快照，以及旧 Docker 镜像回滚标签。
- 差异包 SHA-256：`e7931f2c8cc8c4ba8bf4111f7e29608fc2f125b2e4ab00ada1a72fe76c82031d`。
- 服务器已配置 `jersey-configurator-test.myshopify.com` 与 `testcsj-secure-bundle.myshopify.com`，默认后台店铺改为后者。
- Docker 镜像重建成功，容器 `app-jersey-server-1` 状态为 `healthy`；容器内和公网 `/healthz` 均返回成功。
- 使用服务端签名会话真实调用后台 API：会话返回两家白名单店铺，两店订单查询均返回 HTTP 200，跨店查询隔离生效。

## `#1001` 验证

- 两家店铺查询 `#1001` 均返回 0 条。
- SQLite 只存在旧店铺的 2 个 `cart_draft`，没有新店铺草稿或已绑定设计。
- 这说明 `#1001` 在付款前没有把生产设计写入腾讯云，因此无法仅凭历史订单自动补出 ZIP；这不是后台店铺筛选问题。

## 后续事项

- Shopify CLI 只读回读确认 `phase3-test-20260810` 是当前 active App 版本，配置包含 `orders/paid`、`orders/cancelled` 和 `refunds/create` webhook；该版本创建于 `2026-08-10 05:42:39`。
- 用户截图中的 `#1001` 创建时间为当天 `03:42`，早于上述 App 版本启用，因此该历史订单不会被后来启用的 webhook 自动重放。
- 让新店铺的 3D 定制器先把生产包保存到腾讯云服务器。
- 确认 Shopify App 的 `orders/paid` webhook 指向腾讯云服务器并已在新店铺启用。
- 完成上述两项后，创建一笔新的测试订单，验证草稿保存、付款绑定、后台显示与 ZIP 下载完整链路。
