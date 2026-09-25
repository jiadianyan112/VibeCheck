import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(process.cwd())
const checkerPath = resolve(repositoryRoot, 'scripts/check-production-copy.mjs')

type CheckerResult = {
  status: number | null
  stdout: string
  stderr: string
}

function runChecker(buildRoot: string): Promise<CheckerResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [checkerPath, buildRoot], {
      cwd: repositoryRoot,
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (status) => resolveResult({ status, stdout, stderr }))
  })
}

async function writeBuildFixture(root: string, files: Record<string, string>) {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const path = join(root, relativePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    }),
  )
}

describe('production copy checker', () => {
  it('exits successfully and stays quiet for a clean build fixture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecheck-copy-clean-'))

    try {
      await writeBuildFixture(root, {
        'dist/index.html': '<main>Public VibeCheck</main>',
        'dist/assets/app.js': 'document.body.dataset.ready = "true";',
      })

      const result = await runChecker(root)

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports forbidden copy in index and JavaScript assets and exits non-zero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecheck-copy-violating-'))

    try {
      await writeBuildFixture(root, {
        'dist/index.html': '<title>VIBECHECK PROTOTYPE</title>',
        'dist/assets/app.js': 'const label = "开发命令";',
        'dist/assets/vendor.js': 'const label = "媒体占位";',
      })

      const result = await runChecker(root)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe(
        [
          'PRODUCTION_COPY_FORBIDDEN term=VIBECHECK PROTOTYPE file=dist/index.html',
          'PRODUCTION_COPY_FORBIDDEN term=开发命令 file=dist/assets/app.js',
          'PRODUCTION_COPY_FORBIDDEN term=媒体占位 file=dist/assets/vendor.js',
        ].join('\n') + '\n',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
