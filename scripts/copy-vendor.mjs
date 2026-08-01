// 把 transformers.js / onnxruntime-web 的官方产物原样拷到 public/vendor/transformers/
// 关键点：这些文件是打包器自包含产物，绝对不能再被 Vite/Rollup 二次打包，
// 否则内部的 chunk 加载器会被破坏，导致
// "no available backend found. ERR: [wasm] TypeError: f is not a function"。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dest = resolve(root, 'public/vendor/transformers')

const tfDist = resolve(root, 'node_modules/@huggingface/transformers/dist')
const ortDist = resolve(root, 'node_modules/onnxruntime-web/dist')

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

let count = 0
const copy = (from, name) => {
  copyFileSync(from, resolve(dest, name))
  count++
}

// 1) transformers.js 浏览器版自包含产物
const entry = resolve(tfDist, 'transformers.min.js')
if (!existsSync(entry)) {
  throw new Error(`[copy-vendor] 缺少入口文件: ${entry}，请先执行 npm install`)
}
copy(entry, 'transformers.min.js')

// 2) onnxruntime-web 运行时。
// 不同版本提供的后端变体（jsep / jspi / asyncify / 普通）文件名不固定，
// 这里整目录扫描，把 ort 相关的 .mjs/.wasm 全部拷过去，避免版本升级后漏文件。
if (!existsSync(ortDist)) {
  throw new Error(`[copy-vendor] 找不到 onnxruntime-web: ${ortDist}`)
}
for (const file of readdirSync(ortDist)) {
  if (!file.startsWith('ort')) continue
  if (file.endsWith('.map')) continue
  if (!file.endsWith('.mjs') && !file.endsWith('.wasm')) continue
  if (file.includes('.node.')) continue // node 专用产物，浏览器不需要
  copy(resolve(ortDist, file), file)
}

// 3) transformers 自带的 ort 补充文件（若存在则一并覆盖，保持与其内部引用一致）
for (const file of readdirSync(tfDist)) {
  if (!file.startsWith('ort')) continue
  if (file.endsWith('.map')) continue
  if (!file.endsWith('.mjs') && !file.endsWith('.wasm')) continue
  copy(resolve(tfDist, file), file)
}

console.log(`[copy-vendor] 已复制 ${count} 个文件 -> ${dest}`)
