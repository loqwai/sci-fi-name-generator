#!/usr/bin/env node --test
// Name QUALITY, as opposed to set-algebra correctness.
//
// No test can tell you a name is good -- that was settled by reading batches.
// What a test CAN do is hold the line under the good names: every one of these
// assertions is a specific bad name he was actually served, or a specific good
// one he actually accepted. The suite exists so that the next person to tune
// the generator finds out immediately that they have re-broken `mationcity` or
// filtered away `quarbet`.
//
//   node --test scripts/names.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_RECIPE,
  parseCorpus,
  selectWords,
  syllablePool,
  generateNames,
  rejectReason,
  getSyllables,
} from '../src/engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpus = parseCorpus(gunzipSync(await readFile(join(__dirname, '..', 'dist', 'corpus.bin'))).buffer)

// A spread wide enough that a filter which only works on Lovecraft gets caught:
// a tiny intersection, a single huge author, a union, and the deliberately
// worst case of no common-English filter at all.
const RECIPES = [
  { t: 'default', ...DEFAULT_RECIPE },
  { t: 'stoker ∩ lovecraft r1', include: ['stoker', 'lovecraft'], mode: 'all', exclude: [], rarity: 1 },
  { t: 'lovecraft r2', include: ['lovecraft'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'pkd ∪ asimov r2', include: ['pkd', 'asimov'], mode: 'any', exclude: [], rarity: 2 },
  { t: 'shakespeare r2', include: ['shakespeare'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'homer ∩ myths r2', include: ['homer', 'myths'], mode: 'all', exclude: [], rarity: 2 },
  { t: 'lovecraft, no rarity', include: ['lovecraft'], mode: 'all', exclude: [], rarity: 0 },
]

const batches = RECIPES.map((r) => {
  const pool = syllablePool(corpus, selectWords(corpus, r))
  const names = []
  for (const seed of [1, 7, 12345, 99999]) names.push(...generateNames(corpus, pool, { count: 24, seed }))
  return { r, pool, names }
})
const everyName = batches.flatMap((b) => b.names)

// ---------------------------------------------------------------- regressions

// Verbatim, from the batches he rejected. Every one is the same failure --
// visible English morphology glued on -- and every one was produced by a
// generator that barred affixes in FIRST position only.
const REJECT = [
  'mationcity',   // ma+TION+CITY  -- suffix in the middle, whole word on the end
  'fieltusing',   // fielt+us+ING
  'untruness',    // UN+tru+NESS   -- affixed at both ends
  'manchoship',   // MAN+cho+SHIP  -- and the syllable split hides the -ship
  'headser',      // HEAD+ser      -- a whole common word with a syllable stuck on
  'dosmomalboys', // dos+mo+mal+BOYS
  'tomoty',       // to+mo+TY
]

// His own accepted output, plus the good names from the batch that prompted
// this work. These are the reason the filters are not simply cranked harder:
// `quarbet` is quar+BET and `bet` is a real English word, so the naive version
// of the common-word rule deletes the target.
const KEEP = ['tornoromic', 'quarbet', 'hirmitor', 'thalis', 'terskiel', 'orros', 'narai']

test('the rejected names can no longer be produced', () => {
  for (const name of REJECT) {
    const reason = rejectReason(corpus, name)
    assert.ok(reason, `"${name}" is accepted again -- it was one of the names he rejected`)
  }
})

test('his accepted names still survive every filter', () => {
  for (const name of KEEP) {
    const reason = rejectReason(corpus, name)
    assert.equal(reason, null, `"${name}" is an accepted name but the generator now rejects it: ${reason}`)
  }
})

test('no generated name ends in English morphology', () => {
  // The failure this whole change exists to fix. Checked against the finished
  // string, not the syllables, because the splitter cuts `manchoship` as
  // man|chos|hip and the -ship is invisible at the seam.
  const SUFFIX = /(?:tion|sion|ness|ment|ance|ence|ship|hood|ward|ful|less|able|ible|ing|ism|ist|ity|ous|est|ly|ed|er|ers|ies|ish|y)$/
  const bad = everyName.filter((n) => SUFFIX.test(n.name))
  assert.deepEqual(bad.map((n) => n.name), [], `${bad.length} name(s) end in an English suffix`)
})

test('no generated name contains a whole obvious English word as a segment', () => {
  // `mationcity` is "city" with a prefix stuck on; `headser` is "head".
  const bad = []
  for (const n of everyName) {
    for (let i = 0; i < n.parts.length; i++) {
      let run = ''
      for (let j = i; j < n.parts.length; j++) {
        run += n.parts[j]
        if (run.length < 3 || run === n.name) continue
        const wi = corpus.words.indexOf(run)
        // Same two tiers the engine uses: any real word spelled by more than
        // one syllable, or a very common one spelled by a single syllable.
        if (wi < 0) continue
        const common = i === j ? (run.length >= 4 ? corpus.df[wi] >= 6 : corpus.df[wi] >= 20) : corpus.df[wi] >= 6
        if (common) bad.push(`${n.name} (${n.parts.join('+')} -> "${run}")`)
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} name(s) contain a whole English word`)
})

test('syllables are only used in the position they were observed in', () => {
  // -tion never begins a real word, so a pool that recorded position cannot
  // offer it as an opening. Note the asymmetry, which is real and not a bug:
  // `re`, `un`, `in` and `be` DO legitimately end English words (more, begun,
  // within, tribe), so they stay in the final pool and are barred only from
  // the opening, where they read as prefixes.
  for (const { r, pool } of batches) {
    assert.ok(pool.initial && pool.medial && pool.final, `${r.t}: positional pools were not built`)
    for (const s of ['tion', 'ness', 'ing', 'ship', 'ment', 'ous', 'est', 'ish', 'ity'])
      assert.ok(!pool.initial.includes(s), `${r.t}: "${s}" is offered as an OPENING syllable`)
    for (const s of ['un', 're', 'dis', 'pre', 'mis', 'in', 'ex'])
      assert.ok(!pool.initial.includes(s), `${r.t}: prefix "${s}-" is offered as an OPENING syllable`)
    // Pure grammar is barred from every slot, including the middle -- that is
    // the leak that produced ma+TION+ci+ty.
    for (const s of ['tion', 'ness', 'ing', 'ship', 'ment', 'ly', 'ed'])
      for (const slot of ['initial', 'medial', 'final'])
        assert.ok(!pool[slot].includes(s), `${r.t}: "${s}" survives in the ${slot} pool`)
  }
})

test('every recipe still fills a whole 24-name batch', () => {
  // Filtering hard enough would leave only safe, forgettable output -- or none.
  // This is the guard on over-correcting: the counts have to survive too.
  for (const { r } of RECIPES.map((x) => ({ r: x }))) {
    const pool = syllablePool(corpus, selectWords(corpus, r))
    for (const seed of [1, 2, 3]) {
      const names = generateNames(corpus, pool, { count: 24, seed })
      assert.equal(names.length, 24, `${r.t} @seed ${seed} produced only ${names.length}/24`)
    }
  }
})

test('names stay in the shape and length his keepers had', () => {
  // quarbet is 7 chars / 2 syllables, tornoromic 10 / 4. Nothing outside that.
  for (const n of everyName) {
    assert.ok(n.name.length >= 5 && n.name.length <= 10, `"${n.name}" is ${n.name.length} chars`)
    assert.ok(n.parts.length >= 2 && n.parts.length <= 4, `"${n.name}" has ${n.parts.length} syllables`)
    assert.ok(/^[a-z]+$/.test(n.name), `"${n.name}" is not plain lowercase letters`)
  }
})

test('three syllables is the commonest shape, and four still happens', () => {
  // Read side by side, 3-syllable names were where nearly all the good ones
  // were; 2-syllable batches came out bland. But tornoromic is FOUR, so the
  // long shape must not be tuned out of existence.
  const hist = {}
  for (const n of everyName) hist[n.parts.length] = (hist[n.parts.length] ?? 0) + 1
  assert.ok(hist[3] > hist[2], `2-syllable names dominate (${JSON.stringify(hist)})`)
  assert.ok(hist[4] > 0, `no 4-syllable names at all -- tornoromic could not be produced (${JSON.stringify(hist)})`)
})

test('names are not accidentally obscene', () => {
  const OBSCENE = /anal|anus|arse|cunt|fuck|nigg|penis|piss|porn|rape|shit|slut|twat|whore/
  const bad = everyName.filter((n) => OBSCENE.test(n.name)).map((n) => n.name)
  assert.deepEqual(bad, [], 'obscene name(s) generated')
})

test('a batch is not the same name over and over', () => {
  // The cheapest way to pass every filter above is to collapse the output.
  for (const { r, names } of batches) {
    const uniq = new Set(names.map((n) => n.name))
    assert.equal(uniq.size, names.length, `${r.t}: duplicate names in the batch`)
    const openings = new Set(names.map((n) => n.parts[0]))
    assert.ok(openings.size > names.length / 4, `${r.t}: only ${openings.size} distinct openings in ${names.length} names`)
  }
})

test('rejectReason accepts a finished name as well as parts', () => {
  assert.equal(rejectReason(corpus, getSyllables('tornoromic').map((s) => s.toLowerCase())), null)
  assert.ok(rejectReason(corpus, 'untruness'))
})
