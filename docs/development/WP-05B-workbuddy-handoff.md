# WP-05B WorkBuddy：P13 媒体与证据接入交接

**契约：沿用 `packages/contracts/openapi/v1.yaml`｜SHA-256：`2adb1e176ba08370d16146fb6e9adef95287ab263c94dc46a1fcc6996993a9de`｜日期：2026-08-20**

## 1. 媒体调用顺序

1. 使用 WP-05A 的 prepare→S3 PUT→complete→poll 流程得到 `ready+clean` MediaResource。
2. 创建 MediaReference 时发送 `target_type=project_update`、`target_id={update_id}`，保存响应的 `media_reference_id`。
3. 每次创建或删除引用后重新 GET ProjectUpdate；引用事务会推进 Update 版本，不能继续使用操作前的 `expected_version`。
4. PATCH ProjectUpdate 时提交服务端当前的完整 `media_reference_ids`，不得提交 MediaResource ID、已 unlinked 引用或属于另一 Update 的引用。

## 2. 证据调用顺序

1. 创建 EvidenceDraft 时发送 `parent_type=project_update`、`parent_id={update_id}`；`final_target_kind` 和 `field_path` 必须对应实际更新字段。
2. bind 时使用当前 ProjectUpdate `version`。成功响应的 `parent_version` 是下一次更新操作的基线。
3. 完成证据后，把 `evidence_draft_id` 放入 ProjectUpdate PATCH 的完整 ID 列表；不要使用附件 ID。
4. withdraw 会从 Update 数组移除该证据并再次推进 Update 版本，完成后必须刷新更新稿。
5. 作者本人陈述使用 `evidence_type=verified_author_statement`、`source_channel=author_statement`，并必须提供本次 Update 已获授权的精确 `field_path`。前端不得根据 Session 角色自行判断成功；以后端创建结果为准。

## 3. UI 错误映射

| 错误 | P13 行为 |
| --- | --- |
| `MEDIA_TARGET_FORBIDDEN` / `EVIDENCE_PARENT_FORBIDDEN` | 退出编辑态并刷新作者权限，不隐藏已保存草稿 |
| `MEDIA_TARGET_READ_ONLY` / `EVIDENCE_PARENT_READ_ONLY` | 显示“该更新已提交，不能再修改附件”，刷新状态 |
| `EVIDENCE_PARENT_VERSION_CONFLICT` | 保留本地输入，获取最新 Update 后让用户重试 bind |
| `EVIDENCE_AUTHOR_CAPABILITY_FORBIDDEN` | 刷新 Link/Relation 与更新权限；不降级伪造作者声明，可改用有真实外部来源的 `trusted_external_source` |
| `EVIDENCE_AUTHOR_CONTEXT_FORBIDDEN` | 把作者声明绑定到当前 ProjectUpdate 的具体字段，不允许用于新作品 Submission |
| `EVIDENCE_AUTHOR_SOURCE_CHANNEL_REQUIRED` | 将来源渠道固定为 `author_statement` 后重试 |
| `MEDIA_RESOURCE_NOT_READY` | 继续展示安全检查状态，不创建引用 |
| `PROJECT_UPDATE_BINDING_INVALID` | 刷新媒体/证据列表，移除已撤销或跨对象 ID 后重新预览 |
| 404 | 统一按不可枚举处理，不提示对象所有者或存在性 |

## 4. 必须移除的 Mock

- 浏览器仅把图片 URL 或 MediaResource ID 写入 ProjectUpdate。
- 本地生成 evidence ID 后跳过 Evidence create/bind/complete。
- 附件增删后只改本地数组而不重新获取 Update 版本。
- 在 `update_pending/changes_requested/approved` 等非 `editing` 状态继续显示可提交的上传或证据按钮。
- 只因 Session 含 `verified_author` 文本便在本地生成作者声明成功态。

WorkBuddy 仍只修改前端目录；后端 Store、fixture 和契约由 Codex 维护。
