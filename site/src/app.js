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

const recipeText = () => {
  const { include, exclude, mode, rarity } = state.recipe
  const glue = mode === 'all' ? ' ∩ ' : ' + '
  let t = include.map(labelOf).join(glue) || 'nothing'
  if (exclude.length) t += ' − ' + exclude.map(labelOf).join(' − ')
  const r = { 0: 'anything', 1: 'unheard of', 2: 'strange' }[rarity] ?? 'odd'
  return `${t} · ${r}`
}

// ---------------------------------------------------------------- rendering

const renderPills = () => {
  const inc = $('incPills')
  const exc = $('excPills')
  inc.innerHTML = ''
  exc.innerHTML = ''

  if (!state.recipe.include.length) {
    const d = document.createElement('span')
    d.className = 'pill empty'
    d.textContent = 'pick an author →'
    inc.append(d)
  }
  for (const id of state.recipe.include) {
    const p = document.createElement('span')
    p.className = 'pill'
    p.textContent = labelOf(id)
    inc.append(p)
  }
  $('excLine').hidden = !state.recipe.exclude.length
  for (const id of state.recipe.exclude) {
    const p = document.createElement('span')
    p.className = 'pill no'
    p.textContent = labelOf(id)
    exc.append(p)
  }
  $('modeDial').hidden = state.recipe.include.length < 2
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === state.recipe.mode)
  for (const b of $('raritySeg').children)
    b.classList.toggle('on', Number(b.dataset.rarity) === state.recipe.rarity)
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
      b.textContent = s.label
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
  }
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

  status.innerHTML = `<b>${words.toLocaleString()}</b> words only these authors use → <b>${pool.length.toLocaleString()}</b> syllables`
  $('footRecipe').textContent = recipeText()
  writeUrl()

  if (!names.length) {
    status.classList.add('warn')
    if (state.recipe.mode === 'all' && state.recipe.include.length > 1) {
      status.textContent = 'These authors share almost no rare words.'
      showEmpty('mix them instead', () => {
        state.recipe.mode = 'any'
        renderPills()
        roll()
      })
    } else {
      status.textContent = 'Nothing survived that filter.'
      showEmpty('loosen it', () => {
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

const openSheet = () => {
  $('sheet').hidden = false
  syncChips()
}
const closeSheet = () => {
  $('sheet').hidden = true
}

// ---------------------------------------------------------------- wiring

const wire = () => {
  $('pickBtn').onclick = openSheet
  for (const el of document.querySelectorAll('[data-close]')) el.onclick = closeSheet
  for (const el of document.querySelectorAll('[data-close-kept]'))
    el.onclick = () => ($('keptSheet').hidden = true)

  $('keptBtn').onclick = () => {
    renderKept()
    $('keptSheet').hidden = false
  }

  $('rollBtn').onclick = reroll

  $('chipGroups').onclick = (e) => {
    const chip = e.target.closest('.chip')
    if (!chip) return
    const id = chip.dataset.id
    const { include, exclude } = state.recipe
    const iI = include.indexOf(id)
    const iE = exclude.indexOf(id)
    if (iI < 0 && iE < 0) include.push(id)
    else if (iI >= 0) {
      include.splice(iI, 1)
      exclude.push(id)
    } else exclude.splice(iE, 1)
    syncChips()
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
