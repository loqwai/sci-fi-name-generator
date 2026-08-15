#!/usr/bin/env node
// Compare generator settings side by side so the choice is made by reading
// output, not by guessing.
import { readFile } from 'fs/promises'
import { gunzipSync } from 'zlib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCorpus, selectWords, syllablePool, generateNames } from '../src/engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpus = parseCorpus(
  await readFile(join(__dirname, '..', 'dist', 'corpus.bin')).buffer,
)

const recipe = { include: ['stoker', 'lovecraft'], mode: 'all', exclude: [], rarity: 2 }
const sel = selectWords(corpus, recipe)

const VARIANTS = [
  { maxSyl: 99, maxLength: 99, label: 'original (no caps)' },
  { maxSyl: 4, maxLength: 99, label: 'syl<=4' },
  { maxSyl: 3, maxLength: 99, label: 'syl<=3 (his filter)' },
  { maxSyl: 4, maxLength: 12, label: 'syl<=4, len<=12' },
  { maxSyl: 3, maxLength: 11, label: 'syl<=3, len<=11' },
  { maxSyl: 4, maxLength: 10, label: 'syl<=4, len<=10' },
  { maxSyl: 3, maxLength: 10, label: 'syl<=3, len<=10' },
]

for (const v of VARIANTS) {
  const pool = syllablePool(corpus, sel, { maxSyl: v.maxSyl })
  const names = generateNames(corpus, pool, { count: 20, seed: 999, maxLength: v.maxLength })
  console.log(`\n--- ${v.label}  (pool ${pool.length})`)
  console.log('    ' + names.map((n) => n.name).join(', '))
}
