import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppStateProvider, useAppState } from '../state'
import { ScenarioPanel } from './ScenarioPanel'

function ScenarioProbe() {
  const { state } = useAppState()
  const location = useLocation()
  return (
    <output aria-label="场景状态">
      {JSON.stringify({ path: `${location.pathname}${location.search}`, role: state.session.role, drafts: state.submissionDrafts.map(({ id }) => id), comparison: state.comparisonProjectIds })}
    </output>
  )
}

function renderPanel() {
  return render(<MemoryRouter initialEntries={['/projects']}><AppStateProvider><ScenarioPanel /><ScenarioProbe /></AppStateProvider></MemoryRouter>)
}

describe('ScenarioPanel', () => {
  beforeEach(() => localStorage.clear())

  it('opens every indexed scenario from a single development panel', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByText('原型场景'))
    expect(screen.getAllByRole('button')).toHaveLength(12)
    expect(screen.getByText('搜索结果不足')).toBeInTheDocument()
    expect(screen.getByText('外链风险')).toBeInTheDocument()
  })

  it('seeds prerequisites, then resets before switching to another scenario', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByText('原型场景'))
    await user.click(screen.getByText('自动提取失败'))
    expect(screen.getByLabelText('场景状态')).toHaveTextContent('prototypeScenario=extraction_partial')
    expect(screen.getByLabelText('场景状态')).toHaveTextContent('"role":"user"')
    expect(screen.getByLabelText('场景状态')).toHaveTextContent('draft-scenario-extraction-partial')

    await user.click(screen.getByText('比较数量不足'))
    const state = screen.getByLabelText('场景状态')
    expect(state).toHaveTextContent('prototypeScenario=comparison_insufficient')
    expect(state).toHaveTextContent('"role":"guest"')
    expect(state).toHaveTextContent('"drafts":[]')
    expect(state).toHaveTextContent('"comparison":["project-quizforge"]')

    await user.click(screen.getByRole('button', { name: '重置场景与原型数据' }))
    expect(state).toHaveTextContent('"path":"/projects"')
    expect(state).toHaveTextContent('"comparison":["project-quizforge","project-pdfquizlab"]')
  })
})
