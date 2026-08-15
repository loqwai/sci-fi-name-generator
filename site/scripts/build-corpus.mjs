#!/usr/bin/env node
// Build-time precompute: 62 MB of raw Gutenberg text -> one small binary the
// phone can hold in memory.
//
// The client needs to do WORD-level set math (that is the algorithm in
// scratch.test.js), so it needs word identity. It does NOT need syllables
// shipped: getSyllables() is a regex, so the browser derives them from the word
// strings at run time.
//
// Layout: a global vocabulary (sorted so that words sharing a membership
// pattern are adjacent -> the bitsets become long runs -> gzip loves it), plus
// one bitset per source. Set math is then a few Uint32Array AND/OR/ANDNOT
// passes over ~N/32 words. Exact, not approximate.

import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { gzipSync, brotliCompressSync, constants } from 'zlib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { SOURCES, GROUPS, COMMON_ID, COMMON_LABEL } from './corpora.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const DATA = join(ROOT, 'data')
const OUT = join(__dirname, '..', 'dist')

const MIN_TOTAL_FREQ = 2 // a word must occur >=2 times overall (kills OCR junk / hapax typos)
const MAX_WORD_LEN = 24

// ---------------------------------------------------------------- text loading

// Project Gutenberg wraps every book in a licence header/footer. Those words
// ("gutenberg", "ebook", "trademark", "donations") are identical in all 63
// books, so they would masquerade as vocabulary. Strip them.
const stripGutenberg = (text) => {
  const start = text.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]{0,200}?\*\*\*/i)
  if (start !== -1) {
    const after = text.indexOf('***', text.indexOf('***', start) + 3)
    if (after !== -1) text = text.slice(after + 3)
  }
  const end = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i)
  if (end !== -1) text = text.slice(0, end)
  return text
}

const WORD_SPLIT = /[^a-zA-Z]+/

const tokenize = (text) => {
  const out = []
  for (const raw of text.split(WORD_SPLIT)) {
    if (!raw) continue
    const w = raw.toLowerCase()
    if (w.length > MAX_WORD_LEN) continue
    if (w.length === 1 && w !== 'a' && w !== 'i') continue
    out.push(w)
  }
  return out
}

const listFiles = async (src) => {
  const files = []
  for (const d of src.dirs ?? []) {
    for (const f of await readdir(join(DATA, d))) files.push(join(DATA, d, f))
  }
  for (const f of src.files ?? []) files.push(join(DATA, f))
  return files
}

// ---------------------------------------------------------------- main build

const main = async () => {
  const t0 = Date.now()
  await mkdir(OUT, { recursive: true })

  const top100Dir = join(DATA, 'top100')
  const top100Files = (await readdir(top100Dir)).map((f) => join(top100Dir, f))

  const sources = SOURCES.map((s) => ({ ...s }))

  // word -> per-source counts. Use one Map<string, Uint32Array-ish> keyed by word.
  const counts = new Map() // word -> {t: totalFreq, m: Set<sourceIdx>}
  const sourceStats = []

  for (let si = 0; si < sources.length; si++) {
    const src = sources[si]
    const files = src._files ?? (await listFiles(src))
    let tokens = 0
    const seen = new Set()
    for (const f of files) {
      const text = stripGutenberg(await readFile(f, 'utf8'))
      for (const w of tokenize(text)) {
        tokens++
        seen.add(w)
        let rec = counts.get(w)
        if (!rec) counts.set(w, (rec = { t: 0, m: [] }))
        rec.t++
        if (rec.m[rec.m.length - 1] !== si) rec.m.push(si)
      }
    }
    // How many of this source's files are themselves among the 63 classics?
    // Needed so the rarity filter can leave out a source's own contribution.
    const classics = files.filter((f) => f.replace(/\\/g, '/').includes('/top100/')).length
    sourceStats.push({ id: src.id, files: files.length, tokens, types: seen.size, classics })
    process.stderr.write(
      `  ${String(si + 1).padStart(2)}/${sources.length} ${src.id.padEnd(14)} ${String(files.length).padStart(2)} file(s)  ${String(tokens).padStart(9)} tokens  ${String(seen.size).padStart(7)} types\n`,
    )
  }

  // ---- "common English", as document frequency over the 63 classics ----
  //
  // The original recipe excluded any word appearing anywhere in top100. That
  // works when the included authors sit OUTSIDE top100 (his five folders), but
  // most of the pickable sources here ARE books in top100 -- so a flat union
  // would make "Shakespeare, but not common English" the empty set.
  //
  // Document frequency fixes it and is strictly more informative: a word in 30
  // of the 63 classics is common English; a word in one is distinctive. The UI
  // exposes the threshold as a plain-language rarity dial.
  for (const f of top100Files) {
    const text = stripGutenberg(await readFile(f, 'utf8'))
    const seen = new Set(tokenize(text))
    for (const w of seen) {
      let rec = counts.get(w)
      if (!rec) counts.set(w, (rec = { t: 0, m: [], df: 0 }))
      rec.t++
      rec.df = (rec.df ?? 0) + 1
    }
  }
  process.stderr.write(`  df pass over ${top100Files.length} classics complete\n`)

  const rawTypes = counts.size

  // ---- prune ----
  const kept = []
  for (const [w, rec] of counts) {
    if (rec.t < MIN_TOTAL_FREQ) continue
    kept.push(w)
  }

  // ---- order by membership pattern, then alphabetically ----
  // Words that live in exactly the same set of sources become adjacent, so each
  // source's bitset degenerates into a handful of long runs.
  // Sub-sorting by df within a membership pattern keeps the bitset runs intact
  // while also making the df array run-length friendly.
  const keyOf = (w) => {
    const r = counts.get(w)
    return r.m.join(',') + '|' + String(r.df ?? 0).padStart(3, '0')
  }
  kept.sort((a, b) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (ka !== kb) return ka < kb ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  })

  const N = kept.length
  const words = kept

  // ---- bitsets ----
  const wordsPerSet = Math.ceil(N / 32)
  const bitsets = sources.map(() => new Uint32Array(wordsPerSet))
  const df = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const rec = counts.get(words[i])
    const wi = i >>> 5
    const bit = 1 << (i & 31)
    for (const si of rec.m) bitsets[si][wi] |= bit
    df[i] = Math.min(255, rec.df ?? 0)
  }

  // ---- pronounceable: exact replication of pronounceable.test in 2.2 KB ----
  // For words of length >= 3 the package consults ONLY triples.json, and only
  // compares each probability against a fixed threshold of 0.001. So the entire
  // decision surface is a boolean per 3-letter sequence: 26^3 bits.
  const triples = JSON.parse(
    await readFile(join(ROOT, 'node_modules', 'pronounceable', 'data', 'triples.json'), 'utf8'),
  )
  const THRESHOLD = 0.001
  const A = 'a'.charCodeAt(0)
  const triBits = new Uint8Array(Math.ceil(26 * 26 * 26 / 8))
  let allowed = 0
  for (const [c1, lvl2] of Object.entries(triples)) {
    for (const [c2, lvl3] of Object.entries(lvl2)) {
      for (const [c3, p] of Object.entries(lvl3)) {
        if (p < THRESHOLD) continue
        const idx =
          (c1.charCodeAt(0) - A) * 676 + (c2.charCodeAt(0) - A) * 26 + (c3.charCodeAt(0) - A)
        if (idx < 0 || idx >= 17576) continue
        triBits[idx >>> 3] |= 1 << (idx & 7)
        allowed++
      }
    }
  }

  // ---- pack ----
  const enc = new TextEncoder()
  const wordBlob = enc.encode(words.join('\n'))
  const meta = {
    v: 2,
    wordCount: N,
    classics: top100Files.length,
    sources: sources.map((s, i) => ({
      id: s.id,
      label: s.label,
      group: s.group ?? null,
      types: sourceStats[i].types,
      tokens: sourceStats[i].tokens,
      classics: sourceStats[i].classics,
    })),
    groups: GROUPS,
  }
  const metaBlob = enc.encode(JSON.stringify(meta))

  const chunks = []
  const u32 = (n) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n >>> 0, 0)
    return b
  }
  chunks.push(Buffer.from(enc.encode('NAMEGEN2')))
  chunks.push(u32(metaBlob.length))
  chunks.push(Buffer.from(metaBlob))
  chunks.push(u32(wordBlob.length))
  chunks.push(Buffer.from(wordBlob))
  chunks.push(u32(wordsPerSet))
  for (const bs of bitsets) chunks.push(Buffer.from(bs.buffer, bs.byteOffset, bs.byteLength))
  chunks.push(u32(df.length))
  chunks.push(Buffer.from(df))
  chunks.push(u32(triBits.length))
  chunks.push(Buffer.from(triBits))

  const raw = Buffer.concat(chunks)
  const gz = gzipSync(raw, { level: 9 })
  const br = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  })

  await writeFile(join(OUT, 'corpus.bin.gz'), gz)

  const dfHist = {}
  for (let k = 0; k <= 6; k++) dfHist[k] = 0
  for (let i = 0; i < N; i++) dfHist[Math.min(6, df[i])]++

  const kb = (n) => (n / 1024).toFixed(1) + ' KB'
  console.log(`
corpus built in ${((Date.now() - t0) / 1000).toFixed(1)}s
  sources            ${sources.length} pickable
  df histogram       ${Object.entries(dfHist).map(([k, v]) => `${k}${k === '6' ? '+' : ''}:${v}`).join('  ')}
  distinct words     ${rawTypes.toLocaleString()} raw -> ${N.toLocaleString()} kept (freq >= ${MIN_TOTAL_FREQ})
  pronounceable      ${allowed.toLocaleString()} of 17,576 triples allowed -> ${triBits.length} bytes
  --- payload ---
  words blob         ${kb(wordBlob.length)}
  bitsets            ${kb(wordsPerSet * 4 * sources.length)}  (${sources.length} x ${kb(wordsPerSet * 4)})
  df array           ${kb(df.length)}
  uncompressed       ${kb(raw.length)}
  gzip -9            ${kb(gz.length)}   <-- shipped
  brotli -11         ${kb(br.length)}
`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
