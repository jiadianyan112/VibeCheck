import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

// Production baseline 4eca683 uses 21,504 bytes gzip-9. The complete publication
// preview and metadata add 638 bytes; keep a 22 KiB ceiling with limited headroom.
// The JavaScript budget is unchanged.
const limits = Object.freeze({ js: 251_435, css: 22 * 1024 })
const assetDir = new URL('../dist/assets/', import.meta.url)
const files = await readdir(assetDir)

for (const extension of ['js', 'css']) {
  const matching = files.filter((file) => file.endsWith(`.${extension}`))
  if (matching.length === 0) throw new Error(`FRONTEND_ASSET_MISSING type=${extension}`)
  let gzipBytes = 0
  for (const file of matching) {
    const source = await readFile(new URL(file, assetDir))
    gzipBytes += gzipSync(source, { level: 9 }).byteLength
  }
  console.log(`frontend_budget type=${extension} gzip_bytes=${gzipBytes} limit=${limits[extension]}`)
  if (gzipBytes > limits[extension]) {
    throw new Error(`FRONTEND_BUDGET_EXCEEDED type=${extension} actual=${gzipBytes} limit=${limits[extension]}`)
  }
}
