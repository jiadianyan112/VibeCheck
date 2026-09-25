export interface RouteCatalogItem {
  id: string
  name: string
  path: string
  area: 'frontstage' | 'admin'
}

export const routeCatalog: RouteCatalogItem[] = [
  { id: 'P01', name: '作品广场', path: '/projects', area: 'frontstage' },
  { id: 'P02', name: '分类总览', path: '/categories', area: 'frontstage' },
  { id: 'P03', name: '分类／专题详情', path: '/categories/:slug', area: 'frontstage' },
  { id: 'P04', name: '最新动态', path: '/activity', area: 'frontstage' },
  { id: 'P05', name: '统一搜索结果', path: '/search', area: 'frontstage' },
  { id: 'P06', name: '完整想法分析', path: '/discover', area: 'frontstage' },
  { id: 'P07', name: '想法匹配分析', path: '/discover/result', area: 'frontstage' },
  { id: 'P08', name: '作品详情', path: '/project/:id', area: 'frontstage' },
  { id: 'P09', name: '作品比较', path: '/compare/:sessionId', area: 'frontstage' },
  { id: 'P10', name: '发布入口', path: '/submit', area: 'frontstage' },
  { id: 'P11', name: '发布编辑', path: '/submit/new', area: 'frontstage' },
  { id: 'P12', name: '作者身份验证', path: '/project/:id/verify-author', area: 'frontstage' },
  { id: 'P13', name: '作品更新', path: '/project/:id/update', area: 'frontstage' },
  { id: 'P14', name: '作者主页', path: '/creator/:id', area: 'frontstage' },
  { id: 'P15', name: '个人中心', path: '/me', area: 'frontstage' },
  { id: 'P16', name: '通知中心', path: '/notifications', area: 'frontstage' },
  { id: 'P17', name: '登录／注册', path: '/auth', area: 'frontstage' },
  { id: 'P18', name: '关于与收录规则', path: '/about', area: 'frontstage' },
  { id: 'A01', name: '后台首页／数据看板', path: '/admin', area: 'admin' },
  { id: 'A02', name: '作品列表', path: '/admin/projects', area: 'admin' },
  { id: 'A03', name: '作品编辑', path: '/admin/project/:id', area: 'admin' },
  { id: 'A04', name: '重复与合并', path: '/admin/duplicates', area: 'admin' },
  { id: 'A05', name: '发布审核', path: '/admin/reviews', area: 'admin' },
  { id: 'A06', name: '作者身份审核', path: '/admin/author-verification', area: 'admin' },
  { id: 'A08', name: '证据管理', path: '/admin/evidence', area: 'admin' },
  { id: 'A09', name: '状态监测', path: '/admin/status-monitor', area: 'admin' },
]
