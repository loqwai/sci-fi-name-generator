#!/usr/bin/env node
// No bundler: the app is three plain files plus the precomputed corpus.
// This just stages them into dist/ next to corpus.bin.gz.
import { copyFile, mkdir, readdir, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src')
const DIST = join(__dirname, '..', 'dist')

await mkdir(DIST, { recursive: true })
const files = ['index.html', 'style.css', 'app.js', 'engine.js', '_headers']
for (const f of files) await copyFile(join(SRC, f), join(DIST, f))

const sizes = []
for (const f of await readdir(DIST)) sizes.push([f, (await stat(join(DIST, f))).size])
sizes.sort((a, b) => b[1] - a[1])
console.log('dist/')
for (const [f, s] of sizes) console.log(`  ${f.padEnd(18)} ${(s / 1024).toFixed(1)} KB`)
console.log(`  ${'TOTAL'.padEnd(18)} ${(sizes.reduce((a, b) => a + b[1], 0) / 1024).toFixed(1)} KB`)
