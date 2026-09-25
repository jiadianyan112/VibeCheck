import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import Ajv2020, { type AnySchema } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parse } from 'yaml'

const schemaUrl = 'https://render.com/schema/render.yaml.json'
const response = await fetch(schemaUrl, { signal: AbortSignal.timeout(15_000) })
if (!response.ok) throw new Error(`DEPLOYMENT_SCHEMA_FETCH_FAILED:${response.status}`)

const schema = await response.json() as AnySchema
const blueprint = parse(await readFile(resolve('../../render.yaml'), 'utf8')) as unknown
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)

if (!validate(blueprint)) {
  process.stderr.write(`${JSON.stringify(validate.errors, null, 2)}\n`)
  throw new Error('DEPLOYMENT_BLUEPRINT_SCHEMA_INVALID')
}

process.stdout.write(`deployment_blueprint_ok schema=${schemaUrl}\n`)
