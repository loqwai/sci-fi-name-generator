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
  legibilityReason,
  clusterInventory,
  consonantUnits,
  GRAFTS,
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
  // Kept per seed as well as flattened: a batch is one screenful, and
  // "no repeats" is a promise about a screen, not about four screens stacked.
  const screens = [1, 7, 12345, 99999].map((seed) => generateNames(corpus, pool, { count: 24, seed }))
  return { r, pool, screens, names: screens.flat() }
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
  for (const { r, screens, names } of batches) {
    for (const s of screens) {
      const uniq = new Set(s.map((n) => n.name))
      assert.equal(uniq.size, s.length, `${r.t}: duplicate names in one batch`)
    }
    // Across four screens the engine promises nothing -- it dedupes per batch,
    // so an occasional birthday collision is honest rather than a fault. What
    // would NOT be honest is the output space quietly collapsing as the filters
    // tighten, so this asks for 95% and catches that without being flaky.
    const across = new Set(names.map((n) => n.name))
    assert.ok(across.size >= names.length * 0.95,
      `${r.t}: only ${across.size} distinct names across ${names.length} -- the output space is collapsing`)
    const openings = new Set(names.map((n) => n.parts[0]))
    assert.ok(openings.size > names.length / 4, `${r.t}: only ${openings.size} distinct openings in ${names.length} names`)
  }
})

// ------------------------------------------------------------- legibility
//
// The second pass. The names above are about output not being GARBAGE; these
// are about the survivors being READABLE -- said right, at a glance, first try.
// Every string in HARD is one he pointed at, or one the batch actually served.

const HARD = [
  ['posculdex', 'two clusters (sc, ld) in nine letters'],
  ['printizeb', 'two clusters (pr, nt) in nine letters'],
  ['harcocaph', '-ph does not end English words'],
  ['ezirimlis', 'ml: nothing is more sonorous than the l'],
  ['kabdomarah', 'bd is attested in 12 words, and reads as a typo in all of them'],
  ['natnaliva', 't|n rises across the seam'],
  ['sputlopic', 't|l rises across the seam'],
  ['egisra', 's|r rises across the seam'],
  ['trisiae', 'iae is not a vowel anyone can say'],
  ['eitoheetz', '-tz does not end English words'],
  ['partemn', '-mn does not end English words'],
  ['scdabor', 'scd- opens nothing'],
  ['zrmilon', 'zrm- opens nothing'],
]

// The counterweight, and the whole risk of this change. `tornoromic` is STRANGE
// and readable at the same time -- that is the target, not blandness. `galce`,
// `algel` and `coelim` are the three he picked out of the live batch as the
// good ones; `terskiel` needs the r|sk seam to stay legal, and `narai` needs a
// word-final `ai`. Tune the thresholds one notch tighter and these start dying.
const READABLE = [
  'tornoromic', 'quarbet', 'galce', 'algel', 'coelim', 'terskiel', 'narai',
  'thalis', 'orros', 'hirmitor', 'trinocal', 'wilvetur', 'tarelsior',
  'mithronian', 'gloleriel', 'proerius', 'strovan',
]

test('the names that are hard to READ are rejected', () => {
  for (const [name, why] of HARD)
    assert.ok(legibilityReason(corpus, name), `"${name}" is still accepted -- ${why}`)
})

test('strange but readable names survive the legibility rules', () => {
  for (const name of READABLE)
    assert.equal(legibilityReason(corpus, name), null, `"${name}" was filtered as hard to read`)
})

test('every generated name uses clusters English uses IN THAT POSITION', () => {
  const inv = clusterInventory(corpus)
  const bad = []
  for (const n of everyName) {
    const runs = /[^aeiouy]+/g
    let m
    while ((m = runs.exec(n.name))) {
      const seg = m[0]
      if (seg.length < 2) continue
      const atStart = m.index === 0
      const atEnd = m.index + seg.length === n.name.length
      if (atStart && !inv.initial.has(seg)) bad.push(`${n.name}: "${seg}-" never opens an English word`)
      else if (atEnd && !inv.final.has(seg)) bad.push(`${n.name}: "-${seg}" never ends one`)
    }
  }
  assert.deepEqual(bad, [], `${bad.length} name(s) use a cluster in a position English does not`)
})

test('no generated name stacks more than two consonant sounds in one syllable', () => {
  // "Cap clusters at 2" is a cap per SYLLABLE, not per letter-run -- which is
  // the only reading under which English itself passes, and the only one that
  // keeps `terskiel`. Its `rsk` is three sounds, but a syllable boundary sits
  // inside it (ters|kiel) and neither side holds more than two.
  //
  // Letters are also the wrong unit: `th` and `ck` are one sound each, so
  // `thalis` and `parvack` are not clusters at all.
  const inv = clusterInventory(corpus)
  const onsetOk = (s) => s.length < 2 || inv.initial.has(s)
  const codaOk = (s) => s.length < 2 || inv.final.has(s)
  const bad = []
  for (const n of everyName) {
    const runs = /[^aeiouy]+/g
    let m
    while ((m = runs.exec(n.name))) {
      const seg = m[0]
      if (consonantUnits(seg).length < 3) continue
      const atStart = m.index === 0
      const atEnd = m.index + seg.length === n.name.length
      // Word-initially English really does have str-, spr-, scr- and spl-.
      if (atStart && inv.initial.has(seg)) continue
      if (atStart || atEnd) {
        bad.push(`${n.name}: "${seg}" is ${consonantUnits(seg).length} sounds at the edge of the word`)
        continue
      }
      const split = [...Array(seg.length - 1).keys()]
        .map((i) => [seg.slice(0, i + 1), seg.slice(i + 1)])
        .some(([coda, onset]) =>
          consonantUnits(coda).length <= 2 && consonantUnits(onset).length <= 2 && codaOk(coda) && onsetOk(onset))
      if (!split) bad.push(`${n.name}: "${seg}" has nowhere legal to put a syllable boundary`)
    }
  }
  assert.deepEqual(bad, [], `${bad.length} name(s) pile up consonants`)
})

test('names alternate consonant and vowel: one cluster per five letters', () => {
  // The shape rule. `galce` (5 letters, 1 cluster) spends its whole budget and
  // is fine; `posculdex` (9 letters, 2 clusters) wants ten letters and has not
  // got them, which is exactly why it reads as a mouthful.
  const bad = []
  for (const n of everyName) {
    const clusters = (n.name.match(/[^aeiouy]+/g) ?? []).filter((s) => consonantUnits(s).length >= 2).length
    if (clusters * 5 > n.name.length) bad.push(`${n.name}: ${clusters} clusters in ${n.name.length} letters`)
  }
  assert.deepEqual(bad, [], `${bad.length} name(s) break the alternation budget`)
})

test('no generated name contains a vowel pile-up', () => {
  const bad = everyName.filter((n) => /[aeiouy]{3}/.test(n.name)).map((n) => n.name)
  assert.deepEqual(bad, [], 'name(s) with three vowels in a row')
})

test('grafted endings land on a PROPORTION of names, and vary', () => {
  // The failure mode of grafting is monotony: graft every name and twenty-four
  // results all ending -a/-us/-iel read as one name printed twice. So this
  // asserts a band, not a floor -- too many grafts fails as loudly as none --
  // and that no single ending owns the batch.
  const graft = new Set(GRAFTS)
  const used = everyName.filter((n) => graft.has(n.parts[n.parts.length - 1]))
  const share = used.length / everyName.length
  assert.ok(share > 0.1, `only ${(share * 100).toFixed(1)}% of names take a graft -- the endings are not landing`)
  assert.ok(share < 0.45, `${(share * 100).toFixed(1)}% of names take a graft -- the output will read as generic fantasy`)

  const hist = {}
  for (const n of used) hist[n.parts[n.parts.length - 1]] = (hist[n.parts[n.parts.length - 1]] ?? 0) + 1
  assert.ok(Object.keys(hist).length >= 8, `only ${Object.keys(hist).length} distinct endings in use: ${JSON.stringify(hist)}`)
  const commonest = Math.max(...Object.values(hist))
  assert.ok(commonest / used.length < 0.3, `one ending is ${((commonest / used.length) * 100).toFixed(0)}% of all grafts: ${JSON.stringify(hist)}`)
})

test('a graft never lands on a vowel, and -eth still bars the verbs', () => {
  const graft = new Set(GRAFTS)
  for (const n of everyName) {
    const last = n.parts[n.parts.length - 1]
    if (!graft.has(last)) continue
    const stem = n.parts.slice(0, -1).join('')
    assert.ok(/[^aeiouy]$/.test(stem), `"${n.name}" grafted "${last}" onto the vowel-final stem "${stem}"`)
  }
  // -eth is available as a name ending…
  assert.equal(rejectReason(corpus, ['kel', 'eth']), null)
  // …but not as a conjugation. That is why `eth` moved out of BARRED_FINAL_RE
  // and into INFLECTIONS: the pattern barred both, the stem check bars only the
  // verb. Neither `glareth` nor `tradeth` is in the vocabulary, so the "is a
  // real word" rule cannot be what catches them -- it has to be the stem
  // underneath, which is the mechanism this is here to hold down.
  for (const verb of [['glar', 'eth'], ['trad', 'eth']]) {
    assert.ok(!corpus.wordSet.has(verb.join('')), `${verb.join('')} is in the vocabulary -- pick another verb`)
    assert.ok(rejectReason(corpus, verb), `"${verb.join('')}" is accepted -- -eth is no longer checked as a conjugation`)
  }
})

test('rejectReason accepts a finished name as well as parts', () => {
  assert.equal(rejectReason(corpus, getSyllables('tornoromic').map((s) => s.toLowerCase())), null)
  assert.ok(rejectReason(corpus, 'untruness'))
})
