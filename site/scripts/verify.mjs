#!/usr/bin/env node
// Drive the real site in a real browser at phone size, exercise every control,
// and fail loudly on any console error. Usage: node scripts/verify.mjs [url]
import { pathToFileURL } from 'url'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Imported, not hardcoded: these steps used to name the default's authors
// literally, so changing the default broke the harness rather than testing it.
import { DEFAULT_RECIPE } from '../src/engine.js'

const pw = await import(
  pathToFileURL('D:/projects/paper-cranes/node_modules/playwright/index.js').href
)
const chromium = pw.chromium ?? pw.default?.chromium

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(__dirname, '..', 'shots')
await mkdir(SHOTS, { recursive: true })

const URL_ = process.argv[2] || 'http://127.0.0.1:8788/'
const TAG = process.argv[3] || 'local'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await ctx.newPage()

const errors = []
const warnings = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
  if (m.type() === 'warning') warnings.push(m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))

const step = async (name, fn) => {
  try {
    await fn()
    console.log(`  ok   ${name}`)
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`)
    errors.push(`step ${name}: ${e.message}`)
  }
}

const t0 = Date.now()
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('.name', { timeout: 30000 })
const loadMs = Date.now() - t0
console.log(`\nloaded + first names in ${loadMs}ms at 390x844`)

const names = async () => page.$$eval('.name', (els) => els.map((e) => e.childNodes[0].textContent.trim()))

const first = await names()
console.log(`  default batch (${first.length}): ${first.slice(0, 10).join(', ')}`)
await page.screenshot({ path: join(SHOTS, `${TAG}-1-default.png`) })

await step('status line reports word + syllable counts', async () => {
  const s = await page.textContent('#status')
  if (!/words/.test(s)) throw new Error(`status was "${s}"`)
})

await step('roll again produces a different batch', async () => {
  await page.click('#rollBtn')
  await page.waitForTimeout(350)
  const second = await names()
  if (!second.length) throw new Error('no names after reroll')
  if (second.join() === first.join()) throw new Error('identical batch')
})

await step('tap a name copies it (clipboard actually holds it)', async () => {
  const target = (await names())[0]
  await page.click('.name')
  await page.waitForSelector('.toast.show', { timeout: 3000 })
  const t = await page.textContent('#toast')
  if (!/copied/.test(t)) throw new Error(`toast said "${t}"`)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  if (clip !== target) throw new Error(`clipboard held "${clip}", expected "${target}"`)
})

await step('star keeps a name', async () => {
  await page.click('.name .star')
  await page.waitForTimeout(250)
  const n = await page.textContent('#keptCount')
  if (n === '0') throw new Error('kept count still 0')
})

await step('kept sheet opens and lists it', async () => {
  await page.click('#keptBtn')
  await page.waitForSelector('#keptSheet .kept-row', { timeout: 3000 })
  await page.screenshot({ path: join(SHOTS, `${TAG}-4-kept.png`) })
  await page.click('#keptSheet .sheet-head [data-close-kept]')
  await page.waitForTimeout(200)
})

await step('rarity dial changes the pool', async () => {
  const before = await page.textContent('#status')
  await page.click('#raritySeg button[data-rarity="0"]')
  await page.waitForTimeout(500)
  const after = await page.textContent('#status')
  if (before === after) throw new Error('status unchanged')
  await page.click(`#raritySeg button[data-rarity="${DEFAULT_RECIPE.rarity}"]`)
  await page.waitForTimeout(500)
})

await step('set operations are still named on the first screen', async () => {
  const txt = await page.textContent('main')
  for (const term of ['INCLUDE', 'INTERSECTION', 'UNION', 'DIFFERENCE', 'AUTHORS']) {
    if (!txt.includes(term)) throw new Error(`"${term}" not on the first screen`)
  }
  const expr = await page.textContent('#expr')
  if (!/∩|∪/.test(expr)) throw new Error(`expression was "${expr}"`)
})

await step('every author exposes its own + and - with nothing opened', async () => {
  const rows = await page.$$eval('.author-row', (e) => e.length)
  if (rows < 30) throw new Error(`only ${rows} author rows`)
  const plus = await page.$$eval('.author-row .plus', (e) => e.length)
  const minus = await page.$$eval('.author-row .minus', (e) => e.length)
  if (plus !== rows || minus !== rows) throw new Error(`${plus} plus / ${minus} minus for ${rows} rows`)
  // and no sheet/modal exists at all any more
  if (await page.$('#sheet')) throw new Error('the author picker sheet still exists')
})

// The bar the coordinator set: one tap, no panel, no mode.
await step('ONE TAP excludes an author from the default screen', async () => {
  const row = page.locator('.author-row[data-id="shakespeare"]')
  await row.scrollIntoViewIfNeeded()
  const before = await page.textContent('#expr')
  if (/Shakespeare/.test(before)) throw new Error('Shakespeare already in the recipe')
  await row.locator('.minus').click() // <-- the single tap
  await page.waitForTimeout(500)
  if ((await row.getAttribute('data-state')) !== 'exc') throw new Error('row not excluded')
  const after = await page.textContent('#expr')
  if (!/∖ Shakespeare/.test(after)) throw new Error(`expression was "${after}"`)
})

await step('ONE TAP moves the same author from exclude to include', async () => {
  const row = page.locator('.author-row[data-id="shakespeare"]')
  await row.locator('.plus').click() // <-- single tap, no need to clear first
  await page.waitForTimeout(500)
  if ((await row.getAttribute('data-state')) !== 'inc') throw new Error('row not included')
  if (/∖ Shakespeare/.test(await page.textContent('#expr'))) throw new Error('still excluded')
})

await step('ONE TAP on the visible ✕ clears an author', async () => {
  const row = page.locator('.author-row[data-id="shakespeare"]')
  const clr = row.locator('.clr')
  if (!(await clr.isVisible())) throw new Error('clear button not visible on a set author')
  await clr.click() // <-- the single tap
  await page.waitForTimeout(500)
  if (await row.getAttribute('data-state')) throw new Error('not cleared')
  if (/Shakespeare/.test(await page.textContent('#expr'))) throw new Error('still in the recipe')
})

await step('the ✕ only appears on authors that have a state', async () => {
  const neutral = page.locator('.author-row[data-id="wilde"] .clr')
  if (await neutral.isVisible()) throw new Error('clear shown on an untouched author')
  const set = page.locator('.author-row[data-id="lovecraft"] .clr')
  if (!(await set.isVisible())) throw new Error('clear missing on an included author')
})

await step('start over resets everything in one tap', async () => {
  await page.locator('.author-row[data-id="dickens"] .minus').click()
  await page.waitForTimeout(300)
  await page.locator('.author-row[data-id="wilde"] .plus').click()
  await page.waitForTimeout(300)
  await page.click('#resetBtn') // <-- the single tap
  await page.waitForTimeout(600)
  const expr = await page.textContent('#expr')
  if (/Dickens|Wilde/.test(expr)) throw new Error(`reset left "${expr}"`)
  if (!/Lovecraft/.test(expr)) throw new Error(`reset lost the default: "${expr}"`)
})

await step('excluded rows read without colour (line-through)', async () => {
  const row = page.locator('.author-row[data-id="dickens"]')
  await row.scrollIntoViewIfNeeded()
  await row.locator('.minus').click()
  await page.waitForTimeout(400)
  const deco = await page.$eval('.author-row[data-id="dickens"] .nm', (e) => getComputedStyle(e).textDecorationLine)
  if (!/line-through/.test(deco)) throw new Error(`decoration was "${deco}"`)
  await row.locator('.minus').click()
  await page.waitForTimeout(400)
})

await step('PROOF panel shows real source words', async () => {
  const txt = await page.textContent('#proofBox')
  if (!/words survived/.test(txt)) throw new Error('no survived stage')
  const box = await page.textContent('.wordbox')
  const sample = box.split(', ').filter(Boolean)
  if (sample.length < 20) throw new Error(`only ${sample.length} words shown`)
  // they must be REAL words from the corpus, not generated ones
  for (const w of sample.slice(0, 5)) {
    if (!/^[a-z]+$/.test(w.trim())) throw new Error(`odd word "${w}"`)
  }
  console.log(`       set sample: ${sample.slice(0, 12).join(', ')}`)
})

await step('PROOF panel shows what common English removed', async () => {
  const txt = await page.textContent('#proofBox')
  if (!/dropped as common English/.test(txt)) throw new Error('no dropped stage')
  const boxes = await page.$$eval('.wordbox', (e) => e.map((x) => x.textContent))
  if (boxes.length < 2) throw new Error('no second word list')
  console.log(`       dropped sample: ${boxes[boxes.length - 1].split(', ').slice(0, 10).join(', ')}`)
})

await step('every name card shows how it was assembled', async () => {
  const parts = await page.$$eval('.name .parts', (e) => e.map((x) => x.textContent))
  if (parts.length < 20) throw new Error(`only ${parts.length} cards show parts`)
  if (!parts.every((p) => p.includes('+'))) throw new Error('a card had no syllable breakdown')
  console.log(`       first card assembled from: ${parts[0]}`)
})

await step('tapping a name traces it back to real source words', async () => {
  await page.click('.name')
  await page.waitForTimeout(400)
  const t = await page.textContent('#traceBox')
  if (!/came from/.test(t)) throw new Error('no trace shown')
  if (!/←/.test(t)) throw new Error('no source words in trace')
  console.log(`       trace: ${t.replace(/\s+/g, ' ').slice(0, 110)}`)
})

await step('status shows the set size after every stage', async () => {
  const stages = await page.$$eval('.status .stage', (e) => e.map((x) => x.textContent.trim()))
  if (stages.length < 2) throw new Error(`only ${stages.length} stages shown: ${stages.join(' | ')}`)
  if (!stages.some((t) => /common/.test(t))) throw new Error(`no common stage: ${stages.join(' | ')}`)
  const txt = await page.textContent('#status')
  if (!/syllables/.test(txt)) throw new Error('no syllable count')
  console.log(`       stages: ${stages.join(' -> ')}`)
})

// Exactly what he hit: + on PKD and Asimov while the two defaults were still
// included, giving a four-way intersection at the strictest setting.
await step('HIS BUG: a run-dry result names the stage that emptied it', async () => {
  await page.click('#resetBtn')
  await page.waitForTimeout(400)
  for (const id of ['pkd', 'asimov']) {
    const row = page.locator(`.author-row[data-id="${id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.locator('.plus').click()
    await page.waitForTimeout(250)
  }
  await page.click('#raritySeg button[data-rarity="1"]')
  await page.waitForTimeout(700)

  const stages = await page.$$eval('.status .stage', (e) => e.map((x) => x.textContent.trim()))
  console.log(`       4-way stages: ${stages.join(' -> ')}`)
  const n = await names()
  if (n.length === 0) {
    const why = await page.textContent('.status .why')
    if (!why || !/cut it to|share only|too few/.test(why))
      throw new Error(`empty result was not explained: "${why}"`)
    if (!(await page.$('.fix'))) throw new Error('no recovery button offered')
    console.log(`       explained: ${why.replace(/\s+/g, ' ').slice(0, 100)}`)
    await page.screenshot({ path: join(SHOTS, `${TAG}-6-explained.png`) })
    await page.click('.fix')
    await page.waitForTimeout(700)
    if (!(await names()).length) throw new Error('the offered fix did not produce names')
  } else {
    // still must show a truthful chain
    if (stages.length < 2) throw new Error('no stage chain')
  }
  await page.click('#resetBtn')
  await page.waitForTimeout(500)
})

await step('UNION of PKD and Asimov is never empty in the UI', async () => {
  await page.click('#resetBtn')
  await page.waitForTimeout(300)
  // Clear whatever the default put in, whatever that happens to be.
  for (const id of [...DEFAULT_RECIPE.include, ...DEFAULT_RECIPE.exclude]) {
    const row = page.locator(`.author-row[data-id="${id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.locator('.clr').click()
    await page.waitForTimeout(200)
  }
  for (const id of ['pkd', 'asimov']) {
    const row = page.locator(`.author-row[data-id="${id}"]`)
    await row.scrollIntoViewIfNeeded()
    await row.locator('.plus').click()
    await page.waitForTimeout(200)
  }
  await page.click('#modeSeg button[data-mode="any"]')
  await page.waitForTimeout(700)
  const n = await names()
  if (!n.length) throw new Error('PKD ∪ Asimov produced no names in the UI')
  const txt = await page.textContent('#status')
  console.log(`       PKD ∪ Asimov: ${txt.replace(/\s+/g, ' ').slice(0, 90)}`)
  console.log(`       names: ${n.slice(0, 8).join(', ')}`)
  await page.click('#resetBtn')
  await page.waitForTimeout(500)
})

await step('operator switches between ∩ and ∪', async () => {
  // Drive it away from the default first, then back, so this proves both
  // directions no matter which operator the default starts on.
  const other = DEFAULT_RECIPE.mode === 'any' ? 'all' : 'any'
  const sym = { any: '∪', all: '∩' }

  await page.click(`#modeSeg button[data-mode="${other}"]`)
  await page.waitForTimeout(600)
  if (!new RegExp(sym[other]).test(await page.textContent('#expr')))
    throw new Error(`did not switch to ${sym[other]}`)

  await page.click(`#modeSeg button[data-mode="${DEFAULT_RECIPE.mode}"]`)
  await page.waitForTimeout(600)
  if (!new RegExp(sym[DEFAULT_RECIPE.mode]).test(await page.textContent('#expr')))
    throw new Error(`did not switch back to ${sym[DEFAULT_RECIPE.mode]}`)
  if (!(await names()).length) throw new Error('no names after switching operator')
})

await step('recipe survives a reload via the url', async () => {
  const url = page.url()
  if (!/#/.test(url)) throw new Error('no recipe in url')
  const exprBefore = await page.textContent('#expr')
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.name', { timeout: 20000 })
  const exprAfter = await page.textContent('#expr')
  if (exprAfter !== exprBefore) throw new Error(`expr "${exprBefore}" -> "${exprAfter}"`)
})

await step('no horizontal overflow at 390px', async () => {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (over > 0) throw new Error(`${over}px of horizontal scroll`)
})

await step('roll button is reachable and big enough', async () => {
  const b = await page.locator('#rollBtn').boundingBox()
  if (!b || b.height < 44) throw new Error(`roll button ${JSON.stringify(b)}`)
})

// a long scroll shot for the report
await page.setViewportSize({ width: 390, height: 1400 })
await page.waitForTimeout(300)
await page.screenshot({ path: join(SHOTS, `${TAG}-5-full.png`), fullPage: true })

await browser.close()

console.log(`\nconsole errors:   ${errors.length}`)
for (const e of errors) console.log('   ! ' + e)
console.log(`console warnings: ${warnings.length}`)
for (const w of warnings.slice(0, 5)) console.log('   ~ ' + w)
console.log(`screenshots in ${SHOTS}`)
process.exit(errors.length ? 1 : 0)
