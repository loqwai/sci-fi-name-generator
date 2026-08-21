#!/usr/bin/env node
// Quality harness: read the shipped payload exactly as the browser does, then
// print names for a spread of recipes so a human can eyeball them.
//
// Prints BOTH morpheme counts, unfiltered and in generation order. Nothing is
// hand-picked -- the duds are the point of the exercise, because a curated
// best-of tells you nothing about what a user will actually see.
//
//   node scripts/sample.mjs
//   node scripts/sample.mjs --seed 12345 --count 24
import { readFile } from 'fs/promises'
import { gunzipSync } from 'zlib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  DEFAULT_RECIPE,
  parseCorpus,
  selectStages,
  countBits,
  mineStems,
  generateMorphemeBatch,
  legibilityReason,
} from '../src/engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag)
  return i === -1 ? dflt : process.argv[i + 1]
}
const seed = Number(arg('--seed', 12345))
const count = Number(arg('--count', 24))

const corpus = parseCorpus(
  gunzipSync(await readFile(join(__dirname, '..', 'dist', 'corpus.bin'))).buffer,
)

// rarity 0 throughout. rarity >= 1 drops every word appearing in any other
// book in the library, which is exactly the vocabulary a reader recognises --
// at rarity 1 the default recipe mines ZERO usable stems.
const RECIPES = [
  { t: 'DEFAULT (Lovecraft ∪ Kabbalah)', ...DEFAULT_RECIPE },
  { t: 'Stoker ∪ Lovecraft', include: ['stoker', 'lovecraft'], mode: 'any', exclude: [], rarity: 0 },
  { t: 'Shakespeare ∩ Bible', include: ['shakespeare', 'bible'], mode: 'all', exclude: [], rarity: 0 },
  { t: 'Austen', include: ['austen'], mode: 'all', exclude: [], rarity: 0 },
  { t: 'PKD ∪ Asimov', include: ['pkd', 'asimov'], mode: 'any', exclude: [], rarity: 0 },
  { t: 'Winnie-the-Pooh', include: ['pooh'], mode: 'all', exclude: [], rarity: 0 },
]

const vet = (w) => legibilityReason(corpus, w)

for (const r of RECIPES) {
  const stages = selectStages(corpus, r)
  const stems = mineStems(corpus, stages.afterExclude, { vet })
  const ev = stems.heads.filter((h) => h.score > 0).length
  console.log(`\n### ${r.t}`)
  console.log(
    `    ${countBits(stages.afterExclude)} words → ${stems.heads.length} heads / ${stems.tails.length} tails (${ev} heads with compound evidence)`,
  )
  for (const parts of [2, 3]) {
    const names = generateMorphemeBatch(corpus, null, { count, seed, stems, parts })
    console.log(`    ${parts} morphemes: ${names.map((n) => n.name).join(', ')}`)
  }
}

// The number that decides whether this method is survivable at all: the old
// syllable engine scored 18,757 distinct over 40 seeds x 500 and was not
// saturated. A hand-curated inventory scored a few hundred.
const stems = mineStems(corpus, selectStages(corpus, DEFAULT_RECIPE).afterExclude, { vet })
for (const parts of [2, 3]) {
  const seen = new Set()
  for (let s = 1; s <= 40; s++)
    for (const n of generateMorphemeBatch(corpus, null, { count: 500, seed: s, stems, parts }))
      seen.add(n.name)
  console.log(`\ndistinct names, default recipe, 40 seeds x 500, ${parts} morphemes: ${seen.size}`)
}

console.log(`vocab ${corpus.words.length} words, ${corpus.meta.sources.length} sources`)
