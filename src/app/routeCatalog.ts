export interface RouteCatalogItem {
  id: string
  name: string
  path: string
  area: 'frontstage' | 'admin'
  pendingModules: string[]
}

export const routeCatalog: RouteCatalogItem[] = [
  { id: 'P01', name: '作品广场', path: '/projects', area: 'frontstage', pendingModules: ['精选', '最新发布', '最近更新', '开源可复用', '问题探索'] },
  { id: 'P02', name: '分类总览', path: '/categories', area: 'frontstage', pendingModules: ['主分类', '专题', '子场景入口'] },
  { id: 'P03', name: '分类／专题详情', path: '/categories/:slug', area: 'frontstage', pendingModules: ['专题说明', '解决路径', '筛选', '作品流', '资产'] },
  { id: 'P04', name: '最新动态', path: '/activity', area: 'frontstage', pendingModules: ['作品事件公共流'] },
  { id: 'P05', name: '统一搜索结果', path: '/search', area: 'frontstage', pendingModules: ['搜索模式', '匹配原因', '筛选', '作品卡片'] },
  { id: 'P06', name: '完整想法分析', path: '/discover', area: 'frontstage', pendingModules: ['目标用户', '场景', '输入', '练习形式', '输出确认'] },
  { id: 'P07', name: '想法匹配分析', path: '/discover/result', area: 'frontstage', pendingModules: ['方案分组', '状态分布', '代表作品', '资产分布'] },
  { id: 'P08', name: '作品详情', path: '/project/:id', area: 'frontstage', pendingModules: ['展示', '档案', '历史', '资产', '关系', '讨论'] },
  { id: 'P09', name: '作品比较', path: '/compare/:sessionId', area: 'frontstage', pendingModules: ['二至五个作品', '结构化差异', '决策记录'] },
  { id: 'P10', name: '发布入口', path: '/submit', area: 'frontstage', pendingModules: ['地址输入', '查重', '分流'] },
  { id: 'P11', name: '发布编辑', path: '/submit/new', area: 'frontstage', pendingModules: ['自动预填', '结构化补充', '资产', '预览'] },
  { id: 'P12', name: '作者身份验证', path: '/project/:id/verify-author', area: 'frontstage', pendingModules: ['身份材料', '人工审核状态'] },
  { id: 'P13', name: '作品更新', path: '/project/:id/update', area: 'frontstage', pendingModules: ['版本', '地址', '状态', '资产', '说明更新'] },
  { id: 'P14', name: '作者主页', path: '/creator/:id', area: 'frontstage', pendingModules: ['简介', '作品', '更新', '公开资产', '被复用关系'] },
  { id: 'P15', name: '个人中心', path: '/me', area: 'frontstage', pendingModules: ['收藏', '关注', '比较', '草稿', '作品', '验证记录'] },
  { id: 'P16', name: '通知中心', path: '/notifications', area: 'frontstage', pendingModules: ['作品更新', '评论回复', '审核', '异常提醒'] },
  { id: 'P17', name: '登录／注册', path: '/auth', area: 'frontstage', pendingModules: ['身份模拟', '原页面回跳'] },
  { id: 'P18', name: '关于与收录规则', path: '/about', area: 'frontstage', pendingModules: ['定位', '边界', '可信机制', '作者身份验证说明'] },
  { id: 'A01', name: '后台首页／数据看板', path: '/admin', area: 'admin', pendingModules: ['关键指标', '待办占位'] },
  { id: 'A02', name: '作品列表', path: '/admin/projects', area: 'admin', pendingModules: ['筛选', '搜索', '待审核', '异常作品'] },
  { id: 'A03', name: '作品编辑', path: '/admin/project/:id', area: 'admin', pendingModules: ['字段', '证据', '历史', '关系', '权限', '日志'] },
  { id: 'A04', name: '重复与合并', path: '/admin/duplicates', area: 'admin', pendingModules: ['候选重复', '主档', '合并预览'] },
  { id: 'A05', name: '发布审核', path: '/admin/reviews', area: 'admin', pendingModules: ['通过', '退回', '拒绝'] },
  { id: 'A06', name: '作者身份审核', path: '/admin/author-verification', area: 'admin', pendingModules: ['材料', '归属状态'] },
  { id: 'A08', name: '证据管理', path: '/admin/evidence', area: 'admin', pendingModules: ['来源', '验证时间'] },
  { id: 'A09', name: '状态监测', path: '/admin/status-monitor', area: 'admin', pendingModules: ['检查队列', '异常复核'] },
]
