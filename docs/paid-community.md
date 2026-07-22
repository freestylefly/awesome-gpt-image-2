# GPT-Image2 付费交流群上线手册

当前实现将付费群与积分包、会员支付完全分离：支付宝一次性支付 `¥9.90` 后，资格绑定 Supabase 用户账号；只有服务端确认订单为 `PAID` 时才能读取受保护群二维码。

## 本地能力

- 页面：`/community`
- 支付回跳：`/community/result`
- 支付方式：支付宝网站支付 `alipay.trade.page.pay`
- 固定金额：`990` 分，`CNY`
- 订单状态：`PENDING`、`PAID`、`CLOSED`、`REFUNDED`、`REVOKED`
- 退款处理状态：`NONE`、`PROCESSING`、`SUCCEEDED`、`FAILED`
- 资格规则：仅 `PAID` 有效；退款处理中保持 `PAID`；支付宝确认退款成功后改为 `REFUNDED`
- 群码：数据库 `bytea` 资源，限 PNG/JPEG/WebP、最大 2 MB，管理员通过事务 RPC 原子替换

## API

公开与当前用户：

- `GET /api/community/config`
- `GET /api/community/status`
- `GET /api/community/qr`

支付宝：

- `POST /api/community/alipay/checkout`
- `GET /api/community/alipay/query`
- `POST /api/community/alipay/close`
- `POST /api/community/alipay/notify`

超级管理员：

- `GET /api/admin/community/orders`
- `GET|POST /api/admin/community/qr`
- `POST /api/admin/community/refund`
- `GET /api/admin/community/refund-query`
- `POST /api/admin/community/revoke`

## 环境变量

生产部署必须先保持：

```dotenv
COMMUNITY_PAYMENT_ENABLED=false
COMMUNITY_ALIPAY_NOTIFY_URL=https://gpt-image2.canghe.ai/api/community/alipay/notify
COMMUNITY_SUPPORT_TEXT=微信搜索苍何
```

支付宝生产变量沿用现有 `ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY`、`ALIPAY_SELLER_ID` 和生产网关配置。生产私钥只在 Vercel Sensitive Environment Variables 中配置，不写入仓库、文档或对话。

## 首次部署顺序

1. 保持 `COMMUNITY_PAYMENT_ENABLED=false`。
2. 在目标 Supabase 项目应用 `supabase/migrations/20260722090000_paid_community.sql`。
3. 部署同一版本代码，确认 `/community`、`/community/result` 和只读状态接口正常。
4. 由 `super_admin` 在管理面板上传一张从未公开过的新群二维码。
5. 在支付宝开放平台完成网站支付签约、应用配置与发布，并确认公网 HTTPS 通知地址无重定向。
6. 配置属于同一生产应用的 App ID、应用公钥、应用私钥和支付宝公钥；Node.js 使用 PKCS#1 私钥原文。
7. 开启 `COMMUNITY_PAYMENT_ENABLED=true`。
8. 用同一生产版本完成一笔真实 `¥9.90` 付款和原路退款验收。

## 生产验收

真实付款必须逐项确认：

- 前端不能提交或覆盖金额。
- 创建的是独立 `community_orders`，不会触发积分包履约。
- 支付宝主动查单和异步通知都能幂等写入 `PAID`。
- 同步回跳只触发服务端查单，不信任 URL 参数。
- 付款账号可以读取群码，未付款账号得到拒绝响应。
- 管理员退款使用稳定退款请求号；处理中资格仍有效。
- 退款查询得到 `REFUND_SUCCESS` 后写入 `REFUNDED`，随后群码访问失效。
- 任何关键项失败时立即将 `COMMUNITY_PAYMENT_ENABLED` 改回 `false`。

## 群码轮换与日常运维

- 群二维码过期时，在管理面板上传新图片；RPC 会在同一事务中停用旧图并启用新图。
- 不要把受保护群码上传到 GitHub、README、公开对象存储或前端静态目录。
- 退款由“微信搜索苍何”人工审核；管理员操作前核对账号、订单号和退款状态。
- 人工撤销资格不会自动退款；需要退款时使用退款流程，不用撤销代替退款。
