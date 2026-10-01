# WP-05B2b：S3 + GuardDuty 私密材料安全链

**状态：工程实现与 PostgreSQL 质量门禁已完成；真实 AWS 激活验收属于外部上线门禁｜日期：2026-08-20**

## 1. 目标与边界

本工作包消费 WP-05B2a 产生的 `verification_material_scan_requested` Outbox 事件，在 AWS S3 隔离区中完成材料上传约束、GuardDuty Malware Protection for S3 结果轮询、访问标签推进、失败重试和超时回收。

材料仍只绑定既有作者验证申请；不进入公开媒体库，不增加新的前台功能，不改变 P12 作者身份关联的低频分支定位。生产 Feature Flag 默认为关闭，未配置真实 AWS 资源和密钥前不得开放。

## 2. 交付内容

| 层 | 实现 |
| --- | --- |
| OpenAPI | `prepare` 响应返回浏览器必须原样发送的五个 `upload_headers`；契约继续保持 66 paths / 76 operations |
| API | Feature Flag 开启后装配 `PrivateMaterialService + PostgresPrivateMaterialStore + AwsS3PrivateMaterialStorage`；要求 Identity 与 Workflow 同时启用 |
| S3 上传 | 单对象 PUT、HTTPS 预签名、SHA-256 checksum、SSE-S3、`If-None-Match: *`、初始 `VibeCheckAccess=quarantined` |
| 上传完成 | `HeadObject` 重新校验 ETag、服务端 checksum、MIME 和字节数；不信任浏览器声明 |
| 扫描 Worker | 领取 60 秒材料租约，轮询 GuardDuty 托管标签；pending 15 秒后重排，provider failure 按 30/60 秒重试，第三次失败终止 |
| 访问门禁 | 只有 `GuardDutyMalwareScanStatus=NO_THREATS_FOUND` 才允许 Worker 写入 `VibeCheckAccess=ready`；恶意、不可扫描、超时和重试耗尽均不可读 |
| 过期恢复 | 每分钟扫描 prepared 上传过期与 uploaded/scanning 处理超时，使用 `FOR UPDATE SKIP LOCKED` 批量回收 |
| 数据库 | 追加 migration `000035_verification_material_scan_polling.sql`，仅放行带版本递增的 `scanning → scanning` 轮询迁移，不修改 migration 34 |
| IaC | `infra/aws/private-material.yaml` 创建私有、版本化、SSE-S3 桶，GuardDuty 角色与 MalwareProtectionPlan，条件写入和双标签读取门禁 |
| 部署 | Render API/Worker 增加相同 AWS、桶、前缀和加密密钥配置；`PRIVATE_MATERIAL_ENABLED=false` 为安全默认值 |

## 3. 状态与时间规则

```text
prepared --complete--> uploaded --claim--> scanning
scanning --pending(15s)------------------> scanning
scanning --provider failure(30s/60s)----> scanning
scanning --clean + access tag ready-----> ready
scanning --malicious/unscannable--------> rejected
scanning --3rd provider failure---------> rejected
uploaded/scanning --30min deadline------> rejected
prepared --30min upload expiry----------> abandoned
```

- `pending` 不消耗 provider failure 次数，也不进入通用 Outbox 错误预算。
- `ACCESS_DENIED`、`FAILED`、未知 GuardDuty 值或读取标签失败统一视为 provider failure；申请人只看到既有粗粒度投影。
- 材料领取与通用 Outbox 均使用 60 秒租约。并发重复事件在材料租约期内无操作；旧执行者跨租约完成时由版本检查拒绝。
- 所有扫描领取、结果、失败与回收均写入不可变 `material_access_logs`，purpose 固定为 `malware_scan`。

## 4. 浏览器上传契约

客户端收到 `upload_url` 后必须使用 `PUT` 并原样发送以下响应字段，不得新增或删减参与签名的头：

| Header | 值 |
| --- | --- |
| `content-type` | prepare 请求中已验证的 MIME |
| `if-none-match` | `*` |
| `x-amz-checksum-sha256` | prepare SHA-256 十六进制值对应的 Base64 |
| `x-amz-server-side-encryption` | `AES256` |
| `x-amz-tagging` | `VibeCheckAccess=quarantined` |

上传成功后客户端把 S3 响应 `ETag` 作为 `upload_receipt` 调用 complete。预签名 URL 和 Header 属于短期敏感值，禁止写入 Analytics、日志、localStorage 或错误上报正文。

## 5. AWS 安全边界

1. 公共访问四项全部阻断，Bucket Owner Enforced，TLS 强制，版本控制启用。
2. 浏览器只获得单一对象的短期 PUT 能力；`If-None-Match: *` 防止相同稳定 key 被重用覆盖。
3. 桶策略同时检查 GuardDuty clean 标签与应用 ready 标签。任一缺失，普通读取主体均被显式拒绝。
4. GuardDuty 服务角色只扫描配置前缀并维护托管扫描标签；Runtime 角色是可信控制面，仅用于预签名、HeadObject 与标签推进，不向申请人或审核员直接发放对象读取能力。
5. 应用把 GuardDuty 托管标签作为权威扫描结果；不会根据文件扩展名、客户端声明或超时推断 clean。

## 6. 配置

| 变量 | API | Worker | 规则 |
| --- | --- | --- | --- |
| `PRIVATE_MATERIAL_ENABLED` | 是 | 是 | 默认 `false`；两个服务必须一致 |
| `PRIVATE_MATERIAL_AWS_REGION` | 是 | 是 | 当前批准 `ap-southeast-1` |
| `PRIVATE_MATERIAL_S3_BUCKET` | 是 | 是 | CloudFormation 输出的精确桶名 |
| `PRIVATE_MATERIAL_S3_PREFIX` | 是 | 是 | 默认 `identity/verification/` |
| `PRIVATE_MATERIAL_ENCRYPTION_MASTER_KEY` | 是 | 是 | 同一 32-byte Base64 密钥；不得提交仓库 |
| `PRIVATE_MATERIAL_ENCRYPTION_KEY_VERSION` | 是 | 是 | 当前 `v1`；轮换前须保留旧版本解密能力 |
| AWS 凭证 | 是 | 是 | 当前 Render 使用受限凭证占位；生产应切换部署角色/工作负载身份 |

## 7. 验证矩阵

| 场景 | 预期证据 |
| --- | --- |
| presign | 命令包含 checksum、SSE、quarantine tag、条件写入；返回五个精确 Header |
| 上传核验 | ETag、checksum、MIME、size 任一缺失或不一致即拒绝/重试，不入扫描成功态 |
| pending | 状态保持 scanning，15 秒后生成一个领域轮询事件，失败计数不变 |
| clean | 先验证托管 clean 标签，再写 ready 标签，最后数据库进入 ready |
| malicious | 数据库 rejected / `MALWARE_DETECTED`，不调用开放读取 |
| unscannable | 数据库 rejected / `SCAN_UNSCANNABLE`，不调用开放读取 |
| provider failure | 30 秒、60 秒两次重排；第三次 rejected / `SCAN_RETRY_EXHAUSTED` |
| deadline | 30 分钟后 rejected / `SCAN_DEADLINE_EXCEEDED` |
| prepared expiry | 30 分钟后 abandoned / `UPLOAD_EXPIRED` |
| 重复/并发 | 租约内重复无操作；过期后可恢复；旧 version 不可提交结果 |
| IaC 回归 | 静态测试锁定私有、加密、版本化、CORS、GuardDuty、条件写入和双标签门禁 |

本地单元、静态、类型、契约和构建通过。GitHub Actions Run [#60](https://github.com/jiadianyan112/VibeCheck/actions/runs/32332867619) 已在 PostgreSQL 18 上通过第 35 个迁移重复执行、既有控制面 fixture 与本工作包扫描事务 fixture。真实 AWS 扫描仍属于外部上线门禁，需 AWS 账号、部署角色和实际桶后完成 EICAR/clean/unsupported/权限故障演练，且不得把测试恶意文件下载到开发者终端。

## 8. 官方实现依据

- [GuardDuty 扫描结果标签与状态](https://docs.aws.amazon.com/guardduty/latest/ug/monitoring-malware-protection-s3-scans-gdu.html)
- [GuardDuty 基于标签的 S3 访问控制](https://docs.aws.amazon.com/guardduty/latest/ug/tag-based-access-s3-malware-protection.html)
- [GuardDuty Malware Protection IAM 权限](https://docs.aws.amazon.com/guardduty/latest/ug/malware-protection-s3-iam-policy-prerequisite.html)
- [S3 条件写入](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [S3 预签名 URL 与 checksum](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

## 9. 后续工作

- 外部激活：创建 AWS 资源、配置 Render secret、使用受限 Runtime principal，并保持 Feature Flag 关闭直至真实验收通过。
- WP-05B3：把 ready 材料接入作者验证提交与审核工作项；审核员读取必须使用独立、短期、逐材料授权并写访问日志。
- 保留期、法务保留和内容物理删除在发布候选数据治理工作包实现，不在本工作包推断期限。
