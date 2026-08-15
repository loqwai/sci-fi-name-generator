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
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCorpus, selectWords, selectStages, countBits, syllablePool, generateNames } from '../src/engine.js'

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
    const sel = selectWords(corpus, { include: [id], mode: 'all', exclude: [], rarity: 2 })
    const names = generateNames(corpus, syllablePool(corpus, sel), { count: 8, seed: 3 })
    if (!names.length) bad.push(id)
  }
  assert.deepEqual(bad, [], `these authors produced no names alone: ${bad.join(', ')}`)
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
