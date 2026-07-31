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
    await user.selectOptions(screen.getByLabelText('主要输出'), 'learning_report')
    expect(screen.getByLabelText('主要输出')).toHaveValue('learning_report')
    expect(screen.getByText('把 PDF 讲义生成练习题')).toBeInTheDocument()
  })
})
