import type { ProjectCategoryId } from '../../types'

const intentLanguagePattern = /(?:我想|我需要|希望|帮我|做一个|开发一个|创建一个|实现一个|用于|面向|能够|可以|把.+(?:生成|转换|变成))/
const portfolioPattern = /(?:作品集|个人主页|个人网站|个人站点|在线简历|简历站|学术主页|portfolio|case study|项目展示)/i
const learningPattern = /(?:学习|练习|题库|出题|讲义|pdf|口语|词汇|单词|听写|错题|模考)/i

export function inferIdeaCategory(value: string): ProjectCategoryId | undefined {
  if (portfolioPattern.test(value)) return 'personal_site_portfolio'
  if (learningPattern.test(value)) return 'ai_learning_quiz'
  return undefined
}

export function isCompleteIdeaQuery(value: string) {
  const query = value.trim().replace(/\s+/g, ' ')
  if (query.length >= 24) return true
  return query.length >= 10 && intentLanguagePattern.test(query)
}

export function unifiedSearchPath(value: string) {
  const query = value.trim()
  if (!query) return '/search'
  return isCompleteIdeaQuery(query)
    ? `/discover?idea=${encodeURIComponent(query)}`
    : `/search?q=${encodeURIComponent(query)}`
}
