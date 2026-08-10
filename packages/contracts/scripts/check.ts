import { resolve } from 'node:path'
import { validateContractFile } from '../src/contract-checker.js'

const result = await validateContractFile(resolve('openapi/v1.yaml'))
process.stdout.write(
  `contract_ok paths=${result.pathCount} operations=${result.operationIds.length}\n`,
)
