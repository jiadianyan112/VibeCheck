import {
  assetId,
  creatorId,
  evidenceId,
  projectId,
  relationId,
  type AiCodingTool,
  type BlogSupport,
  type CaseStudyDepth,
  type ColorCharacter,
  type CoreModule,
  type CreatorRole,
  type InteractionLevel,
  type InteractionPattern,
  type LayoutPattern,
  type NavigationPattern,
  type PageModel,
  type PrimaryGoal,
  type Project,
  type ProjectShowcaseFormat,
  type ResponsiveSupport,
  type SiteType,
  type ThemeMode,
  type VisualStyle,
} from '../types'
import { knownFact, unknownFact } from './factories'

type WireframeVariant = NonNullable<Project['coverMedia'][number]['variant']>

interface PortfolioSeed {
  id: string
  name: string
  summary: string
  group: string
  siteType: SiteType
  roles: CreatorRole[]
  goals: PrimaryGoal[]
  pageModel: PageModel
  navigation: NavigationPattern
  modules: CoreModule[]
  showcase: ProjectShowcaseFormat
  caseDepth: CaseStudyDepth
  visual: VisualStyle[]
  layouts: LayoutPattern[]
  color: ColorCharacter
  theme: ThemeMode
  interaction: InteractionLevel
  interactionPatterns: InteractionPattern[]
  responsive: ResponsiveSupport
  blog: BlogSupport
  stack: string[]
  tools: AiCodingTool[]
  deployment: string
  variant: WireframeVariant
  creatorKey: string
  repository?: string
  assets?: string[]
}

const verifiedAt = '2026-08-08T10:00:00+08:00'
const portfolioRelationKeys: Record<string, string[]> = {
  'project-atlas-home': ['relation-form-atlas', 'relation-first-atlas'],
  'project-form-field': ['relation-form-atlas'],
  'project-stackfolio': ['relation-terminal-stack'],
  'project-terminal-craft': ['relation-terminal-stack'],
  'project-first-launch': ['relation-first-atlas'],
  'project-lab-notebook': ['relation-scholar-lab'],
  'project-scholar-site': ['relation-scholar-lab'],
}

function makePortfolioProject(seed: PortfolioSeed): Project {
  const evidenceKey = `evidence-${seed.id.replace('project-', '')}-public`
  const fact = { evidenceKey, lastVerifiedAt: verifiedAt }
  const notApplicable = '该字段属于 AI 学习与题库 Schema，不适用于个人主页与作品集。'

  return {
    id: projectId(seed.id),
    currentName: knownFact(seed.name, fact),
    historicalNames: [],
    publicUrl: knownFact(`https://portfolio.example.test/${seed.id.replace('project-', '')}`, fact),
    historicalUrls: [],
    repositoryUrl: knownFact(seed.repository ?? null, fact),
    originalPlatform: knownFact('独立公开 Web 站点', fact),
    firstSeenAt: '2026-06-01T09:00:00+08:00',
    createdAt: '2026-05-20T09:00:00+08:00',
    coverMedia: [{ id: `${seed.id}-cover`, kind: 'wireframe', url: null, alt: `${seed.name} 首页结构线框`, variant: seed.variant }],
    categoryId: 'personal_site_portfolio',
    categorySchemaVersion: 'portfolio.v1',
    categoryGroup: seed.group,
    summary: knownFact(seed.summary, fact),
    categoryData: {
      siteType: knownFact(seed.siteType, fact),
      creatorRoles: knownFact(seed.roles, fact),
      primaryGoals: knownFact(seed.goals, fact),
      pageModel: knownFact(seed.pageModel, fact),
      navigationPattern: knownFact(seed.navigation, fact),
      homepageSequence: knownFact(seed.modules, fact),
      coreModules: knownFact(seed.modules, fact),
      projectShowcaseFormat: knownFact(seed.showcase, fact),
      caseStudyDepth: knownFact(seed.caseDepth, fact),
      visualStyles: knownFact(seed.visual, fact),
      layoutPatterns: knownFact(seed.layouts, fact),
      colorCharacter: knownFact(seed.color, fact),
      themeMode: knownFact(seed.theme, fact),
      interactionLevel: knownFact(seed.interaction, fact),
      interactionPatterns: knownFact(seed.interactionPatterns, fact),
      responsiveSupport: knownFact(seed.responsive, fact),
      blogSupport: knownFact(seed.blog, fact),
      cmsSupport: knownFact(seed.blog === 'content_managed' ? 'headless' : 'none', fact),
      cmsPlatform: knownFact(seed.blog === 'content_managed' ? '轻量 Headless CMS' : null, fact),
      multilingualSupport: knownFact('none', fact),
      contactMethods: knownFact(['email', 'social'], fact),
      resumeDownload: knownFact(seed.modules.includes('resume') ? 'available' : 'not_available', fact),
      aiFeatures: knownFact([], fact),
    },
    oneLineDefinition: knownFact(seed.summary, fact),
    targetUsers: unknownFact(notApplicable, fact),
    coreProblem: unknownFact(notApplicable, fact),
    useScenarios: unknownFact(notApplicable, fact),
    mainInputs: unknownFact(notApplicable, fact),
    mainOutputs: unknownFact(notApplicable, fact),
    coreFlow: unknownFact(notApplicable, fact),
    contentProcessing: unknownFact(notApplicable, fact),
    practiceFormats: unknownFact(notApplicable, fact),
    feedbackMethods: unknownFact(notApplicable, fact),
    learningRecords: unknownFact(notApplicable, fact),
    differentiation: unknownFact(notApplicable, fact),
    coreFeatures: unknownFact(notApplicable, fact),
    secondaryFeatures: unknownFact(notApplicable, fact),
    loginRequirement: unknownFact(notApplicable, fact),
    sharingCapability: unknownFact(notApplicable, fact),
    aiCodingTools: knownFact(seed.tools, fact),
    modelsUsed: knownFact(['公开作者声明：AI 编程辅助'], fact),
    techStack: knownFact(seed.stack, fact),
    deploymentPlatform: knownFact(seed.deployment, fact),
    developmentCycle: knownFact('2—4 周迭代', fact),
    keyDependencies: knownFact(['浏览器运行环境', '静态内容或内容服务'], fact),
    accessStatus: knownFact('normal', fact),
    httpCheckStatus: 'normal',
    lastVerifiedAt: verifiedAt,
    maintenanceSignal: 'page_updated',
    statusNote: knownFact(null, fact),
    versionIds: [],
    eventIds: [`event-${seed.id.replace('project-', '')}-first` as Project['eventIds'][number]],
    assetIds: (seed.assets ?? []).map(assetId),
    relationIds: (portfolioRelationKeys[seed.id] ?? []).map(relationId),
    creatorIds: [creatorId(seed.creatorKey)],
    recordSource: 'author_submission',
    authorLinkStatus: 'linked',
    completenessLevel: 'complete',
    freshnessStatus: 'valid',
    interactionSummary: { favoriteCount: seed.name.length * 9, likeCount: seed.name.length * 5, commentCount: seed.name.length % 6, followerCount: seed.name.length * 4 },
    reviewStatus: 'published_author',
  }
}

export const portfolioProjects: Project[] = [
  makePortfolioProject({ id: 'project-atlas-home', name: 'Atlas Home', summary: '用清晰章节串起身份、精选项目与近况的通用个人主页。', group: '通用个人主页', siteType: 'personal_homepage', roles: ['multidisciplinary'], goals: ['professional_presence', 'personal_brand'], pageModel: 'single_page', navigation: 'section_anchor', modules: ['hero', 'about', 'projects', 'experience', 'contact'], showcase: 'card_grid', caseDepth: 'summary', visual: ['minimal', 'typographic'], layouts: ['editorial_grid'], color: 'neutral', theme: 'light_only', interaction: 'light', interactionPatterns: ['microinteraction', 'scroll_reveal'], responsive: 'confirmed', blog: 'none', stack: ['Astro', 'CSS'], tools: ['claude_code'], deployment: 'Cloudflare Pages', variant: 'editorial', creatorKey: 'creator-portfolio-general', repository: 'https://example.test/repos/atlas-home', assets: ['asset-atlas-starter'] }),
  makePortfolioProject({ id: 'project-quiet-index', name: 'Quiet Index', summary: '以极简索引呈现个人简介、工作与联系入口。', group: '通用个人主页', siteType: 'personal_homepage', roles: ['multidisciplinary'], goals: ['professional_presence'], pageModel: 'multi_page', navigation: 'top_nav', modules: ['hero', 'about', 'projects', 'now_page', 'contact'], showcase: 'gallery', caseDepth: 'overview', visual: ['minimal', 'editorial'], layouts: ['split_screen'], color: 'monochrome', theme: 'switchable', interaction: 'light', interactionPatterns: ['page_transition'], responsive: 'confirmed', blog: 'static', stack: ['Next.js', 'CSS Modules'], tools: ['cursor'], deployment: 'Vercel', variant: 'split', creatorKey: 'creator-portfolio-general', assets: ['asset-quiet-layout'] }),
  makePortfolioProject({ id: 'project-stackfolio', name: 'Stackfolio', summary: '开发者的项目、源码与技术文章入口，突出可运行作品。', group: '开发者', siteType: 'portfolio', roles: ['developer'], goals: ['showcase_projects', 'professional_presence'], pageModel: 'multi_page', navigation: 'top_nav', modules: ['hero', 'projects', 'skills', 'blog', 'contact'], showcase: 'repository_list', caseDepth: 'overview', visual: ['brutalist', 'typographic'], layouts: ['card_grid'], color: 'monochrome', theme: 'dark_only', interaction: 'moderate', interactionPatterns: ['microinteraction', 'page_transition'], responsive: 'confirmed', blog: 'content_managed', stack: ['React', 'TypeScript'], tools: ['codex'], deployment: 'Netlify', variant: 'bento', creatorKey: 'creator-portfolio-developer', repository: 'https://example.test/repos/stackfolio', assets: ['asset-stack-source'] }),
  makePortfolioProject({ id: 'project-terminal-craft', name: 'Terminal Craft', summary: '用终端式导航展示开源项目、实验和开发日志。', group: '开发者', siteType: 'portfolio', roles: ['developer'], goals: ['showcase_projects', 'content_hub'], pageModel: 'single_page', navigation: 'no_persistent_nav', modules: ['hero', 'projects', 'skills', 'blog', 'contact'], showcase: 'timeline', caseDepth: 'summary', visual: ['brutalist', 'retro'], layouts: ['timeline'], color: 'brand_led', theme: 'dark_only', interaction: 'high', interactionPatterns: ['cursor_effect', 'motion_graphics'], responsive: 'partial', blog: 'static', stack: ['SvelteKit', 'TypeScript'], tools: ['replit'], deployment: 'Cloudflare Pages', variant: 'minimal', creatorKey: 'creator-portfolio-developer', repository: 'https://example.test/repos/terminal-craft', assets: ['asset-terminal-component'] }),
  makePortfolioProject({ id: 'project-form-field', name: 'Form & Field', summary: '以深度 Case Study 展示品牌与数字产品设计过程。', group: '设计师', siteType: 'portfolio', roles: ['designer'], goals: ['showcase_projects', 'client_acquisition'], pageModel: 'multi_page', navigation: 'minimal_overlay', modules: ['hero', 'projects', 'about', 'services', 'contact'], showcase: 'case_study_list', caseDepth: 'deep', visual: ['editorial', 'photographic'], layouts: ['full_bleed'], color: 'neutral', theme: 'light_only', interaction: 'moderate', interactionPatterns: ['scroll_reveal', 'page_transition'], responsive: 'confirmed', blog: 'none', stack: ['Next.js', 'Framer Motion'], tools: ['v0'], deployment: 'Vercel', variant: 'editorial', creatorKey: 'creator-portfolio-designer', repository: 'https://example.test/repos/form-field', assets: ['asset-form-design'] }),
  makePortfolioProject({ id: 'project-mono-studio', name: 'Mono Studio', summary: '以大图项目流和简短说明呈现跨媒介视觉作品。', group: '设计师', siteType: 'portfolio', roles: ['designer'], goals: ['showcase_projects', 'personal_brand'], pageModel: 'single_page', navigation: 'side_nav', modules: ['hero', 'projects', 'about', 'contact'], showcase: 'full_bleed', caseDepth: 'overview', visual: ['minimal', 'photographic'], layouts: ['immersive'], color: 'monochrome', theme: 'light_only', interaction: 'high', interactionPatterns: ['scroll_driven', 'cursor_effect'], responsive: 'confirmed', blog: 'none', stack: ['Webflow', 'JavaScript'], tools: ['lovable'], deployment: 'Webflow', variant: 'split', creatorKey: 'creator-portfolio-designer' }),
  makePortfolioProject({ id: 'project-product-notes', name: 'Product Notes', summary: '用问题、决策和结果串起产品案例，兼顾文章与履历。', group: '产品经理', siteType: 'portfolio', roles: ['product_manager'], goals: ['showcase_projects', 'job_search'], pageModel: 'multi_page', navigation: 'top_nav', modules: ['hero', 'projects', 'experience', 'blog', 'resume', 'contact'], showcase: 'case_study_list', caseDepth: 'deep', visual: ['editorial', 'typographic'], layouts: ['editorial_grid'], color: 'neutral', theme: 'system_adaptive', interaction: 'light', interactionPatterns: ['microinteraction'], responsive: 'confirmed', blog: 'content_managed', stack: ['Next.js', 'MDX'], tools: ['cursor'], deployment: 'Vercel', variant: 'editorial', creatorKey: 'creator-portfolio-product', repository: 'https://example.test/repos/product-notes', assets: ['asset-product-case'] }),
  makePortfolioProject({ id: 'project-roadmap-self', name: 'Roadmap Self', summary: '用时间线概括产品经历、代表项目和公开演讲。', group: '产品经理', siteType: 'personal_homepage', roles: ['product_manager'], goals: ['professional_presence', 'personal_brand'], pageModel: 'single_page', navigation: 'section_anchor', modules: ['hero', 'experience', 'projects', 'speaking', 'contact'], showcase: 'timeline', caseDepth: 'summary', visual: ['minimal'], layouts: ['timeline'], color: 'brand_led', theme: 'light_only', interaction: 'static', interactionPatterns: ['none'], responsive: 'confirmed', blog: 'none', stack: ['Astro', 'CSS'], tools: ['claude_code'], deployment: 'GitHub Pages', variant: 'minimal', creatorKey: 'creator-portfolio-product' }),
  makePortfolioProject({ id: 'project-field-notes', name: 'Field Notes', summary: '自由摄影师的服务、项目画廊与委托入口。', group: '创作者/自由职业者', siteType: 'portfolio', roles: ['creator', 'freelancer'], goals: ['client_acquisition', 'personal_brand'], pageModel: 'multi_page', navigation: 'minimal_overlay', modules: ['hero', 'projects', 'services', 'testimonials', 'contact'], showcase: 'gallery', caseDepth: 'overview', visual: ['photographic', 'editorial'], layouts: ['full_bleed'], color: 'mixed', theme: 'light_only', interaction: 'moderate', interactionPatterns: ['scroll_reveal', 'page_transition'], responsive: 'confirmed', blog: 'none', stack: ['Nuxt', 'Vue'], tools: ['lovable'], deployment: 'Netlify', variant: 'editorial', creatorKey: 'creator-portfolio-independent', assets: ['asset-field-layout'] }),
  makePortfolioProject({ id: 'project-independent-room', name: 'Independent Room', summary: '用模块化首页整合作品、服务、文章和预约方式。', group: '创作者/自由职业者', siteType: 'hybrid', roles: ['freelancer'], goals: ['client_acquisition', 'content_hub'], pageModel: 'hybrid', navigation: 'top_nav', modules: ['hero', 'projects', 'services', 'blog', 'contact'], showcase: 'mixed', caseDepth: 'summary', visual: ['playful', 'illustrative'], layouts: ['bento'], color: 'vivid', theme: 'switchable', interaction: 'moderate', interactionPatterns: ['microinteraction', 'scroll_reveal'], responsive: 'confirmed', blog: 'content_managed', stack: ['React', 'Supabase'], tools: ['bolt'], deployment: 'Vercel', variant: 'bento', creatorKey: 'creator-portfolio-independent', repository: 'https://example.test/repos/independent-room', assets: ['asset-room-template'] }),
  makePortfolioProject({ id: 'project-first-launch', name: 'First Launch', summary: '应届开发者用三个课程外项目证明能力与成长轨迹。', group: '学生/应届生', siteType: 'portfolio', roles: ['student_recruit', 'developer'], goals: ['job_search', 'showcase_projects'], pageModel: 'single_page', navigation: 'section_anchor', modules: ['hero', 'projects', 'skills', 'experience', 'resume', 'contact'], showcase: 'card_grid', caseDepth: 'overview', visual: ['minimal', 'playful'], layouts: ['card_grid'], color: 'brand_led', theme: 'system_adaptive', interaction: 'light', interactionPatterns: ['microinteraction'], responsive: 'confirmed', blog: 'none', stack: ['React', 'TypeScript'], tools: ['v0'], deployment: 'Vercel', variant: 'bento', creatorKey: 'creator-portfolio-student', repository: 'https://example.test/repos/first-launch', assets: ['asset-first-starter'] }),
  makePortfolioProject({ id: 'project-campus-canvas', name: 'Campus Canvas', summary: '学生设计师把课程、社团和实习项目整理成一条叙事线。', group: '学生/应届生', siteType: 'portfolio', roles: ['student_recruit', 'designer'], goals: ['job_search', 'showcase_projects'], pageModel: 'multi_page', navigation: 'top_nav', modules: ['hero', 'about', 'projects', 'experience', 'resume', 'contact'], showcase: 'case_study_list', caseDepth: 'deep', visual: ['editorial', 'playful'], layouts: ['editorial_grid'], color: 'vivid', theme: 'light_only', interaction: 'moderate', interactionPatterns: ['scroll_reveal'], responsive: 'confirmed', blog: 'none', stack: ['Framer', 'React'], tools: ['cursor'], deployment: 'Framer', variant: 'split', creatorKey: 'creator-portfolio-student' }),
  makePortfolioProject({ id: 'project-one-page-cv', name: 'One Page CV', summary: '招聘优先的一页式简历站，含经历、技能与 PDF 下载。', group: '在线简历', siteType: 'online_resume', roles: ['developer'], goals: ['job_search'], pageModel: 'single_page', navigation: 'section_anchor', modules: ['hero', 'experience', 'skills', 'resume', 'contact'], showcase: 'none', caseDepth: 'none', visual: ['minimal', 'typographic'], layouts: ['split_screen'], color: 'monochrome', theme: 'light_only', interaction: 'static', interactionPatterns: ['none'], responsive: 'confirmed', blog: 'none', stack: ['HTML', 'CSS'], tools: ['codex'], deployment: 'GitHub Pages', variant: 'resume', creatorKey: 'creator-portfolio-resume', repository: 'https://example.test/repos/one-page-cv', assets: ['asset-cv-template'] }),
  makePortfolioProject({ id: 'project-brief-profile', name: 'Brief Profile', summary: '适合快速投递的多页履历，补充少量代表项目。', group: '在线简历', siteType: 'online_resume', roles: ['product_manager'], goals: ['job_search', 'professional_presence'], pageModel: 'multi_page', navigation: 'top_nav', modules: ['hero', 'experience', 'projects', 'resume', 'contact'], showcase: 'card_grid', caseDepth: 'summary', visual: ['corporate', 'minimal'], layouts: ['card_grid'], color: 'neutral', theme: 'system_adaptive', interaction: 'light', interactionPatterns: ['page_transition'], responsive: 'confirmed', blog: 'none', stack: ['Next.js', 'Tailwind CSS'], tools: ['claude_code'], deployment: 'Vercel', variant: 'resume', creatorKey: 'creator-portfolio-resume' }),
  makePortfolioProject({ id: 'project-lab-notebook', name: 'Lab Notebook', summary: '研究者的论文、项目、教学与公开笔记入口。', group: '学术主页', siteType: 'academic_homepage', roles: ['researcher_academic'], goals: ['academic_profile', 'content_hub'], pageModel: 'multi_page', navigation: 'side_nav', modules: ['hero', 'about', 'publications', 'projects', 'blog', 'contact'], showcase: 'repository_list', caseDepth: 'overview', visual: ['editorial', 'typographic'], layouts: ['editorial_grid'], color: 'neutral', theme: 'switchable', interaction: 'light', interactionPatterns: ['page_transition'], responsive: 'confirmed', blog: 'static', stack: ['Hugo', 'CSS'], tools: ['replit'], deployment: 'GitHub Pages', variant: 'academic', creatorKey: 'creator-portfolio-academic', repository: 'https://example.test/repos/lab-notebook', assets: ['asset-lab-theme'] }),
  makePortfolioProject({ id: 'project-scholar-site', name: 'Scholar Site', summary: '用结构化列表呈现研究方向、论文、课程和合作方式。', group: '学术主页', siteType: 'academic_homepage', roles: ['researcher_academic'], goals: ['academic_profile'], pageModel: 'single_page', navigation: 'top_nav', modules: ['hero', 'about', 'publications', 'experience', 'contact'], showcase: 'none', caseDepth: 'none', visual: ['minimal', 'corporate'], layouts: ['editorial_grid'], color: 'monochrome', theme: 'light_only', interaction: 'static', interactionPatterns: ['none'], responsive: 'confirmed', blog: 'none', stack: ['Eleventy', 'CSS'], tools: ['bolt'], deployment: 'Cloudflare Pages', variant: 'academic', creatorKey: 'creator-portfolio-academic' }),
]

export const portfolioEvidenceIds = portfolioProjects.map((project) => evidenceId(`evidence-${project.id.replace('project-', '')}-public`))
