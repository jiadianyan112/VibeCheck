# VibeCheck 产品结构设计——个人主页与作品集版

> 社区前台、作品档案内核与版本化 Category Schema  
> 首期品类：公开可访问、由 AI 编程工具辅助开发的个人主页与作品集 Web 网站  
> 文档版本：品类切换版 v1.0  
> 日期：2026 年 8 月

## 一、编制依据与结构结论

本设计以《VibeCheck 产品定位——个人主页与作品集首期品类版》为战略上游，以《VibeCheck 首期MVP产品方案——个人主页与作品集版》为功能上游，并以当前可点击原型的导航、页面 ID、主要操作和异常链路为页面基线。

当文档与原型发生冲突时，导航、路由、主要交互和返回规则优先尊重原型；品类字段、标签、搜索意图、比较维度、内容频道和示例数据以本设计为准。只有 P11 的参考/复用来源模块、P20 的优先级和 A03 的字段分层属于局部结构调整。

核心结构结论：

1. 前台继续使用作品社区形态，所有卡片、动态、互动、比较和发布统一引用 `project_id`；
2. `ProjectCore` 只保存跨品类字段，Portfolio 专属字段进入 `PortfolioSchemaV1`；
3. 当前状态与历史事件分开保存，Category 变更通过通用版本事件的子类型表达；
4. 资产和作品关系为独立对象，不以字符串标签代替；
5. 已有档案的作者身份关联保持低频人工审核流程，不新建重复作品。

## 二、产品结构目标与边界

| 目标 | 结构要求 | 判定标准 |
| --- | --- | --- |
| 可视觉浏览 | 首页和卡片以真实截图为主，无需先填写需求 | 首屏可进入作品、专题或搜索 |
| 可形成选择 | 任意作品可进入同类结果和 2—5 项比较 | 用户能确定结构、视觉、实现或复用方向 |
| 可回流发布 | URL 先查重，再进入新建或低频身份验证 | 不创建重复档案，草稿可恢复 |
| 可形成关系 | 作品可展示并声明参考、Fork、模板和组件关系 | 关系有方向、证据和确认状态 |
| 可持续维护 | 改版、项目、资产和状态写入事件 | 当前事实与历史均可追溯 |
| 可扩品类 | 专属字段不进入通用作品主对象 | 新品类只新增 Category Schema |

首期不输出最终视觉品牌、数据库物理表、API 请求体、推荐模型训练方案或平台内交易设计。本文提供逻辑对象、字段和规则，供下一版开发 PRD 和原型同步使用。

## 三、核心对象与关系

| 对象 | 定义 | 主要关系 | 前台载体 |
| --- | --- | --- | --- |
| `ProjectCore` | 跨品类持续存在的作品主对象 | 作者、Schema、版本、事件、资产、关系、互动、证据 | 卡片、详情、比较列 |
| `CategoryPayload` | 指定 Category 和版本下的结构化品类数据 | 一对一挂载当前作品，可保留版本历史 | 详情品类档案、筛选、比较 |
| `Creator` | 发布或经验证管理作品的个人/小团队 | 发布、管理多个作品 | 作者主页、署名 |
| `Version` | 作品在某一时间点的发布版本 | 属于作品并产生事件 | 时间线、更新动态 |
| `LifecycleEvent` | 首次发布、更新、迁移、异常等事实 | 更新当前状态并触发动态 | 动态、时间线、通知 |
| `ReusableAsset` | 可获取的源码、模板、组件等资产 | 属于作品，可被其他作品使用 | 资产卡、比较、关系 |
| `ProjectRelation` | 两个作品之间的参考或派生关系 | 有方向，可关联资产和证据 | 来源、衍生、关系页 |
| `Evidence` | 支撑字段、事件、资产或关系的来源记录 | 绑定对象或字段路径 | 来源标签、展开面板 |
| `Interaction` | 收藏、点赞、关注、评论、分享和举报 | 关联用户与作品/事件 | 卡片、详情、个人中心 |
| `ComparisonSession` | 查询意图、所选作品和查看上下文 | 关联作品和行动记录 | 比较栏、比较页 |
| `DecisionRecord` | 比较后保存的创作推进动作 | 关联会话、字段引用和资产 | 比较完成态、个人中心 |

对象约束：

- `ProjectCore` 是所有社区内容的唯一作品主键；
- 作者验证只改变作者关系与编辑权限，不新建作品；
- 当前字段更新不得删除旧证据和历史事件；
- `CategoryPayload` 必须带 `category_id` 和 `schema_version`；
- 关系必须指向两个不同 `project_id`，方向由关系类型决定；
- 作品相似不自动等于参考、Fork 或模板派生。

## 四、导航结构

### 1. 一级导航

| 导航项 | 路由 | 核心任务 | 登录要求 |
| --- | --- | --- | --- |
| 作品广场 | `/projects` | 视觉浏览、收藏参考、进入专题 | 否 |
| 分类 | `/categories` | 按网站类型、身份与视觉方向探索 | 否 |
| 最新动态 | `/activity` | 查看发布、改版、项目、资产和状态事件 | 否 |
| 查同类 | `/discover` | 输入完整需求并确认结构化意图 | 否 |
| 关于 | `/about` | 了解定位、边界、证据与作者验证 | 否 |
| 全局搜索 | `/search?q=` | 搜作品名、标签或自然语言 | 否 |
| 比较入口 | `/compare/:sessionId` | 查看当前 2—5 个作品 | 否，登录增强 |
| 发布 | `/submit` | URL 查重并发布作品 | 是 |
| 通知 | `/notifications` | 作品更新、评论和审核提醒 | 是 |
| 个人中心 | `/me` | 管理收藏、比较、草稿、作品和验证 | 是 |

导航不新增“Portfolio”“模板”或“开源”一级入口，避免首期 Category 污染长期产品结构。它们通过首页频道、分类专题和筛选呈现。

### 2. 登录与状态保留

游客可完整浏览、搜索、查看详情、访问资产和临时加入比较。收藏、关注、评论、保存行动、发布、关系声明和身份验证需要登录。登录完成后回到触发页并只回放一次待执行动作；匿名比较在明确确认后合并到登录账户。

## 五、页面地图

### 1. 前台页面

| ID | 页面 | 路由 | 核心内容 | 优先级 |
| --- | --- | --- | --- | --- |
| P01 | 作品广场 | `/projects` | 首屏搜索、精选、最新/更新、开源可 Fork、策展专题 | P0 |
| P02 | 分类总览 | `/categories` | 网站类型、作者身份、视觉方向和资产专题 | P0 |
| P03 | 分类/专题详情 | `/categories/:slug` | 说明、筛选、代表作品、作品流、资产 | P0 |
| P04 | 最新动态 | `/activity` | 作品事件公共流 | P0 |
| P05 | 统一搜索结果 | `/search` | 模式、匹配原因、筛选、作品卡片 | P0 |
| P06 | 查同类意图确认 | `/discover` | 原始查询、结构化意图和低置信字段 | P0 |
| P07 | 同类分析 | `/discover/result` | 代表作品、结构组合、视觉/资产/状态分布 | P0 |
| P08 | 作品详情 | `/project/:id` | 展示、档案、开发、资产、历史、关系、讨论 | P0 |
| P09 | 作品比较 | `/compare/:sessionId` | 2—5 个作品、结构化差异和行动记录 | P0 |
| P10 | 发布入口 | `/submit` | URL 格式、安全、访问、重复和品类检查 | P0 |
| P11 | 发布编辑 | `/submit/new` | 预填、Portfolio Schema、资产、预览、可选关系 | P0；关系模块 P0.5 |
| P12 | 作者身份验证 | `/project/:id/verify-author` | 私密材料和人工审核状态 | P0（低频） |
| P13 | 作品更新 | `/project/:id/update` | 版本、地址、状态、资产和说明更新 | P0 |
| P14 | 作者主页 | `/creator/:id` | 简介、作品、更新、公开资产和被复用关系 | P0 |
| P15 | 个人中心 | `/me` | 收藏、关注、比较、草稿、作品、验证和关系 | P0 |
| P16 | 通知中心 | `/notifications` | 更新、评论、审核和异常提醒 | P0 |
| P17 | 登录/注册 | `/auth` | 身份认证和安全回跳 | P0 |
| P18 | 关于与收录规则 | `/about` | 定位、边界、证据、状态和作者验证 | P0 |
| P19 | 状态报告/纠错 | `/project/:id/report` | 失效、迁移、重复和字段错误 | P1 |
| P20 | 声明复用关系 | `/project/:id/reuse` | 关系类型、来源/衍生作品、资产和证据 | P0.5 |

### 2. 后台页面

| ID | 页面 | 核心能力 |
| --- | --- | --- |
| A01 | 后台首页/数据看板 | 社区、发现、比较、复用、供给和数据质量 |
| A02 | 作品列表 | 搜索、筛选、待审核、异常和批量状态 |
| A03 | 作品编辑 | `ProjectCore`、Category Schema、证据、历史、资产、关系、权限、日志 |
| A04 | 重复与合并 | 候选重复、主档、字段合并和引用迁移 |
| A05 | 发布审核 | 真实性、边界、字段、媒体、外链和证据 |
| A06 | 作者身份审核 | 私密材料、归属争议和权限 |
| A07 | 分类与字典 | Category、Schema 版本、枚举、专题和搜索映射 |
| A08 | 证据管理 | 来源、时间、可信类型、过期和争议 |
| A09 | 状态监测 | 检查队列、重定向、异常和人工复核 |
| A10 | 作品关系审核 | 参考、Fork、模板、组件和源码派生关系 |
| A11 | 社区审核 | 评论、举报、恶意外链和隐藏记录 |
| A12 | 用户与作者 | 用户状态、作者验证、权限和争议 |
| A13 | 埋点与路径 | 浏览、收藏、比较、资产、关系、发布和回流 |
| A14 | 系统设置 | 检查频率、审核规则、通知和安全策略 |

## 六、核心用户流程

### 流程 A：浏览并形成参考

1. 进入 P01，查看真实截图与策展频道；
2. 打开 P08，查看参考亮点、结构、视觉和资产；
3. 收藏参考或关注更新；
4. 从详情进入同类结果或把第二个作品加入比较；
5. 在 P15 找回收藏和最近浏览。

成功出口：用户形成一个可找回的参考集合，或进入比较。

### 流程 B：查同类并形成开发行动

1. 从全局搜索或 P06 输入完整需求；
2. 确认作者身份、类型、用途、结构、视觉、实现和复用条件；
3. 在 P05/P07 查看精确与相邻结果及匹配原因；
4. 选择 2—5 个作品进入 P09；
5. 查看差异、来源和资产；
6. 保存参考、开始开发、调整方向、复用资产或暂不开发。

成功出口：生成可恢复的 `ComparisonSession` 和可选 `DecisionRecord`。

### 流程 C：发布新作品

1. 登录后进入 P10 输入公开 URL；
2. 完成格式、安全、访问、重复和品类检查；
3. 无重复时创建草稿并进入 P11；
4. 确认 `ProjectCore` 预填字段和 `PortfolioSchemaV1` P0 字段；
5. 添加资产并预览卡片/详情；
6. P0.5 可关联收藏/比较并声明参考或复用关系；
7. 提交审核，审核通过后创建作品和首次发布事件。

### 流程 D：已有档案作者身份关联

1. P10 查重命中或 P08 点击“我是作者”；
2. 默认先查看已有档案，不提供重复新建；
3. 需要管理时进入 P12，选择域名、仓库、原发布账号、公开主页或人工材料；
4. 材料进入人工审核且不公开；
5. 通过后授予允许字段的编辑权限，历史和高风险字段继续留痕。

### 流程 E：更新与生命周期

1. 已验证作者从 P15/P08 进入 P13；
2. 选择版本、地址、状态、资产或说明更新；
3. Portfolio 更新选择结构化子类型；
4. 预览前后值、来源和影响范围；
5. 发布后更新当前字段、时间线、动态和通知。

### 流程 F：关系回流（P0.5）

1. 用户从 P11、P20 或比较历史选择来源作品；
2. 选择关系类型和关联资产；
3. 提交说明与证据；
4. 创建单方声明关系并进入 A10；
5. 作者、对方或平台确认后更新确认状态；
6. 来源作品显示衍生作品，目标作品显示参考/复用来源。

## 七、返回、恢复与跳转规则

- 从列表进入详情后，返回恢复滚动、筛选、排序和查询；
- 比较页打开详情时保留 `sessionId`、顺序和当前维度；
- 登录、外部验证或权限修复完成后回到触发页；
- 发布、更新、身份和关系表单自动保存草稿；
- 外部作品与资产链接新窗口打开并经过安全检查；
- 通知定位到对应生命周期事件或关系状态；
- 合并重复作品后，旧 ID 保留别名并重定向主档。

## 八、ProjectCore 字段字典

`ProjectCore` 不得保存网站类型、作者职业、页面结构、视觉风格或项目展示等 Portfolio 专属字段。

| 模块 | Key | 类型/枚举 | P0 | 来源与权限 | 主要用途 |
| --- | --- | --- | --- | --- | --- |
| 身份 | `project_id` | 系统唯一 ID | 必有 | 系统生成，不可编辑 | 全站主键 |
| 身份 | `current_name` | 短文本 | 必填 | 平台/作者，留痕 | 卡片、详情、搜索 |
| 身份 | `historical_names` | 名称＋起止时间列表 | 有则记录 | 事件驱动 | 去重、历史 |
| 身份 | `public_url` | URL | 必填 | 平台/作者，系统检查 | 公开体验入口 |
| 身份 | `historical_urls` | URL＋起止时间列表 | 有则记录 | 事件驱动，不可删除 | 迁移、跨域身份 |
| 身份 | `repository_url` | URL/空 | 建议 | 作者/公开证据 | 开发与源码入口 |
| 身份 | `original_platform` | 枚举＋文本 | 建议 | 平台/作者 | 来源和去重 |
| 身份 | `first_seen_at` | 时间戳 | 必有 | 系统/平台 | 首次发现 |
| 媒体 | `cover_media` | 图片/视频列表 | 至少一张 | 抓取/作者/平台 | 视觉卡片与详情 |
| 摘要 | `one_line_definition` | 不超过 80 字 | 必填 | 平台/作者 | 快速理解作品 |
| 作者 | `creator_ids` | Creator ID 列表 | 可空 | 归属与审核 | 署名和权限 |
| 作者 | `author_link_status` | `unlinked/pending/linked/failed/disputed` | 必有 | 验证流程 | 归属与权限 |
| 分类 | `category_id` | `personal_site_portfolio` | 必有 | 平台/审核 | Category 路由 |
| 分类 | `category_schema_version` | `portfolio.v1` | 必有 | 系统/A07 | 解析 Category 数据 |
| 分类 | `category_data` | 版本化 JSON 对象 | 必有 | 平台/作者，受 Schema 校验 | 首期专属档案 |
| 开发 | `ai_coding_tools` | 工具枚举＋其他 | 至少一项或已核验未知 | 作者优先/公开证据 | 搜索、比较 |
| 开发 | `tech_stack` | 统一标签列表 | 建议 | 作者/仓库证据 | 实现方式 |
| 开发 | `deployment_platform` | 枚举＋文本 | 建议 | 作者/公开证据 | 实现方式 |
| 状态 | `access_status` | 通用访问状态枚举 | 必填 | 系统/平台/作者 | 卡片、筛选、比较 |
| 状态 | `http_check_status` | `normal/redirect/timeout/dns_error/certificate_error/blocked/unknown` | 必有 | 系统 | 后台技术判断 |
| 状态 | `last_verified_at` | 时间戳 | 必填 | 系统/平台 | 时效提示 |
| 状态 | `maintenance_signal` | `repository_updated/page_updated/author_updated/no_public_change/unknown` | 建议 | 系统/平台 | 状态说明 |
| 状态 | `status_note` | 短文本/空 | 异常时必填 | 作者/平台 | 解释状态 |
| 关联 | `version_ids` | ID 列表 | 系统维护 | 系统 | 版本 |
| 关联 | `event_ids` | ID 列表 | 系统维护 | 系统 | 生命周期 |
| 关联 | `asset_ids` | ID 列表 | 可空 | 系统 | 复用资产 |
| 关联 | `relation_ids` | ID 列表 | 可空 | 系统 | 作品网络 |
| 关联 | `evidence_ids` | ID 列表 | 关键事实必有 | 系统 | 可信来源 |
| 归属 | `record_source` | `platform_editor/public_discovery/author_submission/user_submission` | 必填 | 系统记录 | 建档来源 |
| 审核 | `review_status` | 发布状态枚举 | 必填 | 审核流程 | 可见性与权限 |
| 派生 | `completeness_level` | `complete/partial/limited/pending_verification/disputed` | 系统派生 | 规则计算 | 展示和排序 |
| 派生 | `freshness_status` | `valid/expiring/expired` | 系统派生 | 时效规则 | 可信提示 |
| 派生 | `interaction_summary` | 收藏/点赞/评论/关注计数 | 系统派生 | 互动聚合 | 社区弱信号 |

## 九、PortfolioSchemaV1 字段字典

### 1. P0 字段

| 模块 | Key | 类型与枚举 | 要求 | 主要用途 |
| --- | --- | --- | --- | --- |
| 定位 | `site_type` | `personal_homepage/portfolio/online_resume/academic_homepage/hybrid` | 必填单选 | 分类、搜索、比较 |
| 定位 | `creator_roles` | `developer/designer/product_manager/creator/freelancer/student_recruit/researcher_academic/multidisciplinary/other` | 至少一项 | 策展、意图匹配 |
| 定位 | `primary_goals` | `showcase_projects/professional_presence/job_search/client_acquisition/personal_brand/academic_profile/content_hub/other` | 至少一项 | 同类识别 |
| 结构 | `page_model` | `single_page/multi_page/hybrid` | 必填 | 结构筛选 |
| 结构 | `navigation_pattern` | `top_nav/side_nav/section_anchor/minimal_overlay/no_persistent_nav/other` | 建议 | 详情和比较 |
| 结构 | `homepage_sequence` | 有序模块 Key 列表 | 建议 | 首页结构比较 |
| 结构 | `core_modules` | `hero/about/projects/experience/skills/services/testimonials/contact/blog/resume/publications/speaking/now_page/other` | 至少两项 | 筛选、详情、比较 |
| 项目展示 | `project_showcase_format` | `card_grid/gallery/timeline/case_study_list/repository_list/full_bleed/mixed/none` | 必填 | 查同类、比较 |
| 项目展示 | `case_study_depth` | `none/summary/overview/deep` | 必填 | 判断项目叙事 |
| 视觉 | `visual_styles` | 运营字典多选 | 至少一项 | 视觉搜索与专题 |
| 视觉 | `layout_patterns` | `editorial_grid/bento/split_screen/full_bleed/card_grid/timeline/immersive/freeform/other` | 至少一项 | 布局比较 |
| 视觉 | `color_character` | `monochrome/neutral/brand_led/vivid/gradient_dominant/mixed` | 必填 | 视觉方向 |
| 视觉 | `theme_mode` | `light_only/dark_only/switchable/system_adaptive` | 必填 | 主题筛选 |
| 交互 | `interaction_level` | `static/light/moderate/high` | 必填 | 成本判断 |
| 交互 | `interaction_patterns` | `microinteraction/scroll_reveal/scroll_driven/page_transition/cursor_effect/3d_webgl/motion_graphics/other/none` | 至少一项 | 详情、比较 |
| 能力 | `responsive_support` | `confirmed/partial/not_supported/unknown` | 必填 | 使用门槛 |
| 能力 | `blog_support` | `none/static/content_managed/unknown` | 必填 | 站点能力比较 |

### 2. P1 字段

| Key | 类型与枚举 | 用途 |
| --- | --- | --- |
| `cms_support` | `none/headless/built_in/unknown`＋平台文本 | 内容维护判断 |
| `multilingual_support` | `none/manual/automatic/unknown` | 多语言筛选 |
| `contact_methods` | 邮箱、表单、预约、社交、其他 | 联系能力 |
| `resume_download` | `available/not_available/unknown` | 求职型筛选 |
| `ai_features` | 统一标签列表 | 站点内 AI 能力 |

### 3. 字段规则

- `visual_styles` 使用 A07 可版本化运营字典，允许多选和弃用映射；
- `homepage_sequence` 只保存 `core_modules` 中已选择的模块及少量允许重复的自定义模块；
- `project_showcase_format=none` 时 `case_study_depth` 必须为 `none`；
- `interaction_level=static` 时 `interaction_patterns` 只能为 `none` 或可访问性必要反馈；
- Category 字段事实同样使用字段路径关联 Evidence；
- Schema 升级保留旧版本原始值和迁移日志，不原地静默重写。

## 十、复用资产模型

### 1. Asset 类型

`asset_type` 枚举：`source_code`、`starter`、`template`、`page_layout`、`ui_component`、`motion_interaction`、`theme_design_system`、`resume_module`、`blog_cms_module`、`deployment_config`、`prompt`、`design_file`。

| 枚举值 | 展示名称 |
| --- | --- |
| `source_code` | 完整源码 |
| `starter` | Starter |
| `template` | 模板 |
| `page_layout` | 页面布局 |
| `ui_component` | UI 组件 |
| `motion_interaction` | 动画/交互 |
| `theme_design_system` | 主题/设计系统 |
| `resume_module` | 简历模块 |
| `blog_cms_module` | 博客/CMS 模块 |
| `deployment_config` | 部署配置 |
| `prompt` | 提示词 |
| `design_file` | 设计稿 |

`component_role` 可选枚举：`hero/navigation/project_showcase/case_study/contact/footer/resume/blog/theme/motion/other`。

### 2. 字段

| Key | 类型/枚举 | 要求 |
| --- | --- | --- |
| `asset_id` | 唯一 ID | 必有 |
| `project_id` | 来源作品 ID | 必有 |
| `name` | 短文本 | 必填 |
| `description` | 文本 | 必填 |
| `asset_type` | 上述枚举 | 必填 |
| `component_role` | 可选枚举 | UI/模块资产建议填写 |
| `asset_url` | URL/联系入口 | 必填 |
| `license_type` | SPDX、自定义、未知 | 必填；未知可发布但显著提示 |
| `price_type` | `free/paid/contact/unknown` | 必填 |
| `acquisition_method` | `repository/clone/fork/use_template/direct_download/purchase/contact` | 必填 |
| `availability_status` | `available/login_required/paid/contact_required/link_abnormal/removed/unknown` | 必填 |
| `evidence_ids` | Evidence ID 列表 | 至少一项 |
| `last_verified_at` | 时间戳 | 必填 |

可 Fork 属于 `acquisition_method=fork` 与当前可用状态的派生结果，不以孤立布尔字段替代许可和获取信息。

## 十一、作品关系模型

### 1. 关系类型与方向

| `relation_type` | 含义 | 方向 |
| --- | --- | --- |
| `inspired_by` | 视觉、内容或交互方向受到来源作品启发 | 目标作品 → 来源作品 |
| `reference` | 开发过程中明确参考，但未直接采用资产 | 目标作品 → 来源作品 |
| `fork` | 存在可验证仓库 Fork 或等价直接派生 | 派生作品 → 来源作品 |
| `remix` | 基于原作品进行明显改造但非正式 Fork | 派生作品 → 来源作品 |
| `based_on_template` | 基于完整模板或 Starter 开发 | 派生作品 → 来源作品 |
| `uses_component` | 使用来源作品公开的具体组件/模块 | 使用作品 → 来源作品 |
| `source_derivative` | 存在代码派生，但不满足正式 Fork 定义 | 派生作品 → 来源作品 |

“同一 Starter”“同一设计结构变体”作为 P1 聚类或相似性结果，不冒充用户声明的复用事实。

### 2. 关系字段

`relation_id`、`subject_project_id`、`object_project_id`、`relation_type`、`asset_id`（可空）、`statement_by`、`statement_summary`、`confirmation_status`、`evidence_ids`、`created_at`、`last_verified_at`。方向固定解释为“subject 作品使用、参考或派生自 object 作品”，从而避免“来源作品”在字段名中的歧义。

`confirmation_status` 枚举：`pending`、`unilateral_confirmed`、`bilateral_confirmed`、`platform_verified`、`disputed`、`rejected`。

单方声明默认进入 `unilateral_confirmed` 或审核前 `pending`；只有双方分别确认后才能进入 `bilateral_confirmed`。平台基于仓库、模板标识或充分证据核验后可进入 `platform_verified`。

## 十二、生命周期模型

### 1. 通用事件

`event_type` 枚举：

- `first_seen`
- `first_published`
- `version_updated`
- `domain_migrated`
- `link_abnormal`
- `recovered`
- `paused`
- `ended`
- `asset_added`
- `relation_added`

### 2. Portfolio 更新子类型

当 `event_type=version_updated` 时，可使用 `category_change_type`：`project_added`、`case_study_added`、`blog_added`、`resume_updated`、`visual_redesign`、`theme_changed`、`tech_stack_changed`、`source_opened`、`site_repositioned`。

“产品转向”不再作为首期高频通用事件；个人网站定位变化使用 `site_repositioned`，并继续保留为版本更新的 Category 子类型。

### 3. 事件字段

`event_id`、`project_id`、`event_type`、`category_change_type`（可空）、`event_time`、`time_precision`、`event_summary`、`before_after`、`source_actor`、`evidence_ids`、`created_at`。

## 十三、访问、发布与验证状态

### 1. 访问状态

`access_status` 继续使用：`normal`、`login_required`、`pending_recheck`、`partial_abnormal`、`link_unavailable`、`suspected_migration`、`paused`、`ended`、`recovered`、`unknown`。

规则：

- 新建正式作品的主要内容必须公开，初始状态不得为 `login_required`；
- 首次技术异常只进入 `pending_recheck`；
- `paused`、`ended` 不由技术检查自动产生；
- `recovered` 创建恢复事件后，当前状态回到 `normal`；
- 异常、暂停或结束作品继续保留历史和有效资产。

### 2. 发布状态

`review_status`：`draft`、`pending_review`、`changes_requested`、`approved`、`rejected`、`withdrawn`、`published_platform`、`published_author`、`update_pending`、`restricted`、`archived`、`deleted`。

发布状态机沿用现有原型：草稿提交审核；审核通过后依据来源进入平台收录或作者发布；已有平台收录作品经作者验证后改变归属，不创建第二份作品。

### 3. 作者验证状态

`author_verification_status`：`draft`、`pending`、`changes_requested`、`verified`、`failed`、`disputed`、`withdrawn`。

验证材料与公开作品数据物理和权限隔离。通过验证只授予允许字段的编辑权限，不允许删除公开历史、迁移、争议或平台证据。

## 十四、证据与时效

`evidence_type`：`platform_verified_fact`、`verified_author_statement`、`trusted_external_source`、`system_inference`。

每条 Evidence 保存 `evidence_id`、对象类型、对象 ID、字段路径或事件 ID、来源 URL/内部记录、原始摘要、采集时间、验证时间、采集主体、可信类型、置信度和争议状态。

来源优先级不是机械覆盖：作者对建站目的、开发过程和视觉意图更有权威；平台对 URL、公开页面、历史地址和技术状态更有验证优势。系统推断必须显示置信提示，不得伪装为作者声明。

检查频率：新收录和高访问作品 7 天、普通作品 14 天、长期异常作品 30 天。证据过期不删除，只改变 `freshness_status`。

## 十五、搜索意图与匹配规则

### 1. SearchIntent

`SearchIntent` 保存：

- `original_query`
- `creator_roles`
- `site_types`
- `primary_goals`
- `page_models`
- `core_modules`
- `project_showcase_formats`
- `case_study_depths`
- `visual_styles`
- `layout_patterns`
- `color_characters`
- `theme_modes`
- `interaction_levels`
- `interaction_patterns`
- `feature_requirements`
- `ai_coding_tools`
- `tech_stack`
- `deployment_platforms`
- `asset_requirements`
- `access_requirements`

每个解析字段保存值、置信度和是否经用户确认。低置信字段不直接用于严格过滤。

### 2. 初始匹配权重

| 分组 | 权重 |
| --- | --- |
| 作者身份、网站类型、建站目的 | 25% |
| 视觉风格、布局、主题、色彩 | 25% |
| 页面结构、核心模块、项目展示、Case Study | 25% |
| AI 工具、技术栈、部署 | 10% |
| 开源、可 Fork 和资产条件 | 10% |
| 访问状态、证据时效和完整度 | 5% |

匹配权重为可配置产品参数；调整必须保留版本和评估记录。结果页显示主要匹配原因，不展示不可解释的综合分。

### 3. 结果不足

- 精确结果 ≥3：正常显示并开放同类分析；
- 精确结果 1—2：显示精确结果和放宽条件后的相邻结果；
- 精确结果 0：保留原始意图，展示可修改字段、相关专题和保存查询；
- 不得把零结果解释为需求不存在或方向不值得开发。

## 十六、比较模型

### 1. ComparisonSession

保存 `session_id`、所有者或匿名会话、`SearchIntent`（可空）、2—5 个 `project_id`、顺序、来源路径、当前维度、保存时间和 `decision_id`。

### 2. 比较维度

| Dimension ID | 名称 | 主要字段 |
| --- | --- | --- |
| `positioning` | 定位与用途 | 定义、网站类型、作者身份、建站目的 |
| `content_structure` | 内容结构 | 页面结构、导航、首页顺序、核心模块 |
| `project_showcase` | 项目展示 | 展示形式、Case Study 深度 |
| `visual_direction` | 视觉方向 | 风格、布局、色彩、主题 |
| `interaction_motion` | 交互动画 | 等级和交互方式 |
| `site_capabilities` | 站点能力 | 响应式、博客及 P1 能力 |
| `implementation` | 实现方式 | AI 工具、技术栈、部署、仓库 |
| `reuse` | 复用条件 | 资产、许可、价格、获取方式 |
| `status_evidence` | 状态与证据 | 访问状态、验证时间、完整度、来源 |

### 3. DecisionRecord

`action`：`save_reference`、`start_building`、`adjust_direction`、`reuse_asset`、`pause`。

`affected_field_refs` 保存可扩展字段路径，不再使用固定的目标用户、输入或流程枚举。记录还包括原因、关联资产、关联作品、私密可见性和时间。

“保存比较会话”和“保存下一步行动”必须使用不同文案与不同成功状态，避免被理解为同一动作。

## 十七、页面信息模块

### P01 作品广场

全局导航；首屏主表达和统一搜索；编辑精选；最新发布/最近更新；开源可 Fork；按个人网站类型探索；按视觉方向探索；优秀 Case Study；可复用起点；已结束但仍可复用；悬浮比较栏。

### P02/P03 分类与专题

分类导航、专题说明、筛选、代表作品、作品流、最近事件和资产。专题可按网站类型、作者身份、视觉方向、项目展示或复用条件配置，不将运营专题写回 Category 枚举。

### P05/P06/P07 搜索与查同类

统一搜索模式；原始查询；结构化意图标签；低置信提示；精确/相邻结果；匹配原因；筛选；代表结构组合；视觉、资产和状态分布。

### P08 作品详情

媒体与摘要；参考亮点；定位与结构；项目展示；视觉与交互；站点能力；开发信息；资产；当前状态；时间线；来源/衍生关系；讨论；相关推荐。

### P09 作品比较

对象管理；维度导航；仅看差异/查看全部；字段来源和时效；资产快捷区；会话保存；创作推进动作。

### P10/P11 发布

URL 检查；重复分流；自动预填；`ProjectCore` 确认；`PortfolioSchemaV1` P0 字段；资产；卡片/详情预览；审核状态；P0.5 参考与复用来源。

### P12/P13 验证与更新

身份材料与私密说明；审核历史；版本、地址、状态、资产和说明更新；Portfolio 变更子类型；前后值与证据。

### P14/P15 作者与个人中心

作者简介、已确认作品、最近更新、公开资产和被复用关系；收藏参考、关注、比较、草稿、审核、作品、验证和本人声明的关系。

### A03 后台作品编辑

顶部摘要；左侧模块为身份、Category、开发、状态、历史、资产、关系、证据、权限和日志。字段编辑区必须明确显示“通用字段”与“Portfolio Schema”，并在 Schema 区显示版本、迁移状态和字段路径。

## 十八、关键交互与异常

| 场景 | 系统表现 | 用户出口 |
| --- | --- | --- |
| 无结果 | 显示原条件、放宽建议和相关专题 | 修改意图、保存查询 |
| 字段未知/过期 | 显示原因和最后验证时间 | 查看来源、请求补充 |
| 比较不足 2 个 | 提示再选一个，不进入正式比较 | 返回结果或推荐候选 |
| 比较超过 5 个 | 阻止加入并要求替换 | 移除或替换 |
| 资产许可未知 | 可查看但明确未知，不显示“可自由使用” | 联系作者、查看来源 |
| 重复作品 | 展示已有档案，禁止默认新建 | 查看详情、验证身份、提交非重复证据 |
| AI 辅助证据不足 | 保留内部候选，不公开发布 | 补充作者声明或公开证据 |
| 作品主要内容需登录 | 不通过新收录；历史作品更新状态 | 补充公开入口或保留历史 |
| 关系证据不足 | 保存待审核/单方声明，不升级可信状态 | 补充证据、邀请确认 |
| 关系争议 | 并列来源并冻结高风险编辑 | 提交证据、平台裁决 |
| 首次链接异常 | 内部等待复检，不立即改前台终态 | 重试、作者说明 |
| 外链风险 | 阻止自动跳转并说明风险 | 取消或明确确认 |
| 权限失效 | 保留表单草稿和已填内容 | 重新验证、返回 |

## 十九、权限矩阵

| 能力 | 游客 | 注册用户 | 已验证作者 | 平台编辑 | 管理员 |
| --- | --- | --- | --- | --- | --- |
| 浏览、搜索、查看来源 | 是 | 是 | 是 | 是 | 是 |
| 临时加入比较 | 是 | 是 | 是 | 是 | 是 |
| 收藏、关注、评论 | 否 | 是 | 是 | 是 | 是 |
| 保存比较/行动 | 提交时登录 | 是 | 是 | 是 | 是 |
| 提交新作品 | 否 | 是 | 是 | 是 | 是 |
| 声明作品关系 | 否 | P0.5 | P0.5 | 是 | 是 |
| 验证身份 | 否 | 是 | 是 | 是 | 是 |
| 编辑已关联作品普通字段 | 否 | 否 | 是 | 是 | 是 |
| 修改历史/高风险字段 | 否 | 否 | 提交更正 | 审核且留痕 | 是且留痕 |
| 建档、合并、去重 | 否 | 否 | 否 | 是 | 是 |
| 审核关系与归属争议 | 否 | 否 | 否 | 受限 | 是 |
| 维护 Category Schema | 否 | 否 | 否 | 受限 | 是 |

## 二十、数据完整度与展示

| 等级 | 条件 | 前台规则 |
| --- | --- | --- |
| 完整 | 身份、P0 Category、开发、状态、验证时间和关键证据完整 | 进入核心结果、精选和完整比较 |
| 部分完整 | 身份和状态可确认，但部分 P0 比较字段缺失 | 可展示；比较标未知 |
| 信息有限 | 只能确认作品存在和 URL | 仅精确搜索命中，限制进入同类分析 |
| 待验证 | 关键事实只有推断或证据过期 | 显示待验证，降低排序 |
| 争议 | 归属、状态、资产或关系有冲突 | 显示争议和并列来源 |

冷启动正式档案的 P0 Category 字段完整率目标为 85% 以上，关键可核验字段证据覆盖率 80% 以上，最近 30 天访问状态有效率 90% 以上。

## 二十一、冷启动数据规则

正式发布前建立 64 个档案，8 个策展子群每群至少 6 个；至少 24 个开源或可 Fork，至少 32 个具有资产。单一技术栈或 AI Coding 工具不超过 40%。

每个重点子群至少能够形成：

- 3 个以上结构相近但视觉明显不同的作品；
- 3 个以上视觉相近但内容结构或实现方式不同的作品；
- 至少 2 个具有可获取资产的作品；
- 至少一个能够展示有效版本或资产更新的生命周期案例。

若某子群无法满足最低密度，暂不作为首页独立频道，但作品仍可通过结构化筛选进入相邻专题；不得用低质量作品填充数量。

## 二十二、原型与开发 PRD 衔接

原型同步时保留 P01—P20/A01—A14 ID 和现有主路由。数据/内容层需要全面替换模拟作品、文案、标签、筛选、详情字段、比较行、发布字段和测试任务。

局部结构调整：

1. P11 在现有开发/资产步骤增加可跳过的参考与复用来源模块；
2. P20 从 P1 前移至 P0.5，并与 P11、P08、P15、A10 连接；
3. A03 把原字段编辑区拆为 `ProjectCore` 与版本化 `PortfolioSchemaV1`；
4. P09 明确区分“保存比较会话”和“保存创作推进动作”。

下一版开发 PRD 需要同步更新领域类型、接口 Schema、搜索索引、比较矩阵、发布校验、审核队列、埋点和数据迁移规则，但本轮不直接修改该 PRD。

## 二十三、最终结构摘要

VibeCheck 首期由社区化公共前台、以作品详情为中心的参考与比较链路、发布与更新的作者链路，以及维护作品、Category、证据、状态、资产和关系的运营后台组成。

所有页面围绕 `project_id` 组织；Portfolio 专属字段进入 `PortfolioSchemaV1`；关键事实带来源和验证时间；状态变化写入生命周期事件；复用行为尽量转化为有方向、有证据和有确认状态的作品关系。该结构既支持首期个人主页与作品集，也为后续 Vibe Coding 品类保留稳定的通用主模型。
