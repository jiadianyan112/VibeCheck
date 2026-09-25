import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

interface OpenApiOperation {
  operationId?: unknown
  responses?: unknown
}

interface OpenApiDocument {
  openapi?: unknown
  info?: unknown
  paths?: Record<string, Record<string, OpenApiOperation>>
}

const httpMethods = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
])

export interface ContractCheckResult {
  readonly operationIds: readonly string[]
  readonly pathCount: number
}

function resolveLocalReference(document: object, reference: string): unknown {
  if (!reference.startsWith('#/')) throw new Error(`CONTRACT_EXTERNAL_REF_FORBIDDEN:${reference}`)
  let current: unknown = document
  for (const rawSegment of reference.slice(2).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (current === null || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`CONTRACT_REF_UNRESOLVED:${reference}`)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function validateReferences(document: object): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return

    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        if (typeof child !== 'string') throw new Error('CONTRACT_REF_INVALID')
        resolveLocalReference(document, child)
      } else {
        visit(child)
      }
    }
  }
  visit(document)
}

export function validateContractDocument(document: OpenApiDocument): ContractCheckResult {

  if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.1.')) {
    throw new Error('CONTRACT_OPENAPI_VERSION_INVALID')
  }
  if (document.info === null || typeof document.info !== 'object') {
    throw new Error('CONTRACT_INFO_REQUIRED')
  }
  if (document.paths === null || typeof document.paths !== 'object') {
    throw new Error('CONTRACT_PATHS_REQUIRED')
  }
  validateReferences(document)

  const operationIds: string[] = []
  for (const [pathKey, pathItem] of Object.entries(document.paths)) {
    if (!pathKey.startsWith('/')) throw new Error('CONTRACT_PATH_INVALID')
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method.toLowerCase())) continue
      if (typeof operation.operationId !== 'string' || operation.operationId.length === 0) {
        throw new Error(`CONTRACT_OPERATION_ID_REQUIRED:${method.toUpperCase()} ${pathKey}`)
      }
      if (operation.responses === null || typeof operation.responses !== 'object') {
        throw new Error(`CONTRACT_RESPONSES_REQUIRED:${operation.operationId}`)
      }
      operationIds.push(operation.operationId)
    }
  }

  const unique = new Set(operationIds)
  if (unique.size !== operationIds.length) {
    throw new Error('CONTRACT_OPERATION_ID_DUPLICATED')
  }

  return Object.freeze({
    operationIds: Object.freeze(operationIds),
    pathCount: Object.keys(document.paths).length,
  })
}

export async function validateContractFile(path: string): Promise<ContractCheckResult> {
  const source = await readFile(path, 'utf8')
  return validateContractDocument(parse(source) as OpenApiDocument)
}
