#!/usr/bin/env node --test
// The morpheme prototype's rules, pinned.
//
// Same discipline as names.test.mjs: no test can tell you a name is good. What
// these hold is the SHAPE of the argument -- that the anchor name survives,
// that the seam rule is conditional on recognisability rather than constant,
// and that the tautology and repeat filters actually fire. Every assertion is
// a name that was really produced or really cut during tuning.
//
// Deliberately corpus-free so it runs in a fresh checkout: dist/ is gitignored,
// and a test that cannot run is not a test.
//
//   node --test scripts/morphemes.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HEADS,
  TAILS,
  seamReason,
  clashReason,
  makeMorphemeFilter,
  allPairs,
  generateMorphemeNames,
} from '../src/morphemes.js'

const head = (form) => HEADS.find((x) => x.form === form)
const tail = (form) => TAILS.find((x) => x.form === form)
const reject = makeMorphemeFilter()
const pair = (a, b) => reject(head(a), tail(b))

// ---------------------------------------------------------------- the anchor

test('hypnodroid survives -- the name the whole prototype exists to explain', () => {
  assert.equal(pair('hypno', 'droid'), null)
  assert.equal(head('hypno').form + tail('droid').form, 'hypnodroid')
})

test('hypnodroid is actually reachable by the generator, not just legal', () => {
  // Legal-but-never-drawn would be the quiet failure: a reuse cap or an
  // attempt budget can make a pair unreachable while every unit test passes.
  const seen = new Set()
  for (let seed = 1; seed <= 60; seed++)
    for (const n of generateMorphemeNames({ seed, count: 24 })) seen.add(n.name)
  assert.ok(seen.has('hypnodroid'), 'hypnodroid never came up in 60 batches')
})

// ---------------------------------------------------------------- the seam

test('every bound head ends in its linking vowel', () => {
  // This is what makes the seam audible. A bound form that lost its vowel
  // would give `hypndroid`, which is the syllable engine's problem again.
  for (const x of HEADS.filter((x) => x.bound))
    assert.match(x.form, /[aeiouy]$/, `${x.form}- has no linking vowel`)
})

test('a bound head cannot take a vowel-initial tail', () => {
  assert.equal(seamReason(head('hypno'), tail('ember')), 'hypno|ember runs two vowels together')
  assert.equal(seamReason(head('cryo'), tail('echo')), 'cryo|echo runs two vowels together')
})

test('THE POINT: a free-word seam is kept where an invented-word seam would be cut', () => {
  // engine.js would never spell `ftw` or `thr` inside one made-up word, and it
  // is right not to -- the reader has nothing to segment by. In a compound the
  // reader recognises both halves, so the same cluster costs nothing. If this
  // assertion ever flips, the prototype has collapsed back into the syllable
  // engine and there is no reason for it to exist.
  assert.equal(pair('drift', 'wake'), null) // ft|w
  assert.equal(pair('iron', 'spine'), null) // n|sp
  assert.equal(pair('smoke', 'spire'), null) // k|sp
  assert.equal(pair('moth', 'droid'), null) // th|d
})

test('but a genuine pile-up is still cut, compound or not', () => {
  assert.equal(seamReason(head('salt'), tail('sphere')), 'salt|sphere piles 5 consonants at the seam')
  assert.equal(seamReason(head('veil'), tail('sphere')), 'veil|sphere piles 4 consonants at the seam')
  assert.equal(seamReason(head('frost'), tail('thorn')), 'frost|thorn piles 4 consonants at the seam')
})

test('a doubled letter at the seam is cut', () => {
  // `veillight`, `salttide`, `duskkin`, `hollowwright` -- all really produced.
  assert.equal(seamReason(head('veil'), tail('light')), 'veil|light doubles l at the seam')
  assert.equal(seamReason(head('salt'), tail('tide')), 'salt|tide doubles t at the seam')
  assert.equal(seamReason(head('dusk'), tail('kin')), 'dusk|kin doubles k at the seam')
})

test('a sibilant sliding into a vowel-initial tail is cut', () => {
  assert.equal(seamReason(head('glass'), tail('ember')), 'glass|ember blurs a sibilant into the vowel')
  assert.equal(seamReason(head('ash'), tail('echo')), 'ash|echo blurs a sibilant into the vowel')
})

test('vowel-final head plus consonant tail is always clean', () => {
  for (const x of HEADS.filter((x) => /[aeiouy]$/.test(x.form)))
    for (const y of TAILS.filter((y) => /^[^aeiouy]/.test(y.form)))
      assert.equal(seamReason(x, y), null, `${x.form}|${y.form} should be a clean seam`)
})

// ---------------------------------------------------------------- meaning

test('tautologies are cut', () => {
  assert.equal(clashReason(head('helio'), tail('light')), 'helio+light is light twice')
  assert.equal(clashReason(head('umbra'), tail('shade')), 'umbra+shade is dark twice')
  assert.equal(clashReason(head('brine'), tail('tide')), 'brine+tide is water twice')
  assert.equal(clashReason(head('bone'), tail('spine')), 'bone+spine is body twice')
})

test('contradictions are KEPT -- the oxymorons are the good names', () => {
  // A semantic filter clever enough to notice that ice does not bloom would
  // delete the three best names the inventory makes.
  assert.equal(pair('cryo', 'bloom'), null)
  assert.equal(pair('necro', 'bloom'), null)
  assert.equal(pair('frost', 'ember'), null)
})

test('real words are cut', () => {
  assert.equal(pair('cryo', 'sphere'), 'cryosphere is already a word')
  assert.equal(pair('iron', 'smith'), 'ironsmith is already a word')
})

test('the taken-word list contains only words that are really words', () => {
  // The first draft claimed `chronoform`, `sporeform`, `bonemark` and
  // `ironmark` were English. They are not, and they are four of the better
  // names available -- a filter that invents its evidence deletes the point
  // while looking rigorous.
  for (const [a, b] of [
    ['chrono', 'form'],
    ['spore', 'form'],
    ['bone', 'mark'],
    ['iron', 'mark'],
  ])
    assert.equal(pair(a, b), null, `${a}${b} was cut`)
})

// ---------------------------------------------------------------- batches

test('a batch fills the screen', () => {
  assert.equal(generateMorphemeNames({ seed: 12345, count: 24 }).length, 24)
})

test('no head repeats in a batch, and no tail more than twice', () => {
  for (const seed of [1, 7, 12345, 99999]) {
    const names = generateMorphemeNames({ seed, count: 24 })
    const heads = new Map()
    const tails = new Map()
    for (const n of names) {
      heads.set(n.head.form, (heads.get(n.head.form) ?? 0) + 1)
      tails.set(n.tail.form, (tails.get(n.tail.form) ?? 0) + 1)
    }
    for (const [f, c] of heads) assert.ok(c <= 1, `seed ${seed}: head ${f}- used ${c} times`)
    for (const [f, c] of tails) assert.ok(c <= 2, `seed ${seed}: tail -${f} used ${c} times`)
  }
})

test('a seed reproduces its batch, and different seeds differ', () => {
  const a = generateMorphemeNames({ seed: 12345, count: 24 }).map((n) => n.name)
  const b = generateMorphemeNames({ seed: 12345, count: 24 }).map((n) => n.name)
  const c = generateMorphemeNames({ seed: 999, count: 24 }).map((n) => n.name)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
})

test('every generated name is one head and one tail, spelled exactly', () => {
  for (const n of generateMorphemeNames({ seed: 4242, count: 24 })) {
    assert.equal(n.parts.join(''), n.name)
    assert.ok(HEADS.includes(n.head) && TAILS.includes(n.tail))
    assert.equal(reject(n.head, n.tail), null, `${n.name} was generated but the filter rejects it`)
  }
})

test('the filter cuts a real share of the table but leaves most of it', () => {
  // A canary on both directions. A filter that keeps everything is not
  // filtering; one that keeps 40 pairs cannot fill a screen without repeats.
  const { kept, cut } = allPairs()
  assert.equal(kept.length + cut.length, HEADS.length * TAILS.length)
  assert.ok(cut.length > 100, `only ${cut.length} pairs cut -- the rules stopped biting`)
  assert.ok(kept.length > 300, `only ${kept.length} pairs kept -- the rules are eating the inventory`)
})
