// The name engine. No DOM, no imports -- runs identically in Node (for the
// quality harness) and in the browser.
//
// This is scratch.test.js, preserved:
//   1. word-level set math between authors to isolate distinctive vocabulary
//   2. split the surviving words into syllables (vowel-cluster regex)
//   3. glue 2-4 random syllables together
//   4. keep it if it is >= 5 chars and passes pronounceable.test
// His accepted outputs were `tornoromic` and `quarbet`.

// ---------------------------------------------------------------- parsing

const MAGIC = 'NAMEGEN2'

export const parseCorpus = (buf) => {
  const bytes = new Uint8Array(buf)
  const dec = new TextDecoder()
  let p = 0
  const u32 = () => {
    const v = new DataView(bytes.buffer, bytes.byteOffset + p, 4).getUint32(0, true)
    p += 4
    return v
  }
  if (dec.decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error('bad corpus magic')
  p = 8

  const metaLen = u32()
  const meta = JSON.parse(dec.decode(bytes.subarray(p, p + metaLen)))
  p += metaLen

  const wordLen = u32()
  const words = dec.decode(bytes.subarray(p, p + wordLen)).split('\n')
  p += wordLen

  const wordsPerSet = u32()
  const bitsets = {}
  for (const s of meta.sources) {
    // copy: the source buffer may not be 4-byte aligned
    const slice = bytes.slice(p, p + wordsPerSet * 4)
    bitsets[s.id] = new Uint32Array(slice.buffer, slice.byteOffset, wordsPerSet)
    p += wordsPerSet * 4
  }

  const dfLen = u32()
  const df = bytes.slice(p, p + dfLen)
  p += dfLen

  const triLen = u32()
  const triBits = bytes.slice(p, p + triLen)
  p += triLen

  const wordSet = new Set(words)
  return { meta, words, wordSet, bitsets, df, triBits, wordsPerSet }
}

// ---------------------------------------------------------------- pronounceable
// Exact replication of pronounceable.test() for words of length >= 3: that code
// path consults only triples.json and only compares each probability to a fixed
// 0.001 threshold, so the whole decision surface is one bit per 3-letter
// sequence -- 17,576 bits, 2.2 KB, instead of a 1.9 MB dependency.

const A = 97
export const makePronounceable = (triBits) => (w) => {
  for (let i = 0; i + 2 < w.length; i++) {
    const idx =
      (w.charCodeAt(i) - A) * 676 + (w.charCodeAt(i + 1) - A) * 26 + (w.charCodeAt(i + 2) - A)
    if (idx < 0 || idx >= 17576) return false
    if ((triBits[idx >>> 3] & (1 << (idx & 7))) === 0) return false
  }
  return true
}

// ---------------------------------------------------------------- syllables
// verbatim from syllable-parser.js
const syllableRegex = /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi

export const getSyllables = (word) => word.match(syllableRegex)

// ---------------------------------------------------------------- set math

// A recipe:
//   include: [sourceId], mode: 'all' (intersect) | 'any' (union)
//   exclude: [sourceId]
//   rarity:  N   -- drop words appearing in >= N of the 63 classics.
//                   1 = his original "not in top100 at all". 0 = off.
export const selectWords = (corpus, recipe) => {
  const { bitsets, df, wordsPerSet } = corpus
  const inc = recipe.include.filter((id) => bitsets[id])
  if (!inc.length) return new Uint32Array(wordsPerSet)

  const out = new Uint32Array(wordsPerSet)
  if (recipe.mode === 'all') {
    out.set(bitsets[inc[0]])
    for (let k = 1; k < inc.length; k++) {
      const b = bitsets[inc[k]]
      for (let i = 0; i < wordsPerSet; i++) out[i] &= b[i]
    }
  } else {
    for (const id of inc) {
      const b = bitsets[id]
      for (let i = 0; i < wordsPerSet; i++) out[i] |= b[i]
    }
  }

  for (const id of recipe.exclude) {
    const b = bitsets[id]
    if (!b) continue
    for (let i = 0; i < wordsPerSet; i++) out[i] &= ~b[i]
  }

  // Rarity, leave-one-out.
  //
  // Naively "drop anything appearing in >= N classics" self-destructs: if you
  // intersect Shakespeare with the Bible, every surviving word is by definition
  // in >= 2 classics, so the filter deletes exactly what you just asked for.
  // So a source's own books do not count as evidence of commonness -- we ask
  // "is this word common ELSEWHERE, outside the authors you picked?".
  const rarity = recipe.rarity | 0
  if (rarity > 0) {
    const byId = Object.fromEntries(corpus.meta.sources.map((s) => [s.id, s]))
    const own = inc
      .map((id) => ({ b: bitsets[id], c: byId[id]?.classics | 0 }))
      .filter((x) => x.c > 0)
    for (let i = 0; i < df.length; i++) {
      const wi = i >>> 5
      const bit = 1 << (i & 31)
      if ((out[wi] & bit) === 0) continue
      let d = df[i]
      for (let k = 0; k < own.length; k++) if (own[k].b[wi] & bit) d -= own[k].c
      if (d >= rarity) out[wi] &= ~bit
    }
  }
  return out
}

export const countBits = (bs) => {
  let n = 0
  for (let i = 0; i < bs.length; i++) {
    let v = bs[i]
    v = v - ((v >>> 1) & 0x55555555)
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
  }
  return n
}

// The syllable pool keeps duplicates, exactly like the original's
// words.map(getSyllables).flat() -- a syllable used by many distinct words is
// proportionally more likely to be drawn.
export const syllablePool = (corpus, selection, opts = {}) => {
  // maxSyl: he capped syllables at length < 4 in his own second experiment.
  // Long syllables are what turn glued names into consonant sludge.
  const { maxSyl = 4 } = opts
  const pool = []
  const { words } = corpus
  for (let i = 0; i < words.length; i++) {
    if ((selection[i >>> 5] & (1 << (i & 31))) === 0) continue
    const syls = getSyllables(words[i])
    if (!syls) continue
    for (const s of syls) {
      if (s.length > maxSyl) continue
      pool.push(s.toLowerCase())
    }
  }
  return pool
}

// ---------------------------------------------------------------- generation

// mulberry32 -- so a (recipe, seed) pair always reproduces the same batch.
export const rng = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const generateNames = (corpus, pool, opts = {}) => {
  const { count = 24, minLength = 5, maxLength = 12, seed = 1, rejectRealWords = true } = opts
  if (pool.length < 8) return []

  const rand = rng(seed)
  const randomInRange = (min, max) => Math.floor(rand() * (max - min + 1) + min)
  const isPronounceable = makePronounceable(corpus.triBits)

  // He drew a uniform 2-4 syllables. Both of his keepers came from that range
  // (quarbet = 2, tornoromic = 4), but 4 long syllables is where the sludge
  // comes from, so 4 is drawn a little less often.
  const shape = opts.shape ?? [2, 2, 3, 3, 4]

  // English suffix syllables are wildly frequent, so the uniform draw keeps
  // opening names with them -- "tionves", "nesslar". They read as a word that
  // lost its front half. Only barred in first position; mid-word they are fine.
  const BAD_FIRST = new Set([
    'tion', 'tions', 'sion', 'sions', 'tio', 'ness', 'ment', 'ance', 'ence',
    'ing', 'ings', 'ous', 'ious', 'est', 'ed', 'es', 'ies', 'ly',
  ])

  const out = []
  const seen = new Set()
  const maxAttempts = count * 400

  for (let a = 0; a < maxAttempts && out.length < count; a++) {
    const parts = []
    const n = shape[randomInRange(0, shape.length - 1)]
    for (let i = 0; i < n; i++) parts.push(pool[randomInRange(0, pool.length - 1)])
    const w = parts.join('')

    if (w.length < minLength || w.length > maxLength) continue
    if (BAD_FIRST.has(parts[0])) continue
    if (!isPronounceable(w)) continue
    if (seen.has(w)) continue
    // A "generated" name that is just an existing English word is a dud.
    if (rejectRealWords && corpus.wordSet.has(w)) continue
    seen.add(w)
    out.push({ name: w, parts })
  }
  return out
}
