# 作品墓地准备说明

## 0. 文档边界与资料记录

- 规则来源：[Watcha 作品提交指南](https://docs.watcha.cn/post/submit-product-guide/)；核对日期：2026-10-03。
- 本次将发布流程优化迁移到线上正式版（基线 `4eca683`），保留真实登录、API、上传安全检查和审核发布 Worker。既有作品广场包含作品墓地频道；专门的墓地提交入口、历史身份校验和相关存储/接口尚未实现。
- 本文是后续实现的可执行输入，不代表已经存在 `Graveyard`、`GraveyardEntry` 或其他墓地 domain 类型。实现前仍须通过现有审核、权限、证据和生命周期约束。

本文使用“墓地”表示仍可追溯、但当前暂停或结束的作品历史档案及其可核验资产。`paused` 只表示作者或充分证据支持的生命周期事实，不能推导为商业失败、市场需求不足、收入结果、能力评价或作品质量结论。

### 本次发布流程对照

| 指南中的环节 | VibeCheck 本次实现 |
| --- | --- |
| 基本信息和提交者关系 | 公开地址检查与查重、名称、所属团队或开发者、所有者/团队成员/第三方推荐者声明；声明不授予作者权限 |
| 介绍和分类 | 一句话介绍、详细介绍；继续以一个主品类选择对应结构化字段，两品类不混用 Schema |
| 产品图集 | 保留正式版最多 9 张图片上传、安全检查、裁剪和排序，第一张作封面；增加独立 Logo、补充详情图地址和 bilibili/b23 视频链接 |
| 致谢 | 可增删多条名称、帮助说明和可选公开地址；不会自动生成资产所有权或已确认的派生关系 |
| 自由填写与最终预览 | 各步骤可直接切换并自动保存；预览列出遗漏和格式错误，能返回对应字段；界面与服务提交入口统一校验 |
| 保存、审核与发布 | 审核读取冻结提交版本；通过后元数据进入同一作品档案；重新检查同一地址保留已填草稿 |

图片、介绍、开发信息和致谢可暂缺；已提供的链接须合法，致谢条目须补齐名称与说明。首次公开发布仍沿用原有地址检查门槛；历史作品收录需使用下面单独的入口规则。预告发布、审核时限承诺和观猹产品徽章属于后续平台能力，不能从参考指南直接变成 VibeCheck 的服务承诺。

正式版的新增信息位于 `ProjectCoreSnapshot.publication_details`，内部键与前端 `PublicationDetails` 一致；它随草稿、冻结提交和公开版本的 JSON 快照保存，不需要新增数据库列。前端公开详情通过目录适配器读入 `ProjectCore.publicationDetails`。旧记录缺少此对象仍可读取，新提交在 preview/submit 阶段必须声明提交者关系。客户端自动保存仍保留 IndexedDB 和云端草稿机制。正式版允许访问状态不确定的地址进入审核，页面必须显示不确定，不伪造正常；历史收录入口的放宽规则仍独立于普通发布。

## 1. 两条进入路径

### 1.1 已有作品档案：沿用 `projectId`

适用条件：VibeCheck 已经有该作品的 `ProjectCore`，或查重已经命中已有档案。

1. 提交者必须引用已有 `projectId`，不得以同一作品另建墓地身份。
2. 通过作者关系/管理权限检查后，提交暂停或结束声明，以及发生日期、原因（可不公开）、证据和复盘自述。
3. 暂停/结束应沿用 `ProjectCore.accessStatus`、`statusNote` 和 `LifecycleEvent`；当前状态与历史事件分开保存。
4. 原档案保留名称、历史地址、封面/图集、资产、作者关系、证据和已有事件。未来墓地页面只应从原档案引导进入，不能复制一份独立作品内容。

### 1.2 首次历史收录：历史地址 + 公开存档/仓库 + 证据

适用条件：作品从未进入 VibeCheck，且现在已下线或无法提供在线体验。

1. 首次提交可以没有现行 `projectId`，但必须提供足以形成稳定历史身份的组合：历史名称、历史地址、公开存档或代码仓库，以及逐项证据摘要。
2. 审核可以基于历史网页存档、公开仓库、发布说明、作者公开声明、公开截图/图集和其他可信材料理解作品；不要求当前在线体验可用。
3. 这条路径不套用普通发布的“URL 当前可达”门槛。普通发布的 URL 格式/安全检查仍适用于输入安全，但当前不可达本身不能作为拒绝历史收录的唯一理由。
4. 审核通过后，未来实现应创建一个稳定的 `ProjectCore.id`，把历史地址写入 `historicalUrls`，把材料挂到 `Evidence`/事件；之后再次提交必须先按稳定身份去重。
5. 无法形成身份、证据不足或来源冲突时保留草稿并要求补充，不得用名称相似、无来源审核记录或系统推断补齐历史事实。

## 2. 提交字段合同

下表区分当前发布元数据与下一阶段的墓地输入约定。`PublicationDetails` 的字段属于发布流程；历史身份、生命周期和证据字段属于下一阶段 `GraveyardSubmissionInput`，目前尚未实现，不能塞进已发布的介绍元数据。下一阶段输入的新增字段在类型上采用 optional，再按入口做提交校验。来源要落到 `Evidence` 或现有审核日志，不能只保存一段无来源的结论。

| 字段 | 类型 | 必填规则 | 来源与处理 |
| --- | --- | --- | --- |
| 提交模式 | `mode?: 'existing_project' \| 'historical_first'`（下一阶段 `GraveyardSubmissionInput`） | 提交校验必填；按模式执行对应字段校验 | 提交者选择；不改变已发布作品的 `ProjectCore` 身份 |
| 已有档案 ID | `existingProjectId?: ProjectId`（下一阶段输入） | `mode='existing_project'` 时必填；沿用原档案 | 查重命中、原档案链接、作者/后台权限；不得创建墓地副本 |
| 首次历史身份 | `historicalIdentity?: { name?: string; urls: string[]; archiveUrls: string[]; repositoryUrl?: string }`（下一阶段输入） | `mode='historical_first'` 时必填；至少有历史地址及公开存档/仓库组合，身份不足进入补充 | 历史页面/地址、公开存档、公开仓库；不足时不得借无来源审核记录虚构身份 |
| 历史名称 | `historicalIdentity.name?: string` 或未知原因 | 已知则填写；未知允许提交但必须说明原因 | 作者材料、历史页面/存档、仓库；写入 `historicalNames`，不覆盖当前名称 |
| 历史地址 | `historicalIdentity.urls: string[]` | 首次历史收录至少一个；缺失时进入补充，不以审核记录替代 | 作者、公开存档、仓库、平台历史记录；写入 `historicalUrls`，失效不删除 |
| 公开存档/仓库 | `historicalIdentity.archiveUrls: string[]`、`repositoryUrl?: string` | 首次历史收录至少提供公开存档或仓库之一，并附证据 | 历史网页存档、公开代码仓库、发布说明；只能收录可核验材料 |
| 封面 | `screenshotUrl: string \| null` | 提交流程可选；有图必须说明来源 | 继续使用现有 `SubmissionProjectFields.screenshotUrl`，不要改成新的 `coverUrl`；审核后映射到现有媒体字段 |
| 图集 | `PublicationDetails.galleryUrls?: string[]`；历史截图可另放下一阶段输入 | 可选；每项应能说明捕获时间/来源 | 当前发布元数据来自作者/发布流程；历史存档图集需保留媒体来源和可见性 |
| 提交者关系 | `PublicationDetails.submitterRelation?: SubmitterRelation`，取值 `owner \| team_member \| third_party` | 类型可选；提交校验应声明关系，权限另行验证 | 账户关系、作者身份验证、公开个人主页、域名/仓库控制或人工材料；`third_party` 不自动获得管理权，也不自动成为可信证据来源 |
| 生命周期声明 | `status?: 'paused' \| 'ended'`（下一阶段输入） | 进入墓地准备流程必填其一；作者声明必须勾选终止性声明 | 作者声明、公开公告或经可靠性审核的外部证据；沿用 `terminalDeclared` 与来源上下文校验 |
| 发生日期 | `occurredAt?: string \| null`（下一阶段输入） | 允许未知；未知必须显式保留未知，不用提交时间代替 | 作者、存档时间、发布说明、仓库记录；不能直接塞入现有必填 `LifecycleEvent.happenedAt` |
| 日期精度与估计标记 | `datePrecision?: 'exact' \| 'month' \| 'year' \| 'range' \| 'unknown'`、`isEstimatedDate?: boolean`（下一阶段输入） | 区间、月份或推断值标记 estimated；未知保留 `occurredAt:null` 与 unknown | 审核根据证据精度设置；不能把 `capturedAt` 当作发生日期 |
| 记录时间 | `recordedAt?: string`（下一阶段系统字段） | 由系统记录提交/审核时间；不能当作发生时间 | 系统时钟、审核记录；与实际 `occurredAt` 分离 |
| 来源类型 | `sourceType?: EvidenceType`（下一阶段输入） | 每个关键声明至少有来源类型；`paused`/`ended` 不得只依赖 `system_inference` | `third_party` 提交不自动映射为 `trusted_external_source`；平台须另行审核来源可靠性、证据内容和时效 |
| 证据 URL | `sourceUrl?: string \| null`（下一阶段输入） | 有外部证据时填写；内部审核记录可为空但须有记录 ID | `Evidence.sourceUrl`；可为历史存档、公开仓库、发布说明或公开公告；访问失效仍保留 URL |
| 证据摘要 | `sourceSummary?: string`（下一阶段输入） | 每条关键证据必填，说明支持哪个字段/事件 | `Evidence.sourceSummary`；摘要不得只写“已核实”，应说明观察到的事实和局限 |
| 原因是否公开 | `reason?: string \| null`、`reasonVisibility?: 'public' \| 'private'`（下一阶段输入） | 可不公开；若不公开仍需内部审核理由 | 作者选择 + 审核记录；公开页面只显示“作者未公开原因”等事实状态 |
| 复盘自述 | `retrospective?: string \| null`（下一阶段输入） | 可选；作者提交时建议填写，不能替代身份和证据复核 | 作者自述；标记为 `verified_author_statement` 前仍需验证提交者关系 |
| 资产 URL | `assetUrl?: string`（下一阶段输入） | 宣称资产存在时必填；无资产可为空 | 沿用 `ReusableAsset.url`，通过安全检查；指向历史仓库/包/设计文件时记录其当前可用性 |
| 许可证 | `license?: string \| null`（下一阶段输入） | 资产可展示但未知许可允许为空；可复用结论不得缺失许可 | 沿用 `ReusableAsset.license`；无许可证不能称为“可复用”“可 Fork”或“开放资产” |
| 独立可用状态 | `independentUseStatus?: boolean \| 'unknown'`（下一阶段输入） | 资产存在时尽量填写；不确定必须为 `unknown` | 作者声明、仓库许可/构建说明、平台复核；与 URL 可访问、许可证、价格分别展示 |

所有新增提交流程字段应采用 optional 形式，确保已有草稿、旧发布和已有 `ProjectCore` 可读取。缺失值必须呈现为未知/未提供及原因，不能通过默认值伪装完整。

## 3. 状态、事件与权限规则

1. **首次网络失败不进墓地。** 第一次技术检查失败不改变当前 `project.accessStatus`；现有 `reviewProjectStatus` 的首次观察只把作品放入 `reviewStatus: update_pending` 复核队列，并在日志 `afterValue` 记录 `pending_recheck`，不创建状态事件，也不自动写入 `paused`/`ended`。后续复核有理由和证据后才可确认状态。
2. **作者自述仍须复核。** `applyProjectUpdate` 已要求 `sourceSummary`、`impactScope`，并要求 `paused`/`ended` 勾选 `terminalDeclared`。提交者身份仍须通过已有作者关系/身份验证；有争议时冻结高风险编辑。自述可以作为证据来源，不能绕过身份和事实检查。
3. **迁移回原档案。** 现行地址改变时沿用 `domain_migrated` 和 `historicalUrls`，在原 `projectId` 下引导查看最新地址、历史地址和事件。URL 失效、域名迁移、暂时异常均不得直接创建墓地副本。
4. **发布、更新、恢复都是追加事件。** 首次发布、状态声明、恢复、地址迁移、资产增加和后续更新分别追加 `LifecycleEvent`；更新当前字段时不得覆盖或删除旧事件、旧值、旧证据。恢复必须有恢复事件，不能把历史暂停抹掉。
5. **第三方没有管理权。** 第三方可提交线索或公开证据，但不能通过墓地入口编辑原档案、声明作者身份、替换历史事件或恢复作品。能改变当前档案的操作必须经过现有 `canUserUpdateProject`/作者验证或后台权限。
6. **历史收录不等于在线发布。** 无在线体验的作品可以作为历史档案审核；其 `accessStatus`、证据时效和缺失原因要单独展示。历史材料足够不等于作品当前可访问，也不自动获得 `published_author`。
7. **资产结论受许可约束。** URL 可访问不等于可复用；没有许可证或独立可用证据时，只能显示“资产链接/许可未知”，不得提供可复用、可 Fork 或可直接使用的承诺。
8. **未知日期是一等状态。** 未知日期可提交、审核和展示为未知；估计日期必须有 `isEstimatedDate=true`（或等价精度标记）及证据依据。下一阶段应分离系统 `recordedAt` 与实际 `occurredAt:string|null`/`datePrecision`；不得把审核时间、抓取时间或档案创建时间回填为作品结束时间。

## 4. `ProjectCore` 等现有模型的复用边界

- 身份、当前/历史名称与 URL、作者关系、访问状态、审核状态、资产和事件继续复用 `ProjectCore`、`LifecycleEvent`、`Evidence`、`ReusableAsset`；墓地准备不复制另一套作品主对象。
- 事件遵守现有 `LifecycleEvent` 的 append-only 语义：`projectId`、`type`、`happenedAt`、`isEstimatedDate`、`summary`、`sourceType`、`evidenceIds`、`changes`、`disputeStatus` 均应可追溯。
- 当前 `LifecycleEvent.happenedAt` 是必填 `string`，只有 `isEstimatedDate` 不能表达“发生日期未知”。下一阶段 `GraveyardSubmissionInput` 应分离系统 `recordedAt` 与实际 `occurredAt:string|null`、`datePrecision`，再设计事件投影/兼容字段；不能把未知日期直接塞进 `happenedAt`，也不能用提交时间替代结束时间。
- 资产沿用 `ReusableAsset` 的 `url`、`license`、`availabilityStatus`、`lastVerifiedAt`、`evidenceIds`。独立可用状态若尚未有现有字段，只能作为可选提交流程/审核输入，待单独建模后再落库。
- `PublicationDetails` 是发布元数据类型；提交字段层的 `SubmissionProjectFields` 通过 `extends PublicationDetails` 纳入这些字段，并在发布后的 `ProjectCore.publicationDetails` 中可选投影保存。`SubmissionDraft.fields` 仍是 `Partial<SubmissionProjectFields>`，不再包一层 `PublicationDetails` 对象。其可选字段包括 `submitterRelation`、`organizationName`、`detailedDescription`、`logoUrl`、`galleryUrls`、`videoUrl` 和 `acknowledgements`，封面仍使用 `screenshotUrl`。
- 后续墓地入口应另设 `GraveyardSubmissionInput`，承载 `mode`、历史身份、生命周期日期、证据与资产许可等 optional 输入；这些字段不塞进已发布的 `PublicationDetails`。该输入合同、日期兼容处理、墓地页面、后端实体和独立 domain 类型均尚未实现。

## 5. 编号验收场景

1. **已有档案稳定 ID 去重。** 输入命中已有作品的 URL、历史名称或仓库；系统要求引用原 `projectId`，进入原档案更新/身份验证流程，不能创建第二个作品或墓地身份。
2. **发生日期未知。** 提交者选择 `paused`，没有可靠日期；草稿保存 `occurredAt: null`/未知原因，审核快照不填提交时间，页面显示未知，事件不会伪造精确日期。
3. **暂时网络异常。** 首次检查超时或 DNS 失败；`project.accessStatus` 保留当前访问事实，结果只进入 `reviewStatus: update_pending` 复核队列，日志 `afterValue` 为 `pending_recheck`，没有 `paused`/`ended` 事件，也没有自动进入墓地。第二次有理由的复核才可确认技术状态。
4. **历史地址失效但材料充分。** 首次收录的历史地址已失效，仍有公开网页存档、公开仓库和对应证据摘要；审核可以创建一个稳定 `ProjectCore` 历史档案，不因 URL 不可达套用普通发布拒绝。
5. **无证据要求补充。** 提交者只填“作品结束”而无身份依据、证据 URL 或摘要；系统保留草稿并返回补充项，不能批准，也不能用 `system_inference` 代替关键事实。
6. **中断后保留草稿。** 在填写图集、原因可见性或资产许可时离开；重新进入仍能恢复两条入口选择、`screenshotUrl`、已填字段和验证错误，未提交字段不生成公开事件。
7. **审核快照可追溯。** 草稿首次提交后，作者再修改表单；审核读取 `submittedFields`/提交时资产快照，前后版本有明确时间和日志，不能静默改写正在审核的内容。
8. **无许可证资产不作可复用声明。** 提交历史仓库 URL 但许可证为空；资产可作为链接保留，`license=null`、独立可用状态为 unknown/不可确认，卡片和详情不能显示“可复用”“可 Fork”。
9. **恢复/迁移沿用原档案。** 已暂停作品提交新地址或恢复材料；系统在原 `projectId` 下追加 `domain_migrated`/`recovered` 事件，保留暂停历史并把迁移引导指向原档案，不建新墓地/新作品。
10. **权限与第三方边界。** 未登录用户、未验证第三方或有争议且高风险编辑冻结的用户尝试修改状态；操作被拒并保留线索/审核理由。已关联作者或有权限的编辑/管理员按现有工作流操作，管理员日志记录原因、前后值和时间。

## 6. 后续实现清单与界限

### 必须实现后才能开放墓地入口

1. 在下一阶段输入层增加可选 `GraveyardSubmissionInput`，明确 `mode: 'existing_project' | 'historical_first'` 两条入口；它不包进 `PublicationDetails`，保持旧草稿可读，封面字段继续为 `screenshotUrl`。
2. 实现稳定身份解析与幂等去重：已有 `projectId` 优先，历史首次收录建立唯一 `ProjectCore.id`，冲突进入人工审核；历史 URL 写入 `historicalUrls`。
3. 增加历史材料/证据审核视图：证据 URL、摘要、来源类型、来源可靠性、捕获/验证时间、日期未知/估计标志、争议与补充项可逐项复核；`third_party` 不自动成为 `trusted_external_source`。
4. 处理日期兼容：分离系统 `recordedAt` 与 `occurredAt:string|null`/`datePrecision`，再接入现有必填 `LifecycleEvent.happenedAt` 的投影；保证未知日期不写入 `happenedAt`，首次 `pending_recheck` 不自动墓地、后续确认追加事件。
5. 保持作者身份验证、第三方只读线索和高风险编辑冻结；提供从状态变化、迁移和历史收录回到原档案的引导。
6. 对 `ReusableAsset` 增加或映射独立可用状态的可选输入，并在缺许可证/证据不足时阻止“可复用”结论；新增存储字段需单独完成 schema、迁移和权限评审。
7. 为草稿恢复、提交快照、审核退回、补充材料、撤回和事件追加补充测试，覆盖本节 10 个验收场景。

墓地页面、后端实体、API、搜索筛选和独立墓地 domain 类型不在当前交付内；后续如支持预告发布，首次提交时应设置预告时间，正式发布时间和修改均至少提前 24 小时，当前无调度后端，不承诺自动定时发布、提醒或按时间切换状态。
