import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'

const forbiddenTerms = Object.freeze([
  'VIBECHECK PROTOTYPE',
  '打开VibeCheck原型',
  '开发命令',
  '原型场景',
  '低保真组件沙盒',
  '待实现模块',
  '路由骨架',
  '路由上下文',
  '视觉占位',
  '媒体占位',
  '作品截图占位',
  '预览哈希',
  '检查 ID',
  '服务端冻结快照',
])

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function collectJavaScriptFiles(directory) {
  if (!(await isDirectory(directory))) return []

  const files = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(path)))
    } else if (entry.isFile() && extname(entry.name) === '.js') {
      files.push(path)
    }
  }
  return files
}

async function resolveDistRoot(argument) {
  if (!argument) return resolve(process.cwd(), 'dist')

  const candidate = resolve(process.cwd(), argument)
  if (await isFile(join(candidate, 'index.html'))) return candidate

  const nestedDist = join(candidate, 'dist')
  if (await isFile(join(nestedDist, 'index.html'))) return nestedDist

  return candidate
}

function displayPath(root, path) {
  return relative(root, path).replaceAll('\\', '/')
}

const distRoot = await resolveDistRoot(process.argv[2])
const indexPath = join(distRoot, 'index.html')
if (!(await isFile(indexPath))) {
  throw new Error(`PRODUCTION_COPY_BUILD_MISSING file=${displayPath(dirname(distRoot), indexPath)}`)
}

const files = [indexPath]
const javascriptFiles = await collectJavaScriptFiles(distRoot)
javascriptFiles.sort((left, right) => displayPath(distRoot, left).localeCompare(displayPath(distRoot, right)))
files.push(...javascriptFiles)

const outputRoot = distRoot.endsWith('\\dist') || distRoot.endsWith('/dist') ? dirname(distRoot) : distRoot
let violations = 0

for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const term of forbiddenTerms) {
    if (!source.includes(term)) continue
    console.log(`PRODUCTION_COPY_FORBIDDEN term=${term} file=${displayPath(outputRoot, file)}`)
    violations += 1
  }
}

if (violations > 0) process.exitCode = 1
