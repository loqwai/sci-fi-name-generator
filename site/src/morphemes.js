// ---------------------------------------------------------------- morphemes
//
// Names are built by gluing WHOLE MORPHEMES together, and every morpheme is
// mined out of the books the user picked. There is no hand-written word list
// in this file, on purpose -- see "no curation" below.
//
// THE DIAGNOSIS. The old pipeline harvested SYLLABLES and glued them. A
// syllable carries no meaning by construction, so the output was
// phonotactically valid and semantically empty: `quarbet` and `thalis` can be
// said, and decode to nothing. The one name out of this project anybody kept
// is `hypnodroid`, and what makes it work is not that it is sayable -- it is
// that it DECODES. Two morphemes a reader already owns, joined at a seam you
// can hear.
//
//   legibility = recognition, not pronounceability
//
// THE OTHER HALF OF THE DIAGNOSIS, and the bigger one. `DEFAULT_RECIPE` ships
// `rarity: 1`, and rarity means "drop words appearing in >= N of the 58
// sources". At 1 that discards every word that appears in any other book in
// the library -- so the generator was fed *only* vocabulary that exists
// nowhere else. For lovecraft u kabbalah that is proper nouns and
// transliterations: `blackly, alchemical, decasyllabic, hearst, misnomer,
// sherman, abahu, auswahl, cormoly, gaffarelli, josep, sidonius`. The pipeline
// was mining the least recognisable words in the entire library, by design,
// before syllabification even got a turn. Mining now reads the set BEFORE the
// rarity cut, which is why `harvestStems` takes `stages.afterExclude`.
//
// NO CURATION. An earlier draft of this file had hand-written HEADS and TAILS
// (`hypno-`, `cryo-`, `-droid`, `-spire`). They are gone at the owner's
// explicit instruction: stems must be drawn from the corpora. That is also the
// stronger engineering position -- a hand list cannot respond to which books
// he picked, so the book pickers would have become decoration. Every rule
// below is therefore evidence: document frequency, length, and observed
// position. If you find yourself typing a list of good words, you have
// recreated curation under another name.

// The three things that leak in when you mine a scanned-book corpus and which
// are not words: roman numerals, digits, and the debris left when apostrophes
// are stripped (`doesn't` -> `doesn`). All three were really produced --
// `peacexxiii`, `cottonfifty`, `londonaught`.
const ROMAN_RE = /^[ivxlcdm]+$/
const DIGIT_RE = /[^a-z]/
const CONTRACTION_RE =
  /^(?:do|did|does|would|could|should|is|was|were|are|has|have|had|must|need|might|ca|wo|ai|sha|us)n$/
const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'dozen',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'ninth', 'tenth',
  'aught', 'naught', 'zero',
])

// Function words. This is the one list here that is not evidence, and it is
// deliberately only closed-class grammar -- pronouns, auxiliaries,
// prepositions, determiners. It contains no content words, so it cannot be
// used to smuggle taste back in: nothing in it could ever have been a good
// stem. Everything that decides which CONTENT words are good is measured.
const FUNCTION_WORDS = new Set([
  'the', 'and', 'that', 'with', 'this', 'from', 'they', 'have', 'them', 'were',
  'been', 'their', 'what', 'when', 'which', 'there', 'would', 'could', 'should',
  'shall', 'will', 'your', 'you', 'his', 'her', 'him', 'she', 'not', 'but',
  'for', 'are', 'was', 'had', 'has', 'who', 'all', 'any', 'out', 'now', 'how',
  'why', 'its', 'our', 'own', 'may', 'can', 'did', 'yet', 'too', 'said', 'upon',
  'very', 'more', 'some', 'such', 'than', 'then', 'thou', 'thee', 'thy', 'unto',
  'into', 'only', 'about', 'after', 'again', 'before', 'being', 'does', 'each',
  'every', 'here', 'itself', 'like', 'made', 'make', 'much', 'must', 'never',
  'once', 'other', 'over', 'said', 'same', 'these', 'those', 'though', 'through',
  'under', 'until', 'where', 'while', 'whom', 'whose', 'without', 'both', 'down',
])

// Inflected forms are not stems: `hunters` is `hunter` wearing a plural.
const INFLECTED_RE = /(?:ing|ings|ed|es|ly|ers?|est|ies|eth|s)$/

// English's derivational endings. Mined by position, these DOMINATE the tail
// evidence -- the top of the raw list is `est:121, less:115, able:64,
// fully:49, led:49` -- and every one of them makes a name that reads as a word
// that lost its front half rather than as a compound. Barred from the tail
// slot only; `-land` and `-light` and `-work` survive because they are nouns.
const BARRED_FINAL_RE =
  /(?:tion|sion|ness|ment|ance|ence|ship|hood|ward|ful|less|able|ible|ing|ism|ist|ity|ous|est|edly|ed|ies|ish|ers?|ial|ual|ize|ise|age|ant|ate|ally|led|les|der|per|ties|most|y)$/

// English's productive prefixes, barred from the head slot for the same
// reason: `over`, `out`, `pre`, `mis`, `fore`, `under`, `sub` are the top of
// the raw head evidence and none of them is a noun.
const BARRED_INITIAL = new Set([
  'over', 'out', 'pre', 'mis', 'fore', 'pro', 'for', 'under', 'per', 'des',
  'sup', 'imp', 'sub', 'par', 'mar', 'dis', 'non', 'anti', 'semi', 'super',
  'inter', 'trans', 'counter', 'with', 'some', 'con', 'com', 'ex', 're', 'un',
  'in', 'im', 'en', 'em', 'ab', 'ad', 'be', 'de',
])

const VOWEL_RE = /[aeiouy]/
const codaOf = (s) => s.match(/[^aeiouy]*$/)[0]
const onsetOf = (s) => s.match(/^[^aeiouy]*/)[0]

// ---------------------------------------------------------------- the seam
//
// engine.js spends most of its length on consonant clusters, and it is right
// to: an INVENTED word gives the reader nothing to segment by, so the only cue
// left is phonotactics and a seam like `ezi|rim|lis` strands them.
//
// A COMPOUND is not in that situation. `ironsmith` puts `ns` at the seam and
// `driftwake` puts `ftw`, and English would never spell either inside a single
// morpheme -- yet both read instantly, because the reader is not sounding the
// word out, they are recognising two words they already know. `blackbird` has
// `kb` in it and nobody notices.
//
// So the cluster budget that engine.js applies to invented names is
// deliberately NOT applied to assembled compounds. It is applied to the STEMS
// instead, at mining time, where the input really is untrusted. What is left
// here is only what genuinely stalls a reader across a seam.
//
// An interfix (the linking `-o-` of `speedometer`) is NOT implemented: these
// corpora are English compounds, which butt their elements together directly,
// and the data does not support inserting one.
export const seamReason = (a, b) => {
  const coda = codaOf(a)
  const onset = onsetOf(b)
  if (!coda && !onset) return `${a}|${b} runs two vowels together`
  if (!coda || !onset) return null
  if (coda[coda.length - 1] === onset[0]) return `${a}|${b} doubles ${onset[0]} at the seam`
  // `salt|sphere` (lt+sph) and `frost|thorn` (st+th) are four consonant letters
  // deep and DO stall, compound or not. Three is `ironsmith` and `driftwake`,
  // which do not.
  if (coda.length + onset.length > 3)
    return `${a}|${b} piles ${coda.length + onset.length} consonants at the seam`
  return null
}

// ---------------------------------------------------------------- mining
//
// Two passes over the vocabulary.
//
// PASS 1 -- which words does a reader own? A document-frequency WINDOW, and
// the upper bound is the interesting half:
//
//   df >= minDf   the reader must already know the word, or we are back to
//                 inventing vocabulary. A word in a dozen unrelated classics
//                 is ordinary English.
//   df <= maxDf   a word in nearly all 58 sources is a function word or a
//                 colourless one -- `time`, `place`, `thing`. Those make
//                 `timekin` and `placefall`, bland in a way that is worse than
//                 weird. Capping df is a measured proxy for "concrete" that
//                 costs no lexicon.
//
// PASS 2 -- which POSITION does each word take? Learned from the corpus's own
// compounds. For every vocabulary word, try splitting it into two known words:
// `moonlight` -> `moon` + `light`, `seaside` -> `sea` + `side`. Every split
// found is one vote that the first part works as a head and the second as a
// tail. This is where `hypno-`-shaped behaviour comes from without anybody
// typing `hypno`: English tells you `sun`, `foot`, `hand`, `sea`, `fire` lead
// and `man`, `land`, `light`, `side`, `house`, `work`, `board` follow.
//
// It is also the only cheap lever on the real open problem, which is that
// ADJACENCY IS NOT MODIFICATION. `hypnodroid` reads because the head modifies
// the tail; two nouns shoved together give `judgesowners` and `wivesliquor`,
// legible but not name-like. A stem with compound evidence behind it is one
// English has actually used in that slot, so preferring evidenced stems buys
// real modification structure rather than guessing at it.
export const MINE_DEFAULTS = {
  minDf: 10,
  maxDf: 52,
  minLength: 3,
  maxLength: 7,
  knownMinDf: 12,
  knownMaxLength: 8,
}

const usableWord = (w) =>
  !DIGIT_RE.test(w) &&
  !ROMAN_RE.test(w) &&
  !NUMBER_WORDS.has(w) &&
  !FUNCTION_WORDS.has(w) &&
  !CONTRACTION_RE.test(w) &&
  !INFLECTED_RE.test(w) &&
  VOWEL_RE.test(w)

// The compound evidence depends only on the vocabulary, never on the recipe,
// so it is built once and memoised on the corpus. Rebuilding it per roll would
// be the only slow thing in the engine.
export const compoundEvidence = (corpus, opts = {}) => {
  const { knownMinDf, knownMaxLength } = { ...MINE_DEFAULTS, ...opts }
  if (corpus._compound) return corpus._compound
  const { words, df } = corpus
  const known = new Set()
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w.length < 3 || w.length > knownMaxLength) continue
    if (df[i] < knownMinDf) continue
    if (DIGIT_RE.test(w)) continue
    known.add(w)
  }
  const head = new Map()
  const tail = new Map()
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w.length < 6 || DIGIT_RE.test(w)) continue
    for (let k = 3; k <= w.length - 3; k++) {
      const a = w.slice(0, k)
      const b = w.slice(k)
      if (known.has(a) && known.has(b)) {
        head.set(a, (head.get(a) ?? 0) + 1)
        tail.set(b, (tail.get(b) ?? 0) + 1)
        break
      }
    }
  }
  corpus._compound = { head, tail, known }
  return corpus._compound
}

// Mine the stems available for one selection. `selection` is a bitset -- pass
// `stages.afterExclude`, NOT `stages.final`, for the reason at the top of this
// file. `vet` is an optional predicate (engine.js passes `legibilityReason`)
// so an unreadable fragment cannot enter the inventory.
export const mineStems = (corpus, selection, opts = {}) => {
  const o = { ...MINE_DEFAULTS, ...opts }
  const { words, df } = corpus
  const ev = compoundEvidence(corpus, o)
  const heads = []
  const tails = []
  for (let i = 0; i < words.length; i++) {
    if (selection && (selection[i >>> 5] & (1 << (i & 31))) === 0) continue
    const w = words[i]
    if (w.length < o.minLength || w.length > o.maxLength) continue
    if (df[i] < o.minDf || df[i] > o.maxDf) continue
    if (!usableWord(w)) continue
    if (o.vet && o.vet(w)) continue
    const headScore = ev.head.get(w) ?? 0
    const tailScore = ev.tail.get(w) ?? 0
    if (!BARRED_INITIAL.has(w)) heads.push({ form: w, score: headScore })
    if (!BARRED_FINAL_RE.test(w)) tails.push({ form: w, score: tailScore })
  }
  return { heads, tails }
}

// ---------------------------------------------------------------- filtering

export const makeNameFilter = (corpus, opts = {}) => {
  const { minLength = 6, maxLength = 14 } = opts
  return (parts) => {
    for (let i = 1; i < parts.length; i++) {
      const why = seamReason(parts[i - 1], parts[i])
      if (why) return why
    }
    // A stem may not repeat, and may not sit inside its neighbour: `gulfgulf`,
    // and `light|lighthouse`-shaped overlaps that read as a stutter.
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i] === parts[j]) return `${parts[i]} twice`
        if (parts[i].includes(parts[j]) || parts[j].includes(parts[i]))
          return `${parts[i]}/${parts[j]} overlap`
      }
    const w = parts.join('')
    if (w.length < minLength) return `${w} is under ${minLength} letters`
    if (w.length > maxLength) return `${w} is over ${maxLength} letters`
    // Already a word: `moonlight`, `seaside`, `firelight`. The corpus is the
    // authority here, which is the whole reason this check costs nothing.
    if (corpus && corpus.wordSet && corpus.wordSet.has(w)) return `${w} is already a word`
    return null
  }
}

// ---------------------------------------------------------------- generation
//
// `rand` is injected (engine.js supplies `rng(seed)`), so a batch is
// reproducible from (recipe, seed) exactly the way the old generator was.
//
// `parts` is the morpheme count, user-facing, default 2. 1 is just a corpus
// word, so it is not offered; 3 is offered and gets long, which is visible in
// the sample output rather than argued about.
//
// `evidenceRate` is the lever on modification: that share of draws is taken
// from stems English has actually used in that position (`sun-`, `-light`),
// the rest from the whole mined pool so the space stays large.
export const composeBatch = (opts = {}) => {
  const {
    count = 24,
    parts = 2,
    rand = Math.random,
    corpus = null,
    heads = [],
    tails = [],
    maxHeadUses = 1,
    maxTailUses = 2,
    evidenceRate = 0.6,
  } = opts
  const reject = opts.reject ?? makeNameFilter(corpus, opts)
  const evHeads = heads.filter((h) => h.score > 0)
  const evTails = tails.filter((t) => t.score > 0)
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const pickFrom = (all, ev) => (ev.length && rand() < evidenceRate ? pick(ev) : pick(all))

  const out = []
  const seen = new Set()
  const headUse = new Map()
  const tailUse = new Map()
  const maxAttempts = count * 600
  if (!heads.length || !tails.length) return out

  for (let a = 0; a < maxAttempts && out.length < count; a++) {
    const chosen = []
    for (let i = 0; i < parts - 1; i++) chosen.push(pickFrom(heads, evHeads).form)
    chosen.push(pickFrom(tails, evTails).form)
    const first = chosen[0]
    const last = chosen[chosen.length - 1]
    // The eye reads down the left edge of a list, so a repeated head looks
    // like a bug while a repeated ending five rows apart looks like a style.
    if ((headUse.get(first) ?? 0) >= maxHeadUses) continue
    if ((tailUse.get(last) ?? 0) >= maxTailUses) continue
    if (reject(chosen)) continue
    const name = chosen.join('')
    if (seen.has(name)) continue
    seen.add(name)
    headUse.set(first, (headUse.get(first) ?? 0) + 1)
    tailUse.set(last, (tailUse.get(last) ?? 0) + 1)
    out.push({ name, parts: chosen })
  }
  return out
}
