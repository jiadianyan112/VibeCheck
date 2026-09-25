# ADR-0002：邮箱 OTP、Resend 适配器与同源部署

**状态：Accepted｜批准日期：2026-08-11｜上位基线：ADR-0001 / PRD v1.10**

## 决定

1. P17 使用邮箱 6 位一次性验证码，不实现密码、OAuth 或前端角色选择器。
2. VibeCheck 是 OTP Challenge、用户、角色、权限、Session、CSRF、后台二次认证和安全审计的事实来源。
3. 首个邮件发送适配器使用 Resend。Resend 只接收发信请求并返回回执，不持有 VibeCheck 会话、角色或 OTP 验证状态；适配器通过 `EmailSender` 接口可替换。
4. 最快部署拓扑由“静态 Web + 独立 API 公网子域”调整为一个 Render Node Web Service：同一 Origin 同时提供 React 静态资源、SPA fallback、健康检查和 `/api/v1`。Worker 与 PostgreSQL 仍为独立 Render 资源。
5. 不在仓库保存 Resend API Key、邮箱加密密钥、Pepper 或 Session Token Secret。生产值只通过 Render Secret 注入。

## 原因

默认的两个 Render 公网子域不是同源。P17 冻结使用 `SameSite=Lax` Cookie；如果 Web 和 API 分处两个站点，浏览器凭证与 CSRF 边界会变复杂，并增加首期部署配置与误配风险。同源 Node Web Service 保留前后端逻辑分层，同时让 Cookie、Origin 校验、登录回跳和 SPA 路由使用一个清晰安全边界。

Resend 当前不是仓库中已有的内部服务。它是经产品负责人批准新增的外部邮件通道；供应商故障统一映射为稳定错误，不向客户端或日志返回供应商响应正文。

## 安全约束

- OTP 有效期 10 分钟、最多错误 5 次、同邮箱 60 秒内不可重发；创建请求受邮箱/IP 时间窗限流。
- 邮箱只保存 AES-256-GCM 密文与带 Pepper 的检索哈希；OTP、Session、CSRF、浏览器绑定和 IP/UA 只保存带密钥哈希。
- 登录成功必须创建新 Session；`admin_confirm` 只更新原 Session 的 `recent_auth_at` 并创建 5 分钟一次性 Grant，不旋转主 Session。
- `vc_session`、`vc_auth_flow`、`vc_anon` 为 `HttpOnly; SameSite=Lax`；生产同时为 `Secure`。`vc_csrf` 可由前端读取并必须通过请求头回传，服务端再和 Session 绑定哈希核对。
- 写请求必须通过 Origin 校验；`return_to` 必须是允许的同源路径，非工作人员不能回跳后台。
- 账号 `role_version` 改变、Session 过期/撤销或账号 disabled 后，原 Session 不再有效；restricted 账号只能获得只读权限投影。

## 部署输入

首次创建 Render Blueprint 时必须提供：

| 变量 | 规则 |
| --- | --- |
| `EMAIL_FROM` | Resend 已验证域名下的发件人，例如 `VibeCheck <login@your-domain>` |
| `RESEND_API_KEY` | 只授予发送所需权限的生产 Key |
| `EMAIL_ENCRYPTION_KEY` | 32 随机字节的标准 Base64；不能使用普通密码字符串 |

`EMAIL_HASH_PEPPER`、`OTP_PEPPER`、`AUTH_TOKEN_SECRET` 由 Render Blueprint 生成。密钥轮换必须先增加解密版本支持，不能直接覆盖仍被数据引用的 `EMAIL_ENCRYPTION_KEY_VERSION`。

## 后果与边界

- 当前提交使 P17、Session/权限基础和同源部署进入正式实现，不表示收藏、评论、比较合并等领域写接口已经生产化。
- 匿名比较与待执行动作在前端仍保留过渡状态；服务端 `identity_links` 已提供逻辑落点，正式合并/回放由对应领域工作包完成。
- 本机没有可用 PostgreSQL 运行时；迁移首跑与幂等复跑由 GitHub Actions 的 PostgreSQL 18 + pgvector 服务验证。
