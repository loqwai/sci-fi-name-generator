#!/usr/bin/env node --test
// Set-algebra invariants for the shipped corpus.
//
// Written because he reported "the union of Philip K. Dick and Isaac Asimov was
// empty", which is arithmetic-impossible for two non-empty sets. These assert
// the laws themselves across EVERY author pair rather than spot-checking a
// combination someone thought to try -- the report came from a pair nobody had
// sampled.
//
//   node --test scripts/setmath.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCES } from './corpora.mjs'
import { DEFAULT_RECIPE, parseCorpus, selectWords, selectStages, countBits, mineStems, legibilityReason, generateMorphemeBatch } from '../src/engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpus = parseCorpus(gunzipSync(await readFile(join(__dirname, '..', 'dist', 'corpus.bin'))).buffer)

const IDS = corpus.meta.sources.map((s) => s.id)
const N = countBits
const raw = (ids, mode = 'all') => selectWords(corpus, { include: ids, mode, exclude: [], rarity: 0 })

// is every bit of `sub` also set in `sup`?
const isSubset = (sub, sup) => {
  for (let i = 0; i < sub.length; i++) if (sub[i] & ~sup[i]) return false
  return true
}
const equal = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const PAIRS = []
for (let i = 0; i < IDS.length; i++)
  for (let j = i + 1; j < IDS.length; j++) PAIRS.push([IDS[i], IDS[j]])

// A book with no chip is not just unpickable. The df pass adds 1 to a word's
// total frequency per document, so a word occurring only in unattributed books
// tops out at 1 and MIN_TOTAL_FREQ deletes it. Nineteen books were in that
// state and silently took ~20k words with them. This is the guard.
test('every book in top100 is attributed to a chip', async () => {
  const attributed = new Set()
  for (const s of SOURCES) for (const f of s.files ?? []) attributed.add(f.replace(/\\/g, '/'))

  const dir = join(__dirname, '..', '..', 'data', 'top100')
  const orphans = (await readdir(dir)).filter((f) => !attributed.has(`top100/${f}`))

  assert.deepEqual(
    orphans,
    [],
    `${orphans.length} book(s) feed the common-English filter but no chip, so their unique words are pruned: ${orphans.join(', ')}`,
  )
})

test('every author has a non-empty vocabulary', () => {
  assert.ok(IDS.length >= 30, `only ${IDS.length} sources`)
  for (const id of IDS) {
    assert.ok(corpus.bitsets[id], `${id} has no bitset`)
    assert.ok(N(raw([id])) > 0, `${id} resolved to an empty set`)
  }
})

test('the two smallest corpora are not degenerate', () => {
  // Asimov is 2 files / 133 KB and PKD 13 files; if a build-time frequency cut
  // ever wipes them out, this is where it shows up first.
  for (const id of ['asimov', 'pkd']) {
    assert.ok(N(raw([id])) > 500, `${id} only has ${N(raw([id]))} words`)
  }
})

test('UNION: |A ∪ B| >= max(|A|,|B|), and it contains both operands', () => {
  for (const [a, b] of PAIRS) {
    const A = raw([a])
    const B = raw([b])
    const U = raw([a, b], 'any')
    const label = `${a} ∪ ${b}`
    assert.ok(N(U) >= Math.max(N(A), N(B)), `${label}: |U|=${N(U)} < max(${N(A)},${N(B)})`)
    assert.ok(isSubset(A, U), `${label}: A ⊄ A∪B`)
    assert.ok(isSubset(B, U), `${label}: B ⊄ A∪B`)
    assert.ok(N(U) > 0, `${label} was EMPTY`)
  }
})

test('INTERSECTION: |A ∩ B| <= min(|A|,|B|), and it is contained in both', () => {
  for (const [a, b] of PAIRS) {
    const A = raw([a])
    const B = raw([b])
    const I = raw([a, b], 'all')
    const label = `${a} ∩ ${b}`
    assert.ok(N(I) <= Math.min(N(A), N(B)), `${label}: |I|=${N(I)} > min(${N(A)},${N(B)})`)
    assert.ok(isSubset(I, A), `${label}: A∩B ⊄ A`)
    assert.ok(isSubset(I, B), `${label}: A∩B ⊄ B`)
  }
})

test('inclusion-exclusion holds: |A ∪ B| = |A| + |B| - |A ∩ B|', () => {
  for (const [a, b] of PAIRS) {
    const lhs = N(raw([a, b], 'any'))
    const rhs = N(raw([a])) + N(raw([b])) - N(raw([a, b], 'all'))
    assert.equal(lhs, rhs, `${a},${b}: ${lhs} != ${rhs}`)
  }
})

test('intersection is never larger than union', () => {
  for (const [a, b] of PAIRS) {
    assert.ok(N(raw([a, b], 'all')) <= N(raw([a, b], 'any')), `${a},${b}`)
  }
})

test('DIFFERENCE: A ∖ B ⊆ A, and A ∖ nothing = A', () => {
  for (const [a, b] of PAIRS.slice(0, 200)) {
    const A = raw([a])
    const D = selectWords(corpus, { include: [a], mode: 'all', exclude: [b], rarity: 0 })
    assert.ok(isSubset(D, A), `${a} ∖ ${b} ⊄ ${a}`)
    const same = selectWords(corpus, { include: [a], mode: 'all', exclude: [], rarity: 0 })
    assert.ok(equal(same, A), `${a} ∖ ∅ != ${a}`)
  }
})

test('subtracting a set from itself empties it', () => {
  for (const id of IDS) {
    const D = selectWords(corpus, { include: [id], mode: 'all', exclude: [id], rarity: 0 })
    assert.equal(N(D), 0, `${id} ∖ ${id} was not empty`)
  }
})

test('the common-English filter only ever removes, and loosening keeps more', () => {
  for (const id of IDS) {
    const base = raw([id])
    let prev = null
    for (const rarity of [1, 2, 6, 20]) {
      const f = selectWords(corpus, { include: [id], mode: 'all', exclude: [], rarity })
      assert.ok(isSubset(f, base), `${id} ≥${rarity} escaped the base set`)
      if (prev !== null) assert.ok(N(f) >= prev, `${id}: ≥${rarity} kept fewer than the stricter setting`)
      prev = N(f)
    }
    // rarity 0 means the filter is off entirely
    assert.ok(equal(selectWords(corpus, { include: [id], mode: 'all', exclude: [], rarity: 0 }), base), id)
  }
})

test('stage breakdown adds up: final ⊆ afterExclude ⊆ base', () => {
  const r = { include: ['lovecraft', 'stoker'], mode: 'all', exclude: ['dickens'], rarity: 2 }
  const s = selectStages(corpus, r)
  assert.ok(isSubset(s.afterExclude, s.base), 'afterExclude ⊄ base')
  assert.ok(isSubset(s.final, s.afterExclude), 'final ⊄ afterExclude')
  assert.equal(N(s.base), N(s.afterExclude) + N(s.droppedByExclude), 'exclude counts do not add up')
  assert.equal(N(s.afterExclude), N(s.final) + N(s.droppedByCommon), 'common counts do not add up')
})

// The exact combination he reported.
test('PKD ∪ Asimov is not empty at any setting', () => {
  for (const rarity of [0, 1, 2, 6]) {
    const n = N(selectWords(corpus, { include: ['pkd', 'asimov'], mode: 'any', exclude: [], rarity }))
    assert.ok(n > 0, `PKD ∪ Asimov ≥${rarity} was empty`)
  }
  // and it really is bigger than either alone
  const u = N(selectWords(corpus, { include: ['pkd', 'asimov'], mode: 'any', exclude: [], rarity: 2 }))
  const p = N(selectWords(corpus, { include: ['pkd'], mode: 'all', exclude: [], rarity: 2 }))
  assert.ok(u >= p, `union ${u} < PKD alone ${p}`)
})

test('every single author on its own can still produce names', () => {
  const bad = []
  for (const id of IDS) {
    // rarity 0: morpheme stems are harvested BEFORE the common-English cut,
    // because the cut removes exactly the recognisable words a stem is made
    // of. Harvesting a rarity-filtered set returns zero stems.
    const sel = selectWords(corpus, { include: [id], mode: 'all', exclude: [], rarity: 0 })
    const names = generateMorphemeBatch(corpus, sel, { count: 8, seed: 3 })
    if (!names.length) bad.push(id)
  }
  assert.deepEqual(bad, [], `these authors produced no names alone: ${bad.join(', ')}`)
})

// ---------------------------------------------------------------- the default
//
// The first screen is the demo: he opens this in front of people and hands over
// the phone. With zero taps it has to be already full of names. An empty first
// screen is the failure that started all of this -- he saw one, and reasonably
// concluded the whole thing was broken.
//
// So these assert the SHIPPED default (imported, not copied) is nowhere near
// running dry, with room to spare rather than a squeak past zero.

const BATCH = 24 // must match BATCH in app.js

test('THE DEFAULT RECIPE fills a whole batch, on every seed', () => {
  const stems = mineStems(corpus, selectStages(corpus, DEFAULT_RECIPE, { vet: (w) => legibilityReason(corpus, w) }).afterExclude)

  // Not one lucky seed: the app picks a random one on every load and on every
  // ROLL AGAIN, so a default that only fills up sometimes is still broken.
  for (const seed of [1, 2, 3, 12345, 777, 31337, 20260815, 424242, 999999, 8080]) {
    const names = generateMorphemeBatch(corpus, null, { count: BATCH, seed, stems })
    assert.equal(
      names.length,
      BATCH,
      `default only made ${names.length}/${BATCH} names at seed ${seed}`,
    )
    for (const n of names) {
      assert.ok(n.name.length >= 5, `"${n.name}" is too short to be a name`)
      assert.equal(n.parts.length, 2, `"${n.name}" is not a head plus a tail`)
      assert.equal(n.parts.join(''), n.name, `"${n.name}" does not spell its own parts`)
    }
  }
})

test('THE DEFAULT RECIPE keeps headroom at every stage', () => {
  const s = selectStages(corpus, DEFAULT_RECIPE)
  const stems = mineStems(corpus, s.afterExclude, { vet: (w) => legibilityReason(corpus, w) })

  // Real values at the time of writing: 16,680 base words → 2,014 stems.
  // These floors sit far below that but far above "survived by two words", so
  // they fail on a genuine collapse rather than on ordinary corpus drift.
  assert.ok(countBits(s.base) > 5000, `base set is only ${countBits(s.base)} words`)
  assert.ok(countBits(s.final) > 500, `only ${countBits(s.final)} words survive the filters`)
  assert.ok(stems.heads.length > 800, `only ${stems.heads.length} head stems to build from`)
  assert.ok(stems.tails.length > 500, `only ${stems.tails.length} tail stems to build from`)
})

test('THE DEFAULT RECIPE fails safe: every ＋ tap makes the set bigger', () => {
  // Why the default is a union. From an intersection each added author shrinks
  // the set toward empty; from a union it can only grow, so no single tap from
  // the first screen can land him back on a blank result.
  assert.equal(DEFAULT_RECIPE.mode, 'any', 'default must be a union to fail safe')

  const before = countBits(selectWords(corpus, DEFAULT_RECIPE))
  for (const id of IDS) {
    if (DEFAULT_RECIPE.include.includes(id)) continue
    const r = { ...DEFAULT_RECIPE, include: [...DEFAULT_RECIPE.include, id] }
    const after = countBits(selectWords(corpus, r))
    assert.ok(after >= before, `adding ${id} shrank the set: ${before} → ${after}`)

    const names = generateMorphemeBatch(corpus, selectStages(corpus, r).afterExclude, {
      count: BATCH,
      seed: 7,
    })
    assert.equal(names.length, BATCH, `+${id} from the default made only ${names.length} names`)
  }
})

test('a deep intersection may legitimately run dry — and the stages say so', () => {
  // This is what he actually hit: four authors intersected at the strictest
  // setting. The maths is right; the set really is that small. What was wrong
  // was that the UI did not say which stage emptied it.
  const r = { include: ['lovecraft', 'stoker', 'pkd', 'asimov'], mode: 'all', exclude: [], rarity: 1 }
  const s = selectStages(corpus, r)
  assert.ok(N(s.base) > 1000, 'the four-way intersection itself should be healthy')
  assert.ok(N(s.final) < 10, 'the common filter should be what guts it')
  assert.equal(N(s.afterExclude), N(s.final) + N(s.droppedByCommon))
})
