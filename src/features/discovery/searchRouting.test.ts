import { describe, expect, it } from 'vitest'
import { inferIdeaCategory, isCompleteIdeaQuery, unifiedSearchPath } from './searchRouting'

describe('unified search routing', () => {
  it('keeps names, tools and short keywords in ordinary search', () => {
    expect(isCompleteIdeaQuery('PDF 出题')).toBe(false)
    expect(isCompleteIdeaQuery('Paper to Practice')).toBe(false)
    expect(unifiedSearchPath('口语模考')).toBe('/search?q=%E5%8F%A3%E8%AF%AD%E6%A8%A1%E8%80%83')
  })

  it('routes intent language and long descriptions into idea analysis', () => {
    expect(isCompleteIdeaQuery('把 PDF 讲义生成练习题')).toBe(true)
    expect(isCompleteIdeaQuery('我想做一个帮助大学生练习英语口语并自动给出反馈的工具')).toBe(true)
    expect(unifiedSearchPath('把 PDF 讲义生成练习题')).toBe('/discover?idea=%E6%8A%8A%20PDF%20%E8%AE%B2%E4%B9%89%E7%94%9F%E6%88%90%E7%BB%83%E4%B9%A0%E9%A2%98')
  })

  it('identifies portfolio ideas before showing intent fields', () => {
    expect(inferIdeaCategory('我想做一个极简开发者作品集，展示开源项目和源码')).toBe('personal_site_portfolio')
    expect(inferIdeaCategory('把 PDF 讲义生成练习题')).toBe('ai_learning_quiz')
  })

  it('opens the empty unified search page for blank input', () => {
    expect(unifiedSearchPath('   ')).toBe('/search')
  })
})
