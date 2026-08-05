# 2026-08-05 对话摘要：Phase 3 免费方案

用户在阶段 3 上线准备中询问是否有免费方案，并选择“1”继续实施。

本轮决定使用 Cloudflare Workers Free + R2 Standard 免费额度的试运行架构：浏览器本地生成并校验七文件生产包，Worker 通过三步同源协议把 manifest 和 ZIP 流式写入 R2，D1 保存声明和订单关联状态。该方案避免 Worker 对大文件进行 multipart 解析、哈希和重建 ZIP，从而按 10ms CPU 预算设计。

本轮只完成本地代码、测试、构建、migration 本地验证和 Wrangler dry-run。没有启用线上 R2、写入远程 D1、修改 secret、部署 Worker/Shopify App、注册 webhook 或发起支付。后续线上动作需要用户另行明确确认。
