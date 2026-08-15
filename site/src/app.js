import {
  DEFAULT_RECIPE,
  parseCorpus,
  selectWords,
  selectStages,
  wordsIn,
  wordsWithSyllable,
  syllablePool,
  generateNames,
  countBits,
} from './engine.js'

const $ = (id) => document.getElementById(id)
const BATCH = 24

// Deep copy, always. A shallow spread shares the include/exclude arrays with
// DEFAULT_RECIPE, so every tap quietly rewrote the default and "start over"
// could never get back to it.
const freshRecipe = () => ({
  ...DEFAULT_RECIPE,
  include: [...DEFAULT_RECIPE.include],
  exclude: [...DEFAULT_RECIPE.exclude],
})

const state = {
  corpus: null,
  recipe: freshRecipe(),
  seed: (Math.random() * 1e9) | 0,
  kept: [],
  poolCache: new Map(),
}

// ---------------------------------------------------------------- loading

// Two deliveries of the same bytes, cheapest first. See build-corpus.mjs for
// the measurements; briefly:
//
//   corpus.bin      369 KB. Gzip, inflated here. Cloudflare will not compress
//                   octet-stream and re-compresses in transport, so the bytes
//                   arrive still gzipped and we need DecompressionStream --
//                   Safari 16.4+, Firefox 113+.
//   corpus.b64.txt  468 KB. base64 text/plain, so the edge brotli-compresses it
//                   and every browser inflates transparently. Costs ~100 KB
//                   more, so it is only used where the cheap path cannot run.
const fromGzip = async () => {
  const res = await fetch('./corpus.bin', { cache: 'force-cache' })
  if (!res.ok) throw new Error(`corpus.bin ${res.status}`)
  let buf = await res.arrayBuffer()
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(8, buf.byteLength)))
  if (magic !== 'NAMEGEN2') {
    const ds = new DecompressionStream('gzip')
    buf = await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer()
  }
  return parseCorpus(buf)
}

const fromBase64 = async () => {
  const res = await fetch('./corpus.b64.txt', { cache: 'force-cache' })
  if (!res.ok) throw new Error(`corpus.b64.txt ${res.status}`)
  const bin = atob((await res.text()).trim())
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return parseCorpus(u8.buffer)
}

const loadCorpus = async () => {
  if (typeof DecompressionStream === 'function') {
    try {
      return await fromGzip()
    } catch (e) {
      console.warn('gzip corpus failed, falling back to base64', e)
    }
  }
  return fromBase64()
}

// ---------------------------------------------------------------- recipe url

const readUrl = () => {
  const h = new URLSearchParams(location.hash.slice(1))
  if (!h.has('i')) return
  const ids = new Set(state.corpus.meta.sources.map((s) => s.id))
  const pick = (k) => (h.get(k) || '').split(',').filter((x) => ids.has(x))
  const inc = pick('i')
  if (!inc.length) return
  state.recipe = {
    include: inc,
    exclude: pick('x'),
    mode: h.get('m') === 'any' ? 'any' : 'all',
    rarity: Math.max(
      0,
      Math.min(63, parseInt(h.get('r') ?? String(DEFAULT_RECIPE.rarity), 10) || 0),
    ),
  }
  const s = parseInt(h.get('s') ?? '', 10)
  if (Number.isFinite(s)) state.seed = s
}

const writeUrl = () => {
  const { include, exclude, mode, rarity } = state.recipe
  const p = new URLSearchParams()
  p.set('i', include.join(','))
  if (exclude.length) p.set('x', exclude.join(','))
  p.set('m', mode)
  p.set('r', String(rarity))
  p.set('s', String(state.seed))
  history.replaceState(null, '', '#' + p.toString())
}

// ---------------------------------------------------------------- labels

const labelOf = (id) => state.corpus.meta.sources.find((s) => s.id === id)?.label ?? id

// The recipe written the way he wrote it in scratch.test.js. Precise beats cute:
// "where they overlap" could mean several things, "∩" means exactly one.
const recipeText = () => {
  const { include, exclude, mode, rarity } = state.recipe
  const op = mode === 'all' ? ' ∩ ' : ' ∪ '
  let t = include.map(labelOf).join(op) || '∅'
  if (include.length > 1) t = `(${t})`
  for (const id of exclude) t += ` ∖ ${labelOf(id)}`
  if (rarity > 0) t += ` ∖ common(≥${rarity})`
  return t
}

const renderExpr = () => {
  const el = $('expr')
  el.innerHTML = ''
  const { include, exclude, mode, rarity } = state.recipe
  const op = mode === 'all' ? ' ∩ ' : ' ∪ '
  const add = (text, cls) => {
    const s = document.createElement('span')
    if (cls) s.className = cls
    s.textContent = text
    el.append(s)
  }
  if (include.length > 1) add('( ')
  include.forEach((id, i) => {
    if (i) add(op, 'op')
    add(labelOf(id))
  })
  if (!include.length) add('∅')
  if (include.length > 1) add(' )')
  for (const id of exclude) {
    add(' ∖ ', 'op')
    add(labelOf(id), 'ex')
  }
  if (rarity > 0) {
    add(' ∖ ', 'op')
    add(`common(≥${rarity})`, 'ex')
  }
}

// ---------------------------------------------------------------- rendering

// One flat list. Every author owns a + and a -, both always visible, both one
// tap. No mode to be in, no panel to open, nothing to discover. The two
// previous designs each put a mode or a sheet in the way and he reported the
// same confusion both times.
const renderAuthors = () => {
  const wrap = $('authorList')
  wrap.innerHTML = ''
  const { sources, groups } = state.corpus.meta
  for (const g of groups) {
    const inGroup = sources.filter((s) => s.group === g.id)
    if (!inGroup.length) continue
    const h = document.createElement('div')
    h.className = 'author-group'
    h.textContent = g.label
    wrap.append(h)
    for (const s of inGroup) {
      const row = document.createElement('div')
      row.className = 'author-row'
      row.dataset.id = s.id

      const plus = document.createElement('button')
      plus.type = 'button'
      plus.className = 'plus'
      plus.textContent = '＋'
      plus.setAttribute('aria-label', `include ${s.label}`)
      plus.onclick = () => setAuthor(s.id, 'inc')

      const minus = document.createElement('button')
      minus.type = 'button'
      minus.className = 'minus'
      minus.textContent = '−'
      minus.setAttribute('aria-label', `exclude ${s.label}`)
      minus.onclick = () => setAuthor(s.id, 'exc')

      const nm = document.createElement('span')
      nm.className = 'nm'
      nm.textContent = s.label

      // Clearing is its own visible control, present only when there is
      // something to clear. Making + or - toggle back off would just be the
      // hidden cycle again, one level down.
      const clr = document.createElement('button')
      clr.type = 'button'
      clr.className = 'clr'
      clr.textContent = '✕'
      clr.setAttribute('aria-label', `clear ${s.label}`)
      clr.onclick = () => setAuthor(s.id, '')

      row.append(plus, minus, nm, clr)
      wrap.append(row)
    }
  }
  syncAuthors()
}

// `want` is 'inc', 'exc' or '' (clear). Each button states an outcome rather
// than toggling, so no tap depends on remembering the current state.
const setAuthor = (id, want) => {
  const { include, exclude } = state.recipe
  const inInc = include.indexOf(id)
  const inExc = exclude.indexOf(id)
  if (inInc >= 0) include.splice(inInc, 1)
  if (inExc >= 0) exclude.splice(inExc, 1)
  if (want === 'inc') include.push(id)
  else if (want === 'exc') exclude.push(id)

  syncAuthors()
  renderControls()
  roll()
}

const resetAll = () => {
  state.recipe = freshRecipe()
  state.seed = (Math.random() * 1e9) | 0
  syncAuthors()
  renderControls()
  roll()
  $('authorList').scrollTop = 0
  toast('back to the default')
}

const syncAuthors = () => {
  for (const row of document.querySelectorAll('.author-row')) {
    const id = row.dataset.id
    const st = state.recipe.include.includes(id)
      ? 'inc'
      : state.recipe.exclude.includes(id)
        ? 'exc'
        : ''
    if (st) row.dataset.state = st
    else delete row.dataset.state
    row.querySelector('.plus').classList.toggle('on', st === 'inc')
    row.querySelector('.minus').classList.toggle('on', st === 'exc')
    row.querySelector('.clr').hidden = !st
  }
}

const renderControls = () => {
  const { mode, rarity } = state.recipe
  $('incGloss').textContent =
    mode === 'all' ? '— words every one of them used' : '— words any of them used'
  $('rarityGloss').innerHTML =
    rarity === 0
      ? 'nothing dropped — common words stay in'
      : `drop words used in <b>${rarity} or more</b> of the 63 classics`
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === mode)
  for (const b of $('raritySeg').children)
    b.classList.toggle('on', Number(b.dataset.rarity) === rarity)
  renderExpr()
}

// ---------------------------------------------------------------- proof
//
// He wrote this algorithm and wants to see it working, which is fair: a count
// and some invented words prove nothing on their own. So show the real
// vocabulary each stage kept AND what it threw away, and let any generated name
// be traced back to the source words its syllables came from.

const WORD_SAMPLE = 400

const stageBlock = (title, cls, count, words, note) => {
  const wrap = document.createElement('div')
  wrap.className = 'proof-stage'
  const h = document.createElement('div')
  h.className = `stage-head ${cls}`
  const n = document.createElement('span')
  n.className = 'n'
  n.textContent = count.toLocaleString()
  h.append(n, document.createTextNode(' ' + title))
  wrap.append(h)
  if (note) {
    const p = document.createElement('p')
    p.className = 'gloss'
    p.textContent = note
    wrap.append(p)
  }
  const box = document.createElement('div')
  box.className = 'wordbox' + (cls === 'cut' ? ' cut' : '')
  box.textContent = words.length ? words.join(', ') : '(none)'
  wrap.append(box)
  return wrap
}

const renderProof = (stages) => {
  const box = $('proofBox')
  box.innerHTML = ''
  if (!stages) {
    const p = document.createElement('p')
    p.className = 'gloss'
    p.textContent = 'Pick an author to see the words.'
    box.append(p)
    return
  }

  const keptN = countBits(stages.final)
  const kept = wordsIn(state.corpus, stages.final, WORD_SAMPLE)
  box.append(
    stageBlock(
      'words survived — these are what the names are built from',
      'kept',
      keptN,
      kept,
      keptN > WORD_SAMPLE ? `showing an even spread of ${WORD_SAMPLE}` : '',
    ),
  )

  const exN = countBits(stages.droppedByExclude)
  if (exN) {
    box.append(
      stageBlock(
        `removed by ∖ ${state.recipe.exclude.map(labelOf).join(', ')}`,
        'cut',
        exN,
        wordsIn(state.corpus, stages.droppedByExclude, 120),
      ),
    )
  }

  const cmN = countBits(stages.droppedByCommon)
  if (cmN) {
    box.append(
      stageBlock(
        `dropped as common English (≥${state.recipe.rarity} classics)`,
        'cut',
        cmN,
        wordsIn(state.corpus, stages.droppedByCommon, 120),
      ),
    )
  }
}

// Tapping a name shows the source words each of its syllables came from.
const renderTrace = (n) => {
  const el = $('traceBox')
  el.innerHTML = ''
  el.hidden = false
  const stages = state.stages
  if (!stages) return

  const h = document.createElement('h4')
  h.append(document.createTextNode('where '))
  const nm = document.createElement('span')
  nm.textContent = n.name
  h.append(nm, document.createTextNode(' came from'))
  el.append(h)

  for (const syl of n.parts) {
    const row = document.createElement('div')
    row.className = 'trace-syl'
    const b = document.createElement('b')
    b.textContent = syl
    const i = document.createElement('i')
    const src = wordsWithSyllable(state.corpus, stages.final, syl, 6)
    i.textContent = src.length ? '← ' + src.join(', ') : '← (in the set)'
    row.append(b, i)
    el.append(row)
  }
}

// The set size after every stage, always on screen.
//
// He reported "PKD ∪ Asimov was empty". The union was 7,550 words and fine; he
// had the two defaults still included, so it was a FOUR-way intersection, and
// then common(≥1) took 1,665 words down to 2. The maths was right and the UI
// said nothing -- which is indistinguishable from broken. So: show the count
// after each operation, and if one of them empties the set, name it.
const stageChain = () => {
  const { include, exclude, mode, rarity } = state.recipe
  const s = state.stages
  const out = []
  const op = mode === 'all' ? '∩' : '∪'
  out.push({
    label: include.length > 1 ? `${op} ${include.length} authors` : labelOf(include[0]),
    n: countBits(s.base),
  })
  if (exclude.length) out.push({ label: `∖ ${exclude.map(labelOf).join(', ')}`, n: countBits(s.afterExclude) })
  if (rarity > 0) out.push({ label: `∖ common(≥${rarity})`, n: countBits(s.final) })
  return out
}

const renderStatus = (pool, nameCount) => {
  const status = $('status')
  status.innerHTML = ''
  status.classList.remove('warn')
  const chain = stageChain()

  for (const [i, st] of chain.entries()) {
    if (i) {
      const arrow = document.createElement('span')
      arrow.className = 'arrow'
      arrow.textContent = ' → '
      status.append(arrow)
    }
    const span = document.createElement('span')
    span.className = 'stage' + (st.n === 0 ? ' zero' : '')
    const n = document.createElement('b')
    n.textContent = st.n.toLocaleString()
    span.append(n, document.createTextNode(' ' + st.label))
    status.append(span)
  }
  const tail = document.createElement('span')
  tail.className = 'arrow'
  tail.textContent = ` → ${pool.length.toLocaleString()} syllables`
  status.append(tail)

  const jump = document.createElement('a')
  jump.className = 'jump'
  jump.href = '#proof'
  jump.textContent = 'see the words ▸'
  status.append(jump)

  if (nameCount === 0) explainEmpty(chain, pool)
}

// Say which operation emptied it, and offer the control that undoes the damage.
const explainEmpty = (chain, pool) => {
  const status = $('status')
  status.classList.add('warn')
  const { mode, include, rarity } = state.recipe

  let culprit = null
  let prev = null
  for (const st of chain) {
    if (prev !== null && st.n < prev / 4) culprit = st
    prev = st.n
  }

  const why = document.createElement('div')
  why.className = 'why'
  const first = chain[0]

  if (culprit && /common/.test(culprit.label)) {
    why.textContent = `${culprit.label} cut it to ${culprit.n.toLocaleString()} words — only ${pool.length} syllables, too few to build from.`
    why.append(fixButton('loosen it to ≥ 6', () => {
      state.recipe.rarity = 6
      renderControls()
      roll()
    }))
  } else if (mode === 'all' && include.length > 1) {
    why.textContent = `Those ${include.length} authors share only ${first.n.toLocaleString()} words, and ${pool.length} syllables is too few to build from.`
    why.append(fixButton('use ∪ UNION instead', () => {
      state.recipe.mode = 'any'
      renderControls()
      roll()
    }))
  } else {
    why.textContent = `Only ${pool.length} syllables in this set — too few to build from.`
    why.append(fixButton('start over', resetAll))
  }
  status.append(why)
}

const fixButton = (label, fn) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'fix'
  b.textContent = label
  b.onclick = fn
  return b
}

const toast = (msg) => {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => t.classList.remove('show'), 1500)
}

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* clipboard unavailable; the toast still confirms the pick */
    }
    ta.remove()
  }
}

// ---------------------------------------------------------------- kept names

const loadKept = () => {
  try {
    state.kept = JSON.parse(localStorage.getItem('nameforge.kept') || '[]')
  } catch {
    state.kept = []
  }
}
const saveKept = () => {
  try {
    localStorage.setItem('nameforge.kept', JSON.stringify(state.kept))
  } catch {
    /* private mode: keeping still works for this session */
  }
  $('keptCount').textContent = String(state.kept.length)
}

const toggleKeep = (name, recipe) => {
  const i = state.kept.findIndex((k) => k.name === name)
  if (i >= 0) state.kept.splice(i, 1)
  else state.kept.unshift({ name, recipe })
  saveKept()
  renderKept()
}

const renderKept = () => {
  const list = $('keptList')
  list.innerHTML = ''
  if (!state.kept.length) {
    const p = document.createElement('p')
    p.className = 'kept-empty'
    p.textContent = 'Nothing kept yet. Tap ★ on a name.'
    list.append(p)
    return
  }
  const all = document.createElement('button')
  all.className = 'ghost'
  all.type = 'button'
  all.textContent = `copy all ${state.kept.length}`
  all.onclick = async () => {
    await copy(state.kept.map((k) => k.name).join('\n'))
    toast('copied all')
  }
  list.append(all)

  for (const k of state.kept) {
    const row = document.createElement('div')
    row.className = 'kept-row'
    const left = document.createElement('div')
    const b = document.createElement('b')
    b.textContent = k.name
    const s = document.createElement('small')
    s.textContent = k.recipe
    left.append(b, s)
    const del = document.createElement('button')
    del.type = 'button'
    del.textContent = '✕'
    del.setAttribute('aria-label', `remove ${k.name}`)
    del.onclick = () => toggleKeep(k.name, k.recipe)
    row.append(left, del)
    row.onclick = (e) => {
      if (e.target === del) return
      copy(k.name).then(() => toast(`copied ${k.name}`))
    }
    list.append(row)
  }
}

// ---------------------------------------------------------------- generating

const poolFor = () => {
  const { include, exclude, mode, rarity } = state.recipe
  const key = `${mode}|${include.join(',')}|${exclude.join(',')}|${rarity}`
  const hit = state.poolCache.get(key)
  if (hit) return hit
  const stages = selectStages(state.corpus, state.recipe)
  const val = {
    words: countBits(stages.final),
    pool: syllablePool(state.corpus, stages.final),
    stages,
  }
  state.poolCache.set(key, val)
  return val
}

const roll = () => {
  const results = $('results')
  const status = $('status')
  results.innerHTML = ''
  status.classList.remove('warn')

  if (!state.recipe.include.length) {
    status.textContent = 'Tap ＋ next to an author below.'
    status.classList.add('warn')
    renderProof(null)
    return
  }

  const { pool, stages } = poolFor()
  state.stages = stages
  renderProof(stages)
  $('traceBox').hidden = true

  const names = generateNames(state.corpus, pool, { count: BATCH, seed: state.seed })

  renderStatus(pool, names.length)
  $('footRecipe').textContent = recipeText()
  writeUrl()

  if (!names.length) return

  const rtext = recipeText()
  names.forEach((n, i) => {
    const card = document.createElement('button')
    card.className = 'name'
    card.type = 'button'
    card.style.animationDelay = `${Math.min(i, 12) * 14}ms`
    card.append(document.createTextNode(n.name))

    // The assembly, printed on every card: proof of the remix step without
    // having to interact with anything.
    const parts = document.createElement('span')
    parts.className = 'parts'
    parts.textContent = n.parts.join(' + ')
    card.append(parts)

    const star = document.createElement('span')
    star.className = 'star' + (state.kept.some((k) => k.name === n.name) ? ' on' : '')
    star.textContent = '★'
    star.setAttribute('role', 'button')
    star.setAttribute('aria-label', `keep ${n.name}`)
    star.onclick = (e) => {
      e.stopPropagation()
      toggleKeep(n.name, rtext)
      star.classList.toggle('on')
      toast(star.classList.contains('on') ? `kept ${n.name}` : 'removed')
    }

    card.onclick = async () => {
      await copy(n.name)
      card.classList.add('copied')
      setTimeout(() => card.classList.remove('copied'), 700)
      toast(`copied ${n.name}`)
      renderTrace(n) // and show which real words it was built from
    }
    card.append(star)
    results.append(card)
  })
}

const reroll = () => {
  state.seed = (Math.random() * 1e9) | 0
  roll()
}

// ---------------------------------------------------------------- wiring

const wire = () => {
  for (const el of document.querySelectorAll('[data-close-kept]'))
    el.onclick = () => ($('keptSheet').hidden = true)

  $('keptBtn').onclick = () => {
    renderKept()
    $('keptSheet').hidden = false
  }

  $('rollBtn').onclick = reroll
  $('resetBtn').onclick = resetAll

  $('modeSeg').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    state.recipe.mode = b.dataset.mode
    renderControls()
    roll()
  }

  $('raritySeg').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    state.recipe.rarity = Number(b.dataset.rarity)
    renderControls()
    roll()
  }
}

// ---------------------------------------------------------------- boot

const main = async () => {
  loadKept()
  try {
    state.corpus = await loadCorpus()
  } catch (err) {
    $('boot').innerHTML =
      '<div class="boot-text">Could not load the word data.<br>Check your connection and reload.</div>'
    console.error(err)
    return
  }
  readUrl()
  wire()
  renderAuthors()
  renderControls()
  saveKept()
  $('boot').remove()
  $('app').hidden = false
  $('rollBar').hidden = false
  roll()
}

main()
