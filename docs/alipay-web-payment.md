# 支付宝网站支付

项目同时保留 Stripe，并为一次性积分包增加支付宝网站支付。会员订阅仍由 Stripe 处理，避免把支付宝单次支付误当成自动续费。

## 接口

| 路径 | 用途 | 权限 |
| --- | --- | --- |
| `POST /api/billing/alipay/checkout` | 创建订单并返回支付宝 POST 表单 | 登录用户 |
| `GET /api/billing/alipay/query` | 主动查询交易并幂等发放积分 | 订单所属用户 |
| `POST /api/billing/alipay/notify` | 验签、校验订单并处理异步通知 | 支付宝服务器 |
| `POST /api/billing/alipay/refund` | 发起全额退款并预扣对应积分 | 超级管理员 |
| `GET /api/billing/alipay/refund-query` | 查询退款结果 | 超级管理员 |
| `POST /api/billing/alipay/close` | 关闭未支付订单 | 超级管理员 |

支付结果只接受验签通过的异步通知或 `alipay.trade.query` 主动查询。浏览器同步回跳只用于打开结果页，不直接判定付款成功。

## 数据库与人民币定价

先应用迁移 `supabase/migrations/20260721090000_alipay_webpay.sql`。迁移会增加支付通道、支付宝交易号、退款状态和原子积分入账/退款函数。

每个需要开放支付宝购买的积分包，都必须在 `credit_packs.alipay_amount_cents` 中填写经过业务确认的人民币分值。没有独立人民币价格的积分包不会展示可用的支付宝按钮；代码不会把现有美元价格按 1:1 当作人民币价格。

## 本地沙箱

本地代码直接读取项目根目录下、由支付宝 AI 付 Skill 创建并验证的 `.alipay-sandbox.json`：

- Node.js 使用 `appIds[0].appPrivatePkcsKey`（PKCS#1）。
- 网关固定为 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`。
- 配置文件必须保持 Git 忽略和仅当前用户可读写。
- 本地没有公网 HTTPS 地址时不发送 `notify_url`，付款结果由交易查询确认；通知处理代码仍会保留。

## 生产配置

生产环境通过服务端环境变量设置：

- `ALIPAY_APP_ID`
- `ALIPAY_PRIVATE_KEY`
- `ALIPAY_PUBLIC_KEY`
- `ALIPAY_SELLER_ID`
- `ALIPAY_GATEWAY`
- `ALIPAY_NOTIFY_URL`
- `ALIPAY_NOTIFY_ENABLED`

`ALIPAY_APP_ID`、应用公钥和应用私钥必须属于同一套生产应用密钥。Node.js 使用 PKCS#1 原始私钥字符串，不添加 PEM 头尾，不在日志、前端或仓库中保存密钥。

真实上线必须使用公网 HTTPS `notify_url`，完成通知验签、幂等处理、`app_id`、`seller_id`、订单号和金额校验，并保留主动查询作为补偿链路。
