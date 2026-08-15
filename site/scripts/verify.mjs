#!/usr/bin/env node
// Drive the real site in a real browser at phone size, exercise every control,
// and fail loudly on any console error. Usage: node scripts/verify.mjs [url]
import { pathToFileURL } from 'url'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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

await step('tap a name copies it', async () => {
  await page.click('.name')
  await page.waitForSelector('.toast.show', { timeout: 3000 })
  const t = await page.textContent('#toast')
  if (!/copied/.test(t)) throw new Error(`toast said "${t}"`)
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
  await page.click('#raritySeg button[data-rarity="2"]')
  await page.waitForTimeout(500)
})

await step('author sheet opens with grouped chips', async () => {
  await page.click('#pickBtn')
  await page.waitForSelector('.chip', { timeout: 3000 })
  const c = await page.$$eval('.chip', (e) => e.length)
  if (c < 30) throw new Error(`only ${c} chips`)
  await page.screenshot({ path: join(SHOTS, `${TAG}-2-authors.png`) })
})

await step('chip cycles include -> exclude -> off', async () => {
  const chip = page.locator('.chip[data-id="shakespeare"]')
  await chip.click()
  await page.waitForTimeout(300)
  if ((await chip.getAttribute('data-state')) !== 'inc') throw new Error('not include')
  await chip.click()
  await page.waitForTimeout(300)
  if ((await chip.getAttribute('data-state')) !== 'exc') throw new Error('not exclude')
  await chip.click()
  await page.waitForTimeout(300)
  if (await chip.getAttribute('data-state')) throw new Error('not cleared')
})

await step('picking a fresh recipe regenerates', async () => {
  // clear the defaults, then pick Shakespeare + Bible
  for (const id of ['lovecraft', 'stoker']) {
    const c = page.locator(`.chip[data-id="${id}"]`)
    await c.click()
    await page.waitForTimeout(120)
    await c.click()
    await page.waitForTimeout(120)
  }
  await page.click('.chip[data-id="shakespeare"]')
  await page.waitForTimeout(150)
  await page.click('.chip[data-id="bible"]')
  await page.waitForTimeout(400)
  await page.click('#sheet .sheet-head [data-close]')
  await page.waitForTimeout(400)
  const n = await names()
  if (!n.length) throw new Error('no names for Shakespeare + Bible')
  console.log(`       Shakespeare n Bible: ${n.slice(0, 8).join(', ')}`)
  await page.screenshot({ path: join(SHOTS, `${TAG}-3-shakespeare-bible.png`) })
})

await step('mode dial switches overlap/mixed', async () => {
  await page.click('#modeSeg button[data-mode="any"]')
  await page.waitForTimeout(600)
  const n = await names()
  if (!n.length) throw new Error('no names in mixed mode')
})

await step('recipe survives a reload via the url', async () => {
  const url = page.url()
  if (!/#/.test(url)) throw new Error('no recipe in url')
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.name', { timeout: 20000 })
  const pills = await page.$$eval('.pill', (e) => e.map((x) => x.textContent))
  if (!pills.some((p) => /Shakespeare/.test(p))) throw new Error(`pills were ${pills.join('|')}`)
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
