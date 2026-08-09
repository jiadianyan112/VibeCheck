import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { IntentEditor } from '../features'
import { intentService, parseIntent } from './intentService'

describe('deterministic intent parser', () => {
  it.each([
    ['把 PDF 讲义生成练习题', 'high', 'question_generation', 'pdf'],
    ['做一个口语模考并自动评分', 'high', 'speaking_mock_exam', 'audio'],
    ['把单词做成背词卡片', 'high', 'vocabulary_memory', 'plain_text'],
  ])('parses %s without an external model', (text, confidence, scenario, input) => {
    const result = parseIntent(text)
    expect(result.confidence).toBe(confidence)
    expect(result.intent.useScenarios).toContain(scenario)
    expect(result.intent.inputs).toContain(input)
    expect(result.rawText).toBe(text)
    expect(result).not.toHaveProperty('marketDemand')
  })

  it('returns explicit low-confidence failure for unrecognized input', () => {
    const result = parseIntent('做一个很特别的东西')
    expect(result.status).toBe('failed')
    expect(result.confidence).toBe('low')
    expect(result.intent.originalQuery).toBe('做一个很特别的东西')
  })

  it('uses portfolio-specific dimensions without leaking learning fields', () => {
    const result = parseIntent('我想做一个极简开发者作品集，展示开源项目和源码')
    expect(result.intent.categoryId).toBe('personal_site_portfolio')
    expect(result.intent.siteTypes).toContain('portfolio')
    expect(result.intent.creatorRoles).toContain('developer')
    expect(result.intent.primaryGoals).toContain('showcase_projects')
    expect(result.intent.visualStyles).toContain('minimal')
    expect(result.intent.assetTypes).toContain('source_code')
    expect(result.intent.useScenarios).toEqual([])
  })

  it('supports the configured parse-failure scenario while retaining text', async () => {
    const result = await intentService.parse('原始想法不能丢', { scenario: 'parse_failure', delayMs: 0 })
    expect(result.ok && result.data.status).toBe('failed')
    expect(result.ok && result.data.rawText).toBe('原始想法不能丢')
  })

  it('renders editable structured output while preserving the original', async () => {
    const user = userEvent.setup()
    function Example() { const [intent, setIntent] = useState(parseIntent('把 PDF 讲义生成练习题').intent); return <IntentEditor value={intent} onChange={setIntent} /> }
    render(<Example />)
    expect(screen.getByText('把 PDF 讲义生成练习题')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('添加主要输出'), 'learning_report')
    expect(screen.getByText('学习报告')).toBeInTheDocument()
    expect(screen.getByText('把 PDF 讲义生成练习题')).toBeInTheDocument()
  })
})
