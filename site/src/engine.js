// The name engine. No DOM, no imports -- runs identically in Node (for the
// quality harness) and in the browser.
//
// This is scratch.test.js, preserved:
//   1. word-level set math between authors to isolate distinctive vocabulary
//   2. split the surviving words into syllables (vowel-cluster regex)
//   3. glue 2-4 random syllables together
//   4. keep it if it is >= 5 chars and passes pronounceable.test
// His accepted outputs were `tornoromic` and `quarbet`.

// ---------------------------------------------------------------- the default
//
// What the first screen shows before anyone taps anything. It lives here, next
// to the engine, rather than in app.js, so the test suite can assert on the
// SAME object the app boots with -- a copy in the test would drift and pass
// while the real default rotted.
//
// Chosen by reading output, not by reasoning about it. Three things decided it:
//
//   UNION, not intersection. `A ∩ B ∖ common` is structurally a proper-noun
//   machine: the words two authors share are ordinary English, so whatever
//   survives the common-English filter is the residue -- surnames, places,
//   admin vocabulary. The old default really did serve `gertrude, stafford,
//   presidency, fairfield, thompson, sydney, webb`. Union has the opposite
//   shape: it keeps each author's own distinctive words.
//
//   It also fails safe. From a union, every ＋ tap makes the set BIGGER. From
//   an intersection every tap makes it smaller, which is how he arrived at an
//   empty screen and concluded the tool was broken.
//
//   ≥1, not ≥2. The strictest common-English setting is only dangerous on an
//   intersection (that is what gutted the four-way to 2 words). On a union of
//   16,680 words it is the setting that strips English morphology out of the
//   syllable pool -- ≥2 leaves enough -tion/-ness/-ship behind to produce
//   "untruness" and "manchoship". ≥1 gives `thalis, narai, terskiel, orros`.
//
//   Lovecraft ∪ the Kabbalah, because a grimoire is the Necronomicon's own
//   register, and it keeps the project's anchor author on the first screen.
export const DEFAULT_RECIPE = {
  include: ['lovecraft', 'kabbalah'],
  exclude: [],
  mode: 'any',
  rarity: 1,
}

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
// Returns every intermediate stage, so the UI can show what each operation
// removed -- not just what survived. "These 1,204 words were dropped as common
// English" is the step you otherwise have to take on faith.
export const selectStages = (corpus, recipe) => {
  const { bitsets, wordsPerSet } = corpus
  const base = selectWords(corpus, { ...recipe, exclude: [], rarity: 0 })
  const afterExclude = base.slice()
  for (const id of recipe.exclude) {
    const b = bitsets[id]
    if (!b) continue
    for (let i = 0; i < wordsPerSet; i++) afterExclude[i] &= ~b[i]
  }
  const final = selectWords(corpus, recipe)

  const droppedByExclude = new Uint32Array(wordsPerSet)
  const droppedByCommon = new Uint32Array(wordsPerSet)
  for (let i = 0; i < wordsPerSet; i++) {
    droppedByExclude[i] = base[i] & ~afterExclude[i]
    droppedByCommon[i] = afterExclude[i] & ~final[i]
  }
  return { base, afterExclude, final, droppedByExclude, droppedByCommon }
}

// Walk a bitset back to the words themselves. `limit` takes an even spread
// rather than the first N -- the vocabulary is ordered by membership pattern,
// so the first N would all come from one cluster and look unrepresentative.
export const wordsIn = (corpus, bitset, limit = 0) => {
  const out = []
  const { words } = corpus
  for (let i = 0; i < words.length; i++) {
    if (bitset[i >>> 5] & (1 << (i & 31))) out.push(words[i])
  }
  if (!limit || out.length <= limit) return out
  const step = out.length / limit
  const sample = []
  for (let i = 0; i < limit; i++) sample.push(out[Math.floor(i * step)])
  return sample
}

// Which source words in the current set actually contain this syllable? This is
// what makes a generated name checkable: you can see the real words it came from.
export const wordsWithSyllable = (corpus, bitset, syllable, limit = 6) => {
  const out = []
  const { words } = corpus
  for (let i = 0; i < words.length && out.length < limit; i++) {
    if ((bitset[i >>> 5] & (1 << (i & 31))) === 0) continue
    const syls = getSyllables(words[i])
    if (syls && syls.some((s) => s.toLowerCase() === syllable)) out.push(words[i])
  }
  return out
}

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

// ---------------------------------------------------------------- morphology
//
// The whole quality problem in one place.
//
// Every bad name this generator produced failed the same way: visible English
// grammar glued on. `mationcity` is ma+TION+ci+TY. `fieltusing` is fielt+us+ING.
// `untruness` is UN+tru+NESS. `manchoship` is mancho+SHIP. `headser` is the
// whole word HEAD with a syllable stuck to it.
//
// A previous pass diagnosed the cause and half-fixed it: affixes were barred in
// FIRST position only, so they leaked into the middle and the end -- which is
// where all four of those examples live.
//
// Note that harvesting syllables position-correctly (below) does NOT fix this
// by itself; it makes it worse. -tion, -ness, -ing and -ed are the single most
// common way real English words END, so they utterly dominate a position-
// correct final pool. Measured on the default recipe, the five commonest final
// syllables are `ly tor cal ne le` with `tion` sixth. Position and morphology
// are two separate fixes and both are needed.

// Pure affixes: barred in EVERY position. These are grammar, not sound -- there
// is no word where `tion` is the interesting part.
const BARRED_ANY = new Set([
  'tion', 'tions', 'sion', 'sions', 'tio', 'ation', 'ations', 'ition',
  'ness', 'nesses', 'ment', 'ments', 'ance', 'ence', 'ances', 'ences',
  'ing', 'ings', 'ous', 'ious', 'eous', 'est', 'ed', 'es', 'ies', 'ly',
  'ship', 'ships', 'hood', 'ward', 'wards', 'ful', 'less', 'able', 'ible',
  'ism', 'isms', 'ist', 'ists', 'ity', 'ities', 'ative', 'ical', 'edly', 'ingly',
  'ish', 'er', 'ers', 'ion', 'ions', 'ial', 'ual', 'ize', 'ise', 'ery', 'ary',
])

// The END of a name is where English morphology is loudest, so the ending gets
// a stricter, pattern-based bar rather than an exact list: anything FINISHING
// in an inflection reads as a conjugated verb rather than a name. That is what
// separates `denging`, `shipting`, `losed`, `bilted`, `rarousply` from
// `quarbet`, and an exact list cannot do it -- the syllable splitter cuts
// `denging` as den|ging, so there is no `ing` piece to match.
//
// The `y` at the end of the alternation is doing more work than it looks: -cy,
// -ty, -ry, -ey, -ny turn any invented stem into an English diminutive
// (`gerty`, `ruscy`, `falocy`, `graky`, `hamery`, `biaty`). Neither of his
// keepers ends in one, and dropping the whole class cost nothing.
//
// `eth` used to be in this list and is deliberately no longer: it is one of the
// grafted name endings below (`-eth`), and barring it by pattern would delete
// `mareth` along with `wandereth`. The archaic-verb case is caught precisely
// instead -- `eth` is in INFLECTIONS, so a name is only rejected when the stem
// under it is a real word (`dareth` -> `dare`).
const BARRED_FINAL_RE =
  /(?:tion|sion|[cstx]ion|ness|ment|ance|ence|ship|hood|ward|ful|less|able|ible|ing|ism|ist|ity|ous|est|edly|ed|ies|ish|ers?|ial|ual|ize|ise|y)$/

// Productive English PREFIXES: barred in first position. `un`, `re`, `dis` and
// `in` are among the commonest word-initial syllables in the corpus, so an
// unfiltered position-correct initial pool opens name after name with them
// (`untruness`, `unbompseu`, `unnistwor`, `inkabol`). Latinate `pro`, `de`,
// `con`, `com` are deliberately NOT barred -- they read as sound, not grammar,
// and they gave `proerius`.
const BARRED_INITIAL = new Set([
  'un', 'uns', 'ung', 're', 'dis', 'mis', 'non', 'pre', 'over', 'under',
  'out', 'fore', 'anti', 'semi', 'sub', 'ex', 'in', 'im', 'up', 'be', 'as',
])

const allowedAt = (syl, pos) => {
  if (BARRED_ANY.has(syl)) return false
  if (pos === 'initial') return !BARRED_INITIAL.has(syl)
  if (pos === 'final') return !BARRED_FINAL_RE.test(syl)
  return true
}

// "Common English", reused from the rarity machinery: df[i] is how many of the
// 63 classics word i appears in. A word in a dozen unrelated classics is
// ordinary English, and a name that contains one whole -- `mationcity` is
// `city`, `headser` is `head`, `dosmomalboys` is `boys` -- is not an invented
// name, it is a real word wearing a hat. Memoised on the corpus: it depends on
// nothing else, and rebuilding it per roll would be the only slow thing here.
export const commonWordSet = (corpus, minDf = 6) => {
  corpus._common = corpus._common || new Map()
  const hit = corpus._common.get(minDf)
  if (hit) return hit
  const { words, df } = corpus
  const set = new Set()
  for (let i = 0; i < words.length; i++) if (df[i] >= minDf && words[i].length >= 3) set.add(words[i])
  corpus._common.set(minDf, set)
  return set
}

// ---------------------------------------------------------------- legibility
//
// The previous pass was about names not being GARBAGE. This one is about the
// survivors being READABLE -- said correctly, at a glance, first try.
//
// Read a batch and the split is obvious. `galce`, `algel`, `coelim` alternate
// consonant and vowel and you say them without thinking. `posculdex`,
// `harcocaph`, `ezirimlis`, `boussoniac`, `kabdomarah` do not, and you stop and
// re-parse. Every one of those stumbles is a consonant pile-up that English
// would never spell in that place.
//
// So the rule is not invented, it is BORROWED: harvest the consonant clusters
// real English words actually use, separately for word-start, word-middle and
// word-end, and let a name use a cluster only where English uses it. `tr-` and
// `st-` open words; `-nd` and `-ght` close them; `scd`, `phc` and `zrm` do
// neither, anywhere.

// Sonority, low to high: stops < fricatives < nasals < liquids < glides. Used
// for the Syllable Contact Law -- across a syllable seam, sonority must FALL or
// hold. `ter|skiel` is fine (r is more sonorous than s); `ezi|rim|lis` is not
// (m is LESS sonorous than the l after it, so the seam has nowhere to sit and
// the reader stalls). This one principle separates every hard name in the batch
// from every easy one, and it is why `tl`, `ml`, `nr`, `sr`, `tn`, `pm` and
// `dl` are gone while `rn`, `rb`, `lc`, `st` and `nd` stay.
const SONORITY = {
  w: 5, y: 5,
  l: 4, r: 4,
  m: 3, n: 3,
  f: 2, v: 2, s: 2, z: 2, h: 2,
  p: 1, b: 1, t: 1, d: 1, k: 1, g: 1, c: 1, q: 1, j: 1, x: 1,
}
// Two letters, one sound. Splitting `th` or `ck` into two consonants would
// price `thalis` and `parvack` as clusters they are not.
const DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'ng', 'qu', 'kn', 'wr', 'rh'])
const sonorityOf = (u) => (u === 'ng' ? 3 : u === 'th' || u === 'sh' || u === 'ph' || u === 'wh' || u === 'gh' ? 2 : SONORITY[u[u.length - 1]] ?? 1)

// A consonant run as SOUNDS rather than letters: `th` is one, `ck` is one, and
// a doubled letter (`ss`, `rr`, `tt`) is one.
export const consonantUnits = (run) => {
  const units = []
  for (let i = 0; i < run.length; i++) {
    const two = run.slice(i, i + 2)
    if (DIGRAPHS.has(two)) { units.push(two); i++; continue }
    if (run[i] === run[i + 1]) { units.push(run[i]); i++; continue }
    units.push(run[i])
  }
  return units
}

// English vowel digraphs. Position-independent on purpose: `ai` is common in
// the middle (rain) and rare at the end, but `narai` is one of his keepers, so
// the end is not a place to get clever. Anything NOT on this list (`iae`,
// `eea`, `uou`) is a genuine stumble and is rejected.
const VOWEL_PAIRS = new Set([
  'ai', 'au', 'aw', 'ay', 'ea', 'ee', 'ei', 'eo', 'eu', 'ew', 'ey',
  'ia', 'ie', 'io', 'iu', 'oa', 'oe', 'oi', 'oo', 'ou', 'ow', 'oy',
  'ua', 'ue', 'ui', 'uo', 'ya', 'ye', 'yo', 'ae',
])

// The harvested inventory. One pass over the vocabulary, keeping only words
// solid enough to be evidence about English (in >= minDf of the 63 classics),
// counting every consonant run by the position it appeared in. Memoised on the
// corpus -- it depends on nothing else and the browser builds it once.
//
// The frequency floors are what make this a filter rather than a rubber stamp,
// and they are set by where his OWN good names fall. Sonority contact (above)
// already removes every rising seam, so the floor only has to catch the flat
// ones -- stop against stop, nasal against nasal -- where English has a handful
// of Latin borrowings and nothing else. Medially the corpus attests `bd` in 12
// words, `db` in 3, `gd` in 2 and `kt` in none, against `lc` in 35 and `lg` in
// 25. A floor of 20 keeps `galce` and `algel`, which he picked out of the batch
// himself, and drops `kabdomarah`. Set it at 25 and his two names die with it.
export const clusterInventory = (corpus, opts = {}) => {
  // minInitial is 15 rather than 10 for one specific reason: `gn-` and `ps-`
  // are silent-letter relics (gnaw, psalm) attested 11 and 9 times. Left in the
  // opening inventory they also license `-gn-` and `-ps-` in the MIDDLE, where
  // the g is not silent and the seam rises -- which is `haugnis` and
  // `artognimun` waved straight through. 15 drops the relics and keeps `dw-`
  // (17), `spl-` (19), `chr-` (20) and `rh-` (22).
  const { minDf = 3, minInitial = 15, minMedial = 20, minFinal = 12 } = opts
  const key = `${minDf}:${minInitial}:${minMedial}:${minFinal}`
  corpus._clusters = corpus._clusters || new Map()
  const hit = corpus._clusters.get(key)
  if (hit) return hit

  const { words, df } = corpus
  const init = new Map()
  const med = new Map()
  const fin = new Map()
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
  const run = /[^aeiouy]+/g
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (df[i] < minDf || w.length < 3) continue
    if (!/^[a-z]+$/.test(w)) continue
    run.lastIndex = 0
    let m
    while ((m = run.exec(w))) {
      if (m[0].length < 2) continue
      if (m.index === 0) bump(init, m[0])
      else if (m.index + m[0].length === w.length) bump(fin, m[0])
      else bump(med, m[0])
    }
  }
  const keep = (m, min) => new Set([...m].filter(([, c]) => c >= min).map(([r]) => r))
  const inv = { initial: keep(init, minInitial), medial: keep(med, minMedial), final: keep(fin, minFinal) }
  corpus._clusters.set(key, inv)
  return inv
}

// Is `run` something a word can START with? Single consonants always are.
const legalOnset = (inv, run) => run.length < 2 || inv.initial.has(run)
// …and END with?
const legalCoda = (inv, run) => run.length < 2 || inv.final.has(run)

// Why a word is hard to read, or null if it is not. Exported so the regression
// suite can assert on a specific string instead of generating batches and
// hoping the bad shape comes up.
export const legibilityReason = (corpus, w, opts = {}) => {
  const { maxUnits = 2, alternation = 5 } = opts
  const inv = clusterInventory(corpus, opts)

  let clusters = 0
  const runs = /([^aeiouy]+)|([aeiouy]+)/g
  let m
  while ((m = runs.exec(w))) {
    const seg = m[0]
    const atStart = m.index === 0
    const atEnd = m.index + seg.length === w.length

    if (m[2]) {
      // Vowel pile-up. Three vowels in a row has no English spelling and no
      // agreed pronunciation -- `trisiae`, `latiraichi`, `eitoheetz`.
      if (seg.length > 2) return `vowel pile-up "${seg}"`
      if (seg.length === 2 && !VOWEL_PAIRS.has(seg)) return `vowel pair "${seg}" is not English`
      continue
    }

    const units = consonantUnits(seg)
    if (units.length >= 2) clusters++
    if (seg.length > 4) return `consonant pile-up "${seg}"`

    if (atStart && atEnd) return 'no vowel'
    if (atStart) {
      // Openings are capped at two sounds, with one documented exception: the
      // s+stop+liquid onsets (str-, spr-, scr-, spl-) that English really does
      // use. The inventory decides -- if it is not attested word-initially it
      // is not an opening, however pronounceable the letters look apart.
      if (seg.length >= 2 && !inv.initial.has(seg)) return `"${seg}-" does not open English words`
      if (units.length > (inv.initial.has(seg) ? 3 : maxUnits)) return `"${seg}-" is ${units.length} sounds`
      continue
    }
    if (atEnd) {
      if (seg.length >= 2 && !inv.final.has(seg)) return `"-${seg}" does not end English words`
      if (units.length > maxUnits) return `"-${seg}" is ${units.length} sounds`
      continue
    }

    // Interior run: English syllabifies it, so what has to be legal is the two
    // halves, not the trigram. Take the longest legal onset off the back and
    // whatever is left is the coda.
    let cut = seg.length
    for (let k = Math.max(0, seg.length - 3); k < seg.length; k++) {
      if (legalOnset(inv, seg.slice(k))) { cut = k; break }
    }
    const coda = seg.slice(0, cut)
    const onset = seg.slice(cut)
    if (!onset) return `"${seg}" cannot start a syllable`
    if (!legalCoda(inv, coda)) return `"${coda}" does not end a syllable`
    if (consonantUnits(coda).length > maxUnits || consonantUnits(onset).length > maxUnits)
      return `"${seg}" is more than ${maxUnits} sounds in one position`
    // Two-letter interior runs are the common case and get the frequency floor
    // directly: this is where `ml`, `bd`, `tn`, `sr` and `pm` die.
    if (seg.length === 2 && !inv.medial.has(seg)) return `"${seg}" is not an English interior cluster`
    if (coda) {
      const a = consonantUnits(coda)
      const b = consonantUnits(onset)
      if (sonorityOf(a[a.length - 1]) < sonorityOf(b[0])) return `"${coda}|${onset}" rises across the seam`
    }
  }

  // …and the shape as a whole. Every cluster is a place the consonant/vowel
  // alternation breaks, so a name gets a budget of one per five letters:
  // `galce` and `quarbet` spend their one, `tornoromic` spends one of two.
  // `posculdex` (sc + ld in nine letters) and `printizeb` (pr + nt) want three
  // letters they have not got, which is exactly why they read as a mouthful.
  if (clusters * alternation > w.length) return `${clusters} clusters in ${w.length} letters`
  return null
}

// ---------------------------------------------------------------- syllable pools

// The flat pool keeps duplicates, exactly like the original's
// words.map(getSyllables).flat() -- a syllable used by many distinct words is
// proportionally more likely to be drawn. Its length is also what the UI
// reports, so it stays UNFILTERED and byte-identical to before.
//
// Attached to it are three position-correct pools. `-tion` never begins a real
// word and `un-` almost never ends one, so a syllable is only offered for the
// slot it was actually observed in. This is what stops names reading as a word
// that lost its front half. They are filtered (see morphology above) and
// carried as properties on the array so that every existing caller --
// app.js does `generateNames(corpus, syllablePool(...), ...)` -- keeps working
// untouched.
export const syllablePool = (corpus, selection, opts = {}) => {
  // maxSyl: he capped syllables at length < 4 in his own second experiment.
  // Long syllables are what turn glued names into consonant sludge.
  const { maxSyl = 4 } = opts
  const pool = []
  const initial = []
  const medial = []
  const final = []
  const { words } = corpus
  for (let i = 0; i < words.length; i++) {
    if ((selection[i >>> 5] & (1 << (i & 31))) === 0) continue
    const syls = getSyllables(words[i])
    if (!syls) continue
    const t = []
    for (const s of syls) {
      if (s.length > maxSyl) continue
      const l = s.toLowerCase()
      pool.push(l)
      t.push(l)
    }
    // Only harvest positions from words whose syllables ALL survived the length
    // cap -- otherwise dropping a long middle syllable silently promotes the
    // one after it to "final" and the position label becomes a lie.
    if (!t.length || t.length !== syls.length) continue
    if (t.length === 1) {
      // A monosyllable is both an opening and an ending, and never a middle.
      if (allowedAt(t[0], 'initial')) initial.push(t[0])
      if (allowedAt(t[0], 'final')) final.push(t[0])
      continue
    }
    if (allowedAt(t[0], 'initial')) initial.push(t[0])
    if (allowedAt(t[t.length - 1], 'final')) final.push(t[t.length - 1])
    for (let k = 1; k < t.length - 1; k++) if (allowedAt(t[k], 'medial')) medial.push(t[k])
  }
  pool.initial = initial
  pool.medial = medial
  pool.final = final
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

// Inflections to strip before asking "is the stem a real word?". `losed` is not
// in the vocabulary, but `lose` is, and nobody reads `losed` as a name -- they
// read it as a typo. Same for `ductes` (duct) and `fieltusing` (…using).
//
// `eth` is here rather than in BARRED_FINAL_RE so that the graft `-eth` stays
// available: `mareth` keeps its ending, `dareth` loses it because `dare` is
// underneath.
const INFLECTIONS = ['ing', 'ings', 'ed', 'es', 's', 'ly', 'er', 'ers', 'est', 'd', 'ies', 'eth']

// A trailing s reads as a plural -- `rokets`, `oshes`, `epasels`, `wilbins` are
// all "some number of fake nouns". The exception is the Latin/Greek ending,
// which reads as singular and is where this corpus is at its best: `orros`,
// `censitus`, `aksis`, `malonos`. So: a final s is allowed only after a vowel,
// and not after `e` (that IS the English plural).
const PLURAL_RE = /(?:[^aiouy]s|es)$/

// Everything that can disqualify an assembly, in one place and exported, so the
// regression list can be asserted directly rather than by generating batches
// and hoping the bad name comes up. Returns a reason string, or null to keep.
//
// It takes PARTS, not a string: "is `city` glued on the end" is a question
// about the seams, and a finished name has thrown them away.
export const makeNameFilter = (corpus, opts = {}) => {
  const {
    minLength = 5,
    // 10, down from 12. `tornoromic` is exactly 10 and `quarbet` is 7 -- the
    // whole accepted range is short. Above 10 the extra room is spent almost
    // entirely on sludge (`dosmomalboys`, `nootailaguil`, `shaldoubsall`).
    maxLength = 10,
    rejectRealWords = true,
    minDf = 6,
    // A three-letter syllable that happens to be a word is only fatal if the
    // word is unmissable. `quarbet` -- one of his two accepted names -- is
    // quar+BET, and `bet` is in 19 of the 63 classics. `man` is in all 63.
    // Drawing the line between them is the difference between fixing the
    // generator and neutering it.
    obviousDf = 20,
    rejectPlural = true,
  } = opts
  const isPronounceable = makePronounceable(corpus.triBits)
  const common = rejectRealWords ? commonWordSet(corpus, minDf) : new Set()
  const obvious = rejectRealWords ? commonWordSet(corpus, obviousDf) : new Set()

  // Does any run of whole syllables spell an ordinary English word? Checking
  // syllable-ALIGNED runs, not arbitrary substrings, is the point: `terskiel`
  // contains "ski" but never as a piece, so it survives; `mationcity` hands you
  // "city" as a piece, so it does not.
  //
  // The tiers matter. A word spelled by TWO syllables was assembled by us and
  // is always a tell (`ci`+`ty`). A single syllable that is a word is only a
  // tell if it is long (`head`, `boys`, `field`) or very common (`man`, `cat`,
  // `ice`) -- otherwise the filter eats `quarbet`.
  const englishSegment = (parts) => {
    for (let i = 0; i < parts.length; i++) {
      let run = ''
      for (let j = i; j < parts.length; j++) {
        run += parts[j]
        if (run.length < 3) continue
        const solo = i === j
        if (!solo && common.has(run)) return run
        if (solo && run.length >= 4 && common.has(run)) return run
        if (solo && run.length === 3 && obvious.has(run)) return run
      }
    }
    return null
  }

  // …and is the name itself just a real word with a tense on it?
  const inflectedWord = (w) => {
    for (const suf of INFLECTIONS) {
      if (!w.endsWith(suf) || w.length - suf.length < 3) continue
      const stem = w.slice(0, -suf.length)
      if (common.has(stem) || corpus.wordSet.has(stem)) return stem
      if (suf !== 's' && suf !== 'd' && common.has(stem + 'e')) return stem + 'e'
    }
    return null
  }

  return (parts) => {
    if (!parts || !parts.length || parts.some((p) => !p)) return 'empty'
    const w = parts.join('')
    if (w.length < minLength) return 'too short'
    if (w.length > maxLength) return 'too long'
    // "gingin", "flatrivivi" -- a stutter reads as a mistake, not a name.
    if (parts.some((p, i) => i && p === parts[i - 1])) return `stutter (${parts[0]})`
    if (!allowedAt(parts[0], 'initial')) return `English prefix "${parts[0]}-"`
    // Tested against the WHOLE name, not the last syllable. The syllable
    // splitter cuts `manchoship` as man|chos|hip, which hides the -ship
    // completely; the reader sees the letters, not the seams.
    const m = w.match(BARRED_FINAL_RE)
    if (m) return `English suffix "-${m[0]}"`
    const bad = parts.find((p) => BARRED_ANY.has(p))
    if (bad) return `English affix "${bad}" in the middle`
    if (rejectPlural && PLURAL_RE.test(w)) return 'reads as a plural'
    if (!isPronounceable(w)) return 'unpronounceable'
    if (opts.legible !== false) {
      const hard = legibilityReason(corpus, w, opts)
      if (hard) return `hard to read: ${hard}`
    }
    if (rejectRealWords) {
      if (corpus.wordSet.has(w)) return 'is a real word'
      const seg = englishSegment(parts)
      if (seg) return `contains the English word "${seg}"`
      const stem = inflectedWord(w)
      if (stem) return `is "${stem}" with an inflection`
    }
    return null
  }
}

// One-shot convenience for tests and for anyone asking "why was this dropped?".
export const rejectReason = (corpus, parts, opts = {}) =>
  makeNameFilter(corpus, opts)(Array.isArray(parts) ? parts : getSyllables(parts).map((s) => s.toLowerCase()))

// ---------------------------------------------------------------- grafts
//
// The one thing in this file that does not come out of the prose, and the one
// he explicitly unlocked: "it doesn't have to strictly come from the corpus".
//
// A corpus of English will not hand you a NAME ending, because English words do
// not end the way names do. When the generator lands on one by accident --
// `tarelsior`, `mithronian`, `gloleriel` -- the name suddenly reads as a person
// rather than a misspelling. So a proportion of names get the ending grafted on
// deliberately, onto a stem harvested the normal way.
//
// Every graft starts with a vowel and is only ever attached to a stem that ends
// in a consonant, so the seam alternates by construction -- the graft cannot
// manufacture the cluster the rules above just spent their time removing.
export const GRAFTS = ['a', 'us', 'is', 'on', 'ar', 'or', 'el', 'ia', 'ara', 'iel', 'eth', 'ith']

export const generateNames = (corpus, pool, opts = {}) => {
  const { count = 24, seed = 1 } = opts
  if (pool.length < 8) return []

  const rand = rng(seed)
  const randomInRange = (min, max) => Math.floor(rand() * (max - min + 1) + min)
  const pick = (arr) => arr[randomInRange(0, arr.length - 1)]
  const reject = makeNameFilter(corpus, opts)

  // Position-correct pools, with a fallback. A single small author (Winnie-the-
  // Pooh at rarity 3 has 32 distinct medial syllables) can thin a slot below
  // the point where it produces variety rather than the same four names, so a
  // slot that runs short borrows from the flat pool. Better a slightly English
  // name than an empty screen -- and the filters below still apply either way.
  const MIN_SLOT = 24
  const big = (a) => a && a.length >= MIN_SLOT
  const flat = pool
  const initial = big(pool.initial) ? pool.initial : flat
  const medial = big(pool.medial) ? pool.medial : big(pool.initial) ? pool.initial : flat
  const final = big(pool.final) ? pool.final : flat

  // He drew a uniform 2-4 syllables; both of his keepers came from that range
  // (quarbet = 2, tornoromic = 4). Weighted to 3 after reading batches side by
  // side: 3 syllables is where the good names live almost exclusively.
  //
  // The weights are not the distribution you get. The length cap rejects long
  // draws afterwards, and it bites hardest on 4 -- weighting 2 and 4 equally
  // with 3 produced batches that came out two-thirds DISYLLABIC and bland
  // (`earaz, mirus, sogyn, vessom, vardo`). Over-weighting 3 and keeping 4 in
  // the draw is what makes the surviving mix land near 4:21:5.
  const shape = opts.shape ?? [2, 3, 3, 4]

  const out = []
  const seen = new Set()
  const maxAttempts = count * 900

  // One name in three takes a grafted ending.
  //
  // The proportion is the whole risk. Graft everything and the page turns into
  // generic fantasy -- twenty-four names that all end -a/-us/-iel read as one
  // name repeated. Graft none and the good endings only happen by luck. A third,
  // spread over twelve endings, puts about eight grafted names in a 24-name
  // batch across six or seven different endings, so no ending shows up twice on
  // a screen and the other sixteen names still come entirely out of the prose.
  // Read side by side, this is the point where the batch gained a register
  // without gaining a house style.
  const graftRate = opts.graftRate ?? 1 / 3

  for (let a = 0; a < maxAttempts && out.length < count; a++) {
    const n = shape[randomInRange(0, shape.length - 1)]
    const parts = [pick(initial)]
    for (let i = 1; i < n - 1; i++) parts.push(pick(medial))
    if (rand() < graftRate) {
      // The graft needs a consonant to land on; a stem ending in a vowel would
      // make `tara`+`a`. Cheaper to redraw than to patch the seam.
      if (/[aeiouy]$/.test(parts.join(''))) continue
      parts.push(pick(GRAFTS))
    } else parts.push(pick(final))
    // The pools are pre-filtered by position, but reject() re-checks: a caller
    // may hand us a plain array (tune.mjs, or anything built before positional
    // pools existed) and the fallback above can borrow from the flat pool.
    if (reject(parts)) continue
    const w = parts.join('')
    if (seen.has(w)) continue
    seen.add(w)
    out.push({ name: w, parts })
  }
  return out
}
