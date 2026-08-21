#!/usr/bin/env node --test
// Name QUALITY, as opposed to set-algebra correctness.
//
// No test can tell you a name is good -- that was settled by reading batches.
// What a test CAN do is hold the line under the good names, and pin the
// arguments the design rests on. Every assertion here is either a name that
// was really produced, a rule the output depends on, or a measured fact about
// the corpus that decides what is possible at all.
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
  selectStages,
  mineStems,
  composeBatch,
  compoundEvidence,
  generateMorphemeBatch,
  makeNameFilter,
  legibilityReason,
  clusterInventory,
  consonantUnits,
  getSyllables,
  rng,
} from '../src/engine.js'
import { seamReason } from '../src/morphemes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpus = parseCorpus(gunzipSync(await readFile(join(__dirname, '..', 'dist', 'corpus.bin'))).buffer)

const vet = (w) => legibilityReason(corpus, w)

// A spread wide enough that a rule which only works on Lovecraft gets caught:
// a union, a single huge author, a tiny one, and a modern pair.
const RECIPES = [
  { t: 'default', ...DEFAULT_RECIPE },
  { t: 'shakespeare', include: ['shakespeare'], mode: 'all', exclude: [], rarity: 0 },
  { t: 'pooh', include: ['pooh'], mode: 'all', exclude: [], rarity: 0 },
  { t: 'pkd ∪ asimov', include: ['pkd', 'asimov'], mode: 'any', exclude: [], rarity: 0 },
  { t: 'austen ∖ dickens', include: ['austen'], mode: 'all', exclude: ['dickens'], rarity: 0 },
]

const batches = RECIPES.map((r) => {
  const sel = selectStages(corpus, r).afterExclude
  const stems = mineStems(corpus, sel, { vet })
  // Kept per seed as well as flattened: a batch is one screenful, and "no
  // repeats" is a promise about a screen, not about four screens stacked.
  const screens = [1, 7, 12345, 99999].map((seed) =>
    generateMorphemeBatch(corpus, null, { count: 24, seed, stems }),
  )
  return { r, stems, screens, names: screens.flat() }
})
const everyName = batches.flatMap((b) => b.names)

// -------------------------------------------------------------- the anchor
//
// `hypnodroid` is the one name out of this whole project anybody kept, and it
// is the acceptance criterion for the method. These three tests are the honest
// version of "can the engine emit it", and the honesty matters because the
// answer is not a simple yes.

test('TRIPWIRE: the composer joins hypno + droid into hypnodroid', () => {
  // This is the mechanism test. Given the two morphemes, the seam rule, the
  // filter and the assembler must produce exactly `hypnodroid` -- clean seam
  // (vowel meets consonant), not a real word, not rejected. If composition
  // ever breaks, this goes red first.
  assert.equal(seamReason('hypno', 'droid'), null)
  const names = composeBatch({
    count: 1,
    rand: rng(1),
    corpus,
    heads: [{ form: 'hypno', score: 1 }],
    tails: [{ form: 'droid', score: 1 }],
  })
  assert.deepEqual(names.map((n) => n.name), ['hypnodroid'])
  assert.deepEqual(names[0].parts, ['hypno', 'droid'])
})

test('MEASURED FACT: this corpus cannot supply `droid`, so it cannot mine hypnodroid', () => {
  // The uncomfortable finding, pinned so nobody re-litigates it from memory.
  // The library is 19th-century literary fiction plus the Kabbalah. `-droid`
  // is modern sci-fi shrapnel -- Asimov wrote "robot" -- and it appears in
  // ZERO words across all 58 sources. `hypno-` does exist, as a word-initial
  // fragment of `hypnotic`/`hypnotism`.
  //
  // So: the METHOD reaches hypnodroid, the DATA does not. Fixing that is a
  // corpus change (add a text containing the vocabulary), not a code change.
  assert.equal(corpus.words.filter((w) => w.includes('droid')).length, 0)
  assert.ok(corpus.words.filter((w) => w.startsWith('hypno')).length >= 5)
  assert.equal(corpus.wordSet.has('hypno'), false, 'hypno is a fragment, not a standalone word')
})

test('the old engine could not even SPELL hypnodroid', () => {
  // Why the syllable path was removed rather than tuned. The syllabifier cuts
  // on vowel clusters, straight through the seam that makes the name work.
  assert.deepEqual(getSyllables('hypnodroid'), ['hyp', 'nod', 'roid'])
  // …and the old pool capped syllables at 4 letters, so `droid` was dropped.
  assert.ok('droid'.length > 4)
})

// -------------------------------------------------------------- no censorship

test('obscenity is NOT filtered -- the generator does not censor', () => {
  // Inverted deliberately. An obscenity list was deleted from the engine at
  // the owner's explicit instruction -- "I like obscenity don't censor
  // things" -- and this assertion guards the opposite: that nobody quietly
  // reintroduces one. Rude compounds must survive on their merits like any
  // other, judged only by seam, length and already-a-word.
  // Seams chosen to be LEGAL, so that a rejection can only mean censorship.
  // (`ass|droid` and `cock|spire` are both cut for piling four consonants at
  // the seam -- that is the legibility rule doing its job to everyone alike,
  // and it would make a useless test of this.)
  const reject = makeNameFilter(corpus)
  for (const parts of [['shit', 'wagon'], ['piss', 'gate'], ['fuck', 'line'], ['ass', 'helm']]) {
    assert.equal(reject(parts), null, `"${parts.join('')}" is rejected -- an obscenity filter is back`)
  }
})

// -------------------------------------------------------------- mining

test('mining excludes what is not a word', () => {
  // Every one of these really leaked into a batch: `peacexxiii`, `cottonfifty`,
  // `londonaught`, and the apostrophe debris `doesn`.
  const forms = new Set(batches.flatMap((b) => b.stems.heads.map((h) => h.form)))
  for (const junk of ['xxiii', 'viii', 'iii', 'fifty', 'aught', 'naught', 'doesn', 'mightn', 'wouldn'])
    assert.ok(!forms.has(junk), `"${junk}" was mined as a stem`)
})

test('mining excludes inflected forms and function words', () => {
  const forms = new Set(batches.flatMap((b) => b.stems.heads.map((h) => h.form)))
  for (const w of ['hunters', 'walked', 'running', 'quickly', 'the', 'their', 'which'])
    assert.ok(!forms.has(w), `"${w}" is not a stem`)
})

test('there is no hand-written stem list -- every stem comes from the books', () => {
  // The owner's instruction was "purely drawn from the corpuses". A stem that
  // is not in the vocabulary would mean curation crept back in.
  for (const { r, stems } of batches)
    for (const s of [...stems.heads, ...stems.tails])
      assert.ok(corpus.wordSet.has(s.form), `${r.t}: "${s.form}" is not a corpus word`)
})

test('the books actually change the stems -- the pickers are not decoration', () => {
  // This is the test that fails if anyone reintroduces a fixed inventory, and
  // it is also the test that caught mining from `stages.final` (which returned
  // zero stems and made every recipe identical).
  const setOf = (b) => new Set(b.stems.heads.map((h) => h.form))
  const pooh = setOf(batches.find((b) => b.r.t === 'pooh'))
  const shake = setOf(batches.find((b) => b.r.t === 'shakespeare'))
  assert.ok(pooh.size > 50, `pooh only mined ${pooh.size} stems`)
  const onlyShake = [...shake].filter((w) => !pooh.has(w))
  assert.ok(onlyShake.length > 200, `only ${onlyShake.length} stems separate Shakespeare from Pooh`)
})

test('stems are vetted for legibility on the way IN', () => {
  // The deliberate asymmetry. Cluster rules gate the untrusted fragments
  // entering the inventory; they do NOT gate the assembled compound, because
  // `ironspine` breaks them and still reads. If the vet is dropped, this goes
  // red without touching the seam rules.
  for (const { r, stems } of batches)
    for (const s of stems.heads)
      assert.equal(vet(s.form), null, `${r.t}: unreadable stem "${s.form}" got in`)
})

test('position evidence is learned from real compounds, not declared', () => {
  const ev = compoundEvidence(corpus)
  // `moonlight` = moon + light, `seaside` = sea + side. English tells us which
  // words lead and which follow; nobody typed these.
  assert.ok(ev.tail.get('light') > 0, 'light has no evidence as a tail')
  assert.ok(ev.tail.get('land') > 0, 'land has no evidence as a tail')
  assert.ok(ev.head.get('sea') > 0, 'sea has no evidence as a head')
  assert.ok(ev.head.get('sun') > 0, 'sun has no evidence as a head')
  // Derivational endings dominate the raw counts and must be barred from the
  // tail slot, or every name reads as a word that lost its front half.
  const tails = new Set(batches.flatMap((b) => b.stems.tails.map((t) => t.form)))
  for (const w of ['less', 'able', 'ness', 'ment', 'ous'])
    assert.ok(!tails.has(w), `"-${w}" is offered as a tail`)
})

// -------------------------------------------------------------- the seam

test('a seam that runs two vowels together is cut', () => {
  assert.match(seamReason('sea', 'oath'), /two vowels/)
})

test('a doubled letter at the seam is cut', () => {
  assert.match(seamReason('veil', 'light'), /doubles l/)
  assert.match(seamReason('salt', 'tide'), /doubles t/)
})

test('a genuine pile-up is cut', () => {
  assert.match(seamReason('salt', 'sphere'), /piles 5/)
  assert.match(seamReason('hand', 'shrine'), /piles 5/)
  assert.match(seamReason('veil', 'sphere'), /piles 4/)
})

test('THE POINT: compound seams English uses are KEPT', () => {
  // engine.js would never spell `ftw` or `nsp` inside one invented word and it
  // is right not to. In a compound the reader recognises both halves, so the
  // cluster costs nothing. If this flips, the generator has collapsed back
  // into the syllable engine and there is no reason for it to exist.
  assert.equal(seamReason('drift', 'wake'), null) // ft|w
  assert.equal(seamReason('iron', 'spine'), null) // n|sp
  assert.equal(seamReason('moth', 'wake'), null) // th|w
  assert.equal(seamReason('hypno', 'droid'), null) // the anchor: vowel|dr
})

// -------------------------------------------------------------- batches

test('every recipe fills a whole 24-name batch, on every seed', () => {
  for (const { r, screens } of batches)
    for (const [i, s] of screens.entries())
      assert.equal(s.length, 24, `${r.t}: screen ${i} made only ${s.length}/24`)
})

test('a batch is not the same name over and over', () => {
  for (const { r, screens, names } of batches) {
    for (const s of screens) {
      const uniq = new Set(s.map((n) => n.name))
      assert.equal(uniq.size, s.length, `${r.t}: duplicate names in one batch`)
    }
    const across = new Set(names.map((n) => n.name))
    assert.ok(
      across.size >= names.length * 0.95,
      `${r.t}: only ${across.size} distinct across ${names.length} -- the space is collapsing`,
    )
  }
})

test('no head repeats within a screen', () => {
  // The eye reads down the left edge of a list, so two names starting the same
  // way look like a bug.
  for (const { r, screens } of batches)
    for (const s of screens) {
      const heads = s.map((n) => n.parts[0])
      assert.equal(new Set(heads).size, heads.length, `${r.t}: a head repeated in one screen`)
    }
})

test('every name spells its own parts, and is a compound not a word', () => {
  for (const n of everyName) {
    assert.equal(n.parts.join(''), n.name)
    assert.equal(n.parts.length, 2)
    assert.ok(!corpus.wordSet.has(n.name), `"${n.name}" is already an English word`)
    assert.ok(n.name.length >= 6 && n.name.length <= 14, `"${n.name}" is a bad length`)
  }
})

test('a seed reproduces its batch, and different seeds differ', () => {
  const sel = selectStages(corpus, DEFAULT_RECIPE).afterExclude
  const stems = mineStems(corpus, sel, { vet })
  const a = generateMorphemeBatch(corpus, null, { count: 24, seed: 12345, stems }).map((n) => n.name)
  const b = generateMorphemeBatch(corpus, null, { count: 24, seed: 12345, stems }).map((n) => n.name)
  const c = generateMorphemeBatch(corpus, null, { count: 24, seed: 999, stems }).map((n) => n.name)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
})

test('the morpheme count is honoured, and 3 works', () => {
  const sel = selectStages(corpus, DEFAULT_RECIPE).afterExclude
  const stems = mineStems(corpus, sel, { vet })
  for (const parts of [2, 3]) {
    const names = generateMorphemeBatch(corpus, null, { count: 24, seed: 5, stems, parts })
    assert.equal(names.length, 24, `parts=${parts} made only ${names.length}`)
    for (const n of names) assert.equal(n.parts.length, parts, `"${n.name}" has ${n.parts.length} parts`)
  }
})

test('the output space is big enough not to be exhausted', () => {
  // The whole risk of moving off syllables. The old engine scored 18,757
  // distinct over 40 seeds x 500 and was not saturated; a curated inventory
  // scored a few hundred, which is why curation was abandoned.
  const sel = selectStages(corpus, DEFAULT_RECIPE).afterExclude
  const stems = mineStems(corpus, sel, { vet })
  const seen = new Set()
  for (let seed = 1; seed <= 10; seed++)
    for (const n of generateMorphemeBatch(corpus, null, { count: 500, seed, stems })) seen.add(n.name)
  assert.ok(seen.size > 4000, `only ${seen.size} distinct names over 10 x 500`)
})

// -------------------------------------------------------------- legibility
//
// The surviving half of the old engine, and it is load-bearing: it is what
// vets a mined stem. Every string in HARD is one he pointed at, or one a batch
// actually served.

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

const READABLE = [
  'tornoromic', 'quarbet', 'galce', 'algel', 'coelim', 'terskiel', 'narai',
  'thalis', 'orros', 'hirmitor', 'trinocal', 'wilvetur', 'tarelsior',
  'mithronian', 'gloleriel', 'proerius', 'strovan',
]

test('the fragments that are hard to READ are rejected', () => {
  for (const [name, why] of HARD)
    assert.ok(legibilityReason(corpus, name), `"${name}" is still accepted -- ${why}`)
})

test('strange but readable fragments survive the legibility rules', () => {
  for (const name of READABLE)
    assert.equal(legibilityReason(corpus, name), null, `"${name}" was filtered as hard to read`)
})

test('the cluster inventory is built from English, not declared', () => {
  const inv = clusterInventory(corpus)
  assert.ok(inv.initial.has('tr') && inv.initial.has('st'), 'tr- and st- must open words')
  assert.ok(inv.final.has('nd'), '-nd must end words')
  assert.ok(!inv.initial.has('zrm'), 'zrm- opens nothing')
  assert.deepEqual(consonantUnits('str'), ['s', 't', 'r'])
  assert.deepEqual(consonantUnits('ngth'), ['ng', 'th'])
})
