import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflowPath = resolve(process.cwd(), '.github/workflows/quality.yml')

function buildStep(workflow: string): string {
  const lines = workflow.split(/\r?\n/)
  const start = lines.findIndex((line) => /^      - run: npm run build\s*$/.test(line))
  if (start < 0) return ''

  const stepLines = [lines[start] ?? '']
  for (const line of lines.slice(start + 1)) {
    if (/^      - /.test(line)) break
    stepLines.push(line)
  }
  return stepLines.join('\n')
}

describe('quality workflow build environment', () => {
  it('runs the production build with an explicit production NODE_ENV', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const step = buildStep(workflow)

    expect(step).toMatch(/^      - run: npm run build\s*$/m)
    expect(step).toMatch(/^        env:\s*$/m)
    expect(step).toMatch(/^          NODE_ENV:\s*production\s*$/m)
  })

  it('runs the production copy gate after the build and before the frontend budget gate', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const runSteps = workflow
      .split(/\r?\n/)
      .filter((line) => /^      - run: /.test(line))
      .map((line) => line.replace(/^      - run: /, '').trim())

    const buildIndex = runSteps.indexOf('npm run build')
    const copyCheckIndex = runSteps.indexOf('npm run frontend:copy-check')
    const budgetIndex = runSteps.indexOf('npm run frontend:budget')

    expect(buildIndex).toBeGreaterThanOrEqual(0)
    expect(copyCheckIndex).toBeGreaterThan(buildIndex)
    expect(budgetIndex).toBeGreaterThan(copyCheckIndex)
  })
})
