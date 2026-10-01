# WP-05B4 WorkBuddy 前端接入交接

**OpenAPI：`packages/contracts/openapi/v1.yaml`｜SHA-256：`7550fbd6f968eccd8531df74f4f926338bc336fd15651746251414231a33d4ac`｜日期：2026-08-20**

## 1. 页面和接口

- P12 当事人：`GET /api/v1/me/ownership-cases/{case_id}`。
- A06 审核者：先从 `work_type=ownership_case` 队列领取，再以 `X-Review-Claim-Token` 调用 `GET /api/v1/admin/ownership-cases/{case_id}`。
- 立案：`POST /api/v1/ownership-cases`。
- 追加证据：`POST /api/v1/ownership-cases/{case_id}/evidence-submissions`。
- 申请撤回：`POST /api/v1/ownership-cases/{case_id}/withdrawal-requests`。
- 拒绝当前撤回子项：`POST /api/v1/ownership-cases/{case_id}/withdrawal-requests/{withdrawal_request_id}/reject`。
- 最终裁决继续使用 admin preview → confirm → WorkItem decision；ownership `decision_payload` 精确为 `expected_conflict_principal_version` 和 `withdrawal_request_id`。

## 2. 必须遵守的状态规则

- Case：`open → investigating → resolved_upheld | resolved_revoked | withdrawn`；终态不可编辑。
- WithdrawalRequest：`requested → rejected | accepted | closed_by_case_decision`；拒绝后重提必须传 latest rejected 的 `supersedes_request_id`。
- 创建案件不会撤销或修改原 VerificationRequest；只暂停目标 AuthorRelation。
- 追加证据或撤回申请可能使当前 reviewer 成为冲突主体，并会立即释放 claim。收到版本冲突/403/410 后必须清掉本地审核态，不能自动重放决定。

## 3. 投影边界

- 不要把 PartyProjection 和 ReviewerProjection 合成一个宽松类型；必须按 `viewer_schema` 判别。
- Party 页只展示 `party_roles[]`、`my_evidence_submissions`、`my_withdrawal_requests`、`decision_summary` 和 `allowed_actions`。
- Reviewer 页只在有效 claim 下读取；不得把用户 ID、审核摘要或撤回理由复制到公共页面。
- 前端永远不得请求、缓存或埋点记录 conflict principal set/hash/source versions、claim/preview/confirm token 或内部存储字段。

## 4. 主要错误映射

| 错误码 | 前端动作 |
| --- | --- |
| `OWNERSHIP_CASE_NOT_FOUND` | Party 显示不存在；不探测其他账户案件 |
| `OWNERSHIP_CASE_VERSION_CONFLICT` | 保留未提交输入，刷新 Case 后由用户重试 |
| `OWNERSHIP_CONCURRENT_CONFLICT` | 刷新 active Case/withdrawal，不创建第二条 |
| `CONFLICT_OF_INTEREST` | 立即退出审核详情并从队列移除 |
| `CONFLICT_PRINCIPAL_VERSION_CONFLICT` | 清空 claim/preview/confirm，重新刷新队列 |
| `WORK_ITEM_LEASE_EXPIRED` | 清空本地 claim；需要时重新领取 |
| `OWNERSHIP_WITHDRAWAL_ALREADY_REQUESTED` | 定位并展示当前 active 子项 |
| `OWNERSHIP_WITHDRAWAL_SUPERSEDES_INVALID` | 刷新完整本人撤回历史，使用 latest rejected ID |
| `OWNERSHIP_WITHDRAWAL_NOT_ACTIVE` | 停止当前操作并刷新案件 |
| `OWNERSHIP_EVIDENCE_INVALID` | 保留选择，标出不可用于该 Relation/Project 的证据 |

## 5. 需要移除的 Mock

- P12/A06 本地直接把 `authorLinkStatus` 或 VerificationRequest 改成 disputed/upheld/revoked 的逻辑。
- A06 无 claim 直接显示争议双方和证据的逻辑。
- 覆盖旧撤回请求、只保存单个 withdrawal status 的本地模型。
- 前端根据按钮可见性自行恢复/终止 AuthorRelation 或写 Project 作者状态的逻辑。

production Feature Flag 在 WorkBuddy 接入、Staging 真实 Session/权限验证和人工争议演练前保持关闭。

后端验收基线：`59eece1`；GitHub Actions Run [#32355331970](https://github.com/jiadianyan112/VibeCheck/actions/runs/32355331970) 已通过。WorkBuddy 接入时以本文件列出的 SHA 校验 OpenAPI，不得继续调用 P12/A06 归属争议 Mock。
