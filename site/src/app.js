import {
  parseCorpus,
  selectWords,
  syllablePool,
  generateNames,
  countBits,
} from './engine.js'

const $ = (id) => document.getElementById(id)
const BATCH = 24

// His known-good recipe, so the very first screen already produces good names.
const DEFAULT_RECIPE = {
  include: ['lovecraft', 'stoker'],
  exclude: [],
  mode: 'all',
  rarity: 2,
}

const state = {
  corpus: null,
  recipe: { ...DEFAULT_RECIPE },
  seed: (Math.random() * 1e9) | 0,
  kept: [],
  poolCache: new Map(),
  pickMode: 'inc', // which set the picker is currently editing
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
    rarity: Math.max(0, Math.min(63, parseInt(h.get('r') ?? '2', 10) || 0)),
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

// Build one pill: sign glyph + name + a remove button. The glyph means the
// state survives a bad screen, bad light and colourblindness.
const pillFor = (id, kind, onRemove) => {
  const p = document.createElement('span')
  p.className = 'pill' + (kind === 'exc' ? ' no' : '')
  const sign = document.createElement('span')
  sign.className = 'sign'
  sign.textContent = kind === 'exc' ? '−' : '＋'
  const name = document.createElement('span')
  name.textContent = labelOf(id)
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'x'
  x.textContent = '✕'
  x.setAttribute('aria-label', `remove ${labelOf(id)}`)
  x.onclick = onRemove
  p.append(sign, name, x)
  return p
}

const fillPills = (el, ids, kind, addLabel) => {
  el.innerHTML = ''
  for (const id of ids) {
    el.append(
      pillFor(id, kind, () => {
        const arr = kind === 'exc' ? state.recipe.exclude : state.recipe.include
        arr.splice(arr.indexOf(id), 1)
        renderPills()
        syncChips()
        renderSummary()
        roll()
      }),
    )
  }
  if (addLabel !== null) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'addbtn'
    b.textContent = addLabel
    b.onclick = () => openSheet(kind)
    el.append(b)
  }
}

const renderPills = () => {
  const { include, exclude, mode, rarity } = state.recipe
  fillPills($('incPills'), include, 'inc', include.length ? '＋ add' : '＋ add an author')
  fillPills($('excPills'), exclude, 'exc', exclude.length ? '＋ add' : '＋ add an author to exclude')

  $('incGloss').innerHTML =
    mode === 'all'
      ? 'only words <b>every</b> one of these authors used'
      : 'every word used by <b>any</b> of these authors'

  $('rarityGloss').innerHTML =
    rarity === 0
      ? 'nothing dropped — common words stay in'
      : `drop words used in <b>${rarity} or more</b> of the 63 classics`

  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === mode)
  for (const b of $('raritySeg').children)
    b.classList.toggle('on', Number(b.dataset.rarity) === rarity)
  renderExpr()
}

// The two membership zones inside the picker: you can always see which set each
// author currently sits in, without tapping anything.
const renderSummary = () => {
  const { include, exclude } = state.recipe
  const none = (el, text) => {
    const d = document.createElement('span')
    d.className = 'pill empty'
    d.textContent = text
    el.append(d)
  }
  fillPills($('sumInc'), include, 'inc', null)
  fillPills($('sumExc'), exclude, 'exc', null)
  if (!include.length) none($('sumInc'), 'nobody yet')
  if (!exclude.length) none($('sumExc'), 'nobody yet')
}

const renderChips = () => {
  const wrap = $('chipGroups')
  wrap.innerHTML = ''
  const { sources, groups } = state.corpus.meta
  for (const g of groups) {
    const inGroup = sources.filter((s) => s.group === g.id)
    if (!inGroup.length) continue
    const sec = document.createElement('div')
    sec.className = 'chip-group'
    const h = document.createElement('h3')
    h.textContent = g.label
    const row = document.createElement('div')
    row.className = 'chips'
    for (const s of inGroup) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      b.dataset.id = s.id
      const sign = document.createElement('span')
      sign.className = 'sign'
      b.append(sign, document.createTextNode(s.label))
      row.append(b)
    }
    sec.append(h, row)
    wrap.append(sec)
  }
  syncChips()
}

const syncChips = () => {
  for (const b of document.querySelectorAll('.chip')) {
    const id = b.dataset.id
    const st = state.recipe.include.includes(id)
      ? 'inc'
      : state.recipe.exclude.includes(id)
        ? 'exc'
        : ''
    if (st) b.dataset.state = st
    else delete b.dataset.state
    // Untouched chips preview the sign the active tab would give them, so the
    // consequence of a tap is visible before you make it.
    const sign = b.querySelector('.sign')
    if (sign) sign.textContent = st === 'inc' ? '＋' : st === 'exc' ? '−' : state.pickMode === 'exc' ? '−' : '＋'
  }
}

const setPickMode = (mode) => {
  state.pickMode = mode
  for (const b of $('pickTabs').children) b.classList.toggle('on', b.dataset.mode === mode)
  $('sheetTitle').textContent = mode === 'exc' ? 'Authors to exclude' : 'Authors to include'
  $('pickHint').innerHTML =
    mode === 'exc'
      ? 'Tap an author to <b>subtract</b> their words (∖ difference). Tap again to undo.'
      : 'Tap an author to <b>add</b> them to the include set. Tap again to undo.'
  syncChips()
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
  const sel = selectWords(state.corpus, state.recipe)
  const val = { words: countBits(sel), pool: syllablePool(state.corpus, sel) }
  state.poolCache.set(key, val)
  return val
}

const roll = () => {
  const results = $('results')
  const status = $('status')
  results.innerHTML = ''
  status.classList.remove('warn')

  if (!state.recipe.include.length) {
    status.textContent = 'Pick at least one author.'
    showEmpty('choose authors', () => openSheet())
    return
  }

  const { words, pool } = poolFor()
  const names = generateNames(state.corpus, pool, { count: BATCH, seed: state.seed })

  status.innerHTML = `set holds <b>${words.toLocaleString()}</b> words → <b>${pool.length.toLocaleString()}</b> syllables`
  $('footRecipe').textContent = recipeText()
  writeUrl()

  if (!names.length) {
    status.classList.add('warn')
    if (state.recipe.mode === 'all' && state.recipe.include.length > 1) {
      status.textContent = 'That intersection is empty — these authors share almost no rare words.'
      showEmpty('switch to ∪ UNION', () => {
        state.recipe.mode = 'any'
        renderPills()
        roll()
      })
    } else {
      status.textContent = 'Every word got subtracted.'
      showEmpty('weaken the ∖ difference', () => {
        state.recipe.rarity = state.recipe.rarity === 0 ? 0 : state.recipe.rarity + 4
        renderPills()
        roll()
      })
    }
    return
  }

  const rtext = recipeText()
  names.forEach((n, i) => {
    const card = document.createElement('button')
    card.className = 'name'
    card.type = 'button'
    card.style.animationDelay = `${Math.min(i, 12) * 14}ms`
    card.append(document.createTextNode(n.name))

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
    }
    card.append(star)
    results.append(card)
  })
}

const showEmpty = (label, fn) => {
  const d = document.createElement('div')
  d.className = 'empty-state'
  d.append(document.createTextNode('No names from that combination.'))
  const b = document.createElement('button')
  b.className = 'ghost'
  b.type = 'button'
  b.textContent = label
  b.onclick = fn
  d.append(document.createElement('br'), b)
  $('results').append(d)
}

const reroll = () => {
  state.seed = (Math.random() * 1e9) | 0
  roll()
}

// ---------------------------------------------------------------- sheets

const openSheet = (mode = 'inc') => {
  $('sheet').hidden = false
  setPickMode(mode)
  renderSummary()
}
const closeSheet = () => {
  $('sheet').hidden = true
}

// ---------------------------------------------------------------- wiring

const wire = () => {
  for (const el of document.querySelectorAll('[data-close]')) el.onclick = closeSheet
  for (const el of document.querySelectorAll('[data-close-kept]'))
    el.onclick = () => ($('keptSheet').hidden = true)

  $('keptBtn').onclick = () => {
    renderKept()
    $('keptSheet').hidden = false
  }

  $('rollBtn').onclick = reroll

  $('pickTabs').onclick = (e) => {
    const b = e.target.closest('button')
    if (b) setPickMode(b.dataset.mode)
  }

  // No hidden cycle: a tap puts the author in whichever set the tab names, or
  // takes them out of it. Which set that is, is stated at the top of the sheet.
  $('chipGroups').onclick = (e) => {
    const chip = e.target.closest('.chip')
    if (!chip) return
    const id = chip.dataset.id
    const { include, exclude } = state.recipe
    const bucket = state.pickMode === 'exc' ? exclude : include
    const other = state.pickMode === 'exc' ? include : exclude

    const oi = other.indexOf(id)
    if (oi >= 0) other.splice(oi, 1)
    const bi = bucket.indexOf(id)
    if (bi >= 0) bucket.splice(bi, 1)
    else bucket.push(id)

    syncChips()
    renderSummary()
    renderPills()
    roll()
  }

  $('modeSeg').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    state.recipe.mode = b.dataset.mode
    renderPills()
    roll()
  }

  $('raritySeg').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    state.recipe.rarity = Number(b.dataset.rarity)
    renderPills()
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
  renderChips()
  renderPills()
  saveKept()
  $('boot').remove()
  $('app').hidden = false
  $('rollBar').hidden = false
  roll()
}

main()
