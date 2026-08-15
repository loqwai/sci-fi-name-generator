#!/usr/bin/env node
// Quality harness: read the shipped payload exactly as the browser does, then
// print names for a spread of recipes so a human can eyeball them.
import { readFile } from 'fs/promises'
import { gunzipSync } from 'zlib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCorpus, selectWords, syllablePool, generateNames, countBits } from '../src/engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const corpus = parseCorpus(
  gunzipSync(await readFile(join(__dirname, '..', 'dist', 'corpus.bin.gz'))).buffer,
)

const RECIPES = [
  { t: 'HIS RECIPE: Stoker n Lovecraft, not in any classic', include: ['stoker', 'lovecraft'], mode: 'all', exclude: [], rarity: 1 },
  { t: 'Stoker n Lovecraft, rarity 2', include: ['stoker', 'lovecraft'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'Lovecraft alone, rarity 2', include: ['lovecraft'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'Lovecraft + Poe (any), rarity 2', include: ['lovecraft', 'poe'], mode: 'any', exclude: [], rarity: 2 },
  { t: 'Shakespeare, rarity 2', include: ['shakespeare'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'Shakespeare n Bible', include: ['shakespeare', 'bible'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'PKD + Asimov (any), rarity 2', include: ['pkd', 'asimov'], mode: 'any', exclude: [], rarity: 2 },
  { t: 'Homer n Myths', include: ['homer', 'myths'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'Kama Sutra, rarity 2', include: ['kamasutra'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'Winnie-the-Pooh, rarity 3', include: ['pooh'], mode: 'all', exclude: [], rarity: 3 },
  { t: 'Nietzsche n Plato', include: ['nietzsche', 'plato'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'Frankenstein + Dracula(Stoker) any, rarity 2', include: ['shelley', 'stoker'], mode: 'any', exclude: [], rarity: 2 },
  { t: 'Austen, not Dickens, rarity 2', include: ['austen'], mode: 'all', exclude: ['dickens'], rarity: 2 },
  { t: 'NO rarity filter (control: should look like real English)', include: ['lovecraft'], mode: 'all', exclude: [], rarity: 0 },
]

for (const r of RECIPES) {
  const sel = selectWords(corpus, r)
  const n = countBits(sel)
  const pool = syllablePool(corpus, sel)
  const names = generateNames(corpus, pool, { count: 18, seed: 12345 })
  console.log(`\n### ${r.t}`)
  console.log(`    ${n} words -> ${pool.length} syllables`)
  console.log('    ' + (names.length ? names.map((x) => x.name).join(', ') : '(none)'))
}

console.log(`\nvocab ${corpus.words.length} words, ${corpus.meta.sources.length} sources`)
