// Isolated local QA. Every lead request is stubbed; every external request,
// including the production Metrika counter, is blocked before navigation.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { trackGoal } from '../src/lib/analytics.ts'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const port = 5189
const base = `http://127.0.0.1:${port}`
const sample = { name: 'QA_PRIVATE_NAME', phone: '+79990000123', email: 'qa-private@example.test', comment: 'QA_PRIVATE_COMMENT' }
const allowedGoals = ['lead_submit_success', 'lead_form_open', 'lead_form_start', 'product_add', 'contact_phone_click', 'contact_email_click']
const completed = []

assert.doesNotThrow(() => trackGoal('lead_submit_success'))
const unitCalls = []
globalThis.window = { ym: (...args) => unitCalls.push(args) }
trackGoal('lead_submit_success', { form_location: 'modal', items_count: 2, ...sample })
assert.deepEqual(unitCalls, [[113120530, 'reachGoal', 'lead_submit_success', { form_location: 'modal', items_count: 2 }]])
globalThis.window.ym = () => { throw new Error('Counter unavailable') }
assert.doesNotThrow(() => trackGoal('lead_submit_success'))
delete globalThis.window
completed.push('SSR safety, strict parameter allowlist, analytics exception isolation')

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: webRoot, env: { ...process.env, VITE_CMS_URL: 'https://cms.example.test' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
server.stdout.on('data', data => { serverOutput += data })
server.stderr.on('data', data => { serverOutput += data })
let browser

async function openPage({ path = '/', response = 'success', counter = 'capture' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const state = { posts: 0, blocked: 0 }
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/leads') {
      state.posts += 1
      assert.equal(request.method(), 'POST')
      const data = request.postDataJSON().data
      assert.equal(data.name, sample.name)
      assert.equal(data.consent, true)
      if (response === 'network') return route.abort('failed')
      if (response === 'error') return route.fulfill({ status: 500, json: { error: 'stubbed failure' } })
      if (response === 'unconfirmed') return route.fulfill({ status: 201, json: { data: {} } })
      // Exercise the in-flight duplicate guard before confirming persistence.
      await new Promise(resolve => setTimeout(resolve, 100))
      return route.fulfill({ status: 201, json: { data: { documentId: 'qa-stub-saved-lead' } } })
    }
    if (url.pathname === '/api/products') return route.fulfill({ status: 503, json: { error: 'use local catalog snapshot' } })
    if (url.origin === base) return route.continue()
    state.blocked += 1
    return route.abort('blockedbyclient')
  })
  await page.addInitScript(({ counter }) => {
    window.__qaGoals = []
    window.ym = (...args) => {
      if (args[1] === 'reachGoal') {
        if (counter === 'throws') throw new Error('QA blocked counter')
        window.__qaGoals.push(args)
      }
    }
  }, { counter })
  await page.goto(base + path, { waitUntil: 'networkidle' })
  if (counter === 'missing') await page.evaluate(() => { delete window.ym })
  return { page, state }
}

async function goals(page, name) {
  return page.evaluate(goal => window.__qaGoals.filter(call => !goal || call[2] === goal), name)
}

async function fillForm(form) {
  for (const [name, value] of Object.entries(sample)) await form.locator(`[name="${name}"]`).fill(value)
  await form.locator('[name="consent"]').check()
  assert.equal(await form.locator('input:not([type="checkbox"]), textarea').count(), await form.locator('.ym-disable-keys').count())
  assert.ok(await form.evaluate(element => element.classList.contains('ym-hide-content')))
}

async function assertPrivateEvents(page) {
  const calls = await goals(page)
  for (const [counter, method, name, params] of calls) {
    assert.equal(counter, 113120530)
    assert.equal(method, 'reachGoal')
    assert.ok(allowedGoals.includes(name))
    assert.ok(Object.keys(params).every(key => ['form_location', 'items_count'].includes(key)))
  }
  const serialized = JSON.stringify(calls)
  for (const value of [...Object.values(sample), 'qa-stub-saved-lead', 'utm_', 'https://']) assert.ok(!serialized.includes(value))
}

try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Local Vite exited: ${serverOutput}`)
    if (serverOutput.includes(`127.0.0.1:${port}`)) break
    if (attempt === 99) throw new Error(`Local Vite did not start: ${serverOutput}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) })

  const { page: success, state: saved } = await openPage({ path: '/?utm_campaign=QA_PRIVATE_COMMENT' })
  await success.getByRole('button', { name: 'Рассчитать поставку', exact: true }).click()
  const modal = success.locator('.request-modal')
  assert.equal((await goals(success, 'lead_form_open')).filter(call => call[3].form_location === 'modal').length, 1)
  const form = modal.locator('form')
  await fillForm(form)
  assert.equal((await goals(success, 'lead_form_start')).length, 1)
  await form.evaluate(element => { element.requestSubmit(); element.requestSubmit() })
  await modal.getByText('Заявка принята.', { exact: true }).waitFor()
  assert.equal(saved.posts, 1)
  assert.deepEqual(await goals(success, 'lead_submit_success'), [[113120530, 'reachGoal', 'lead_submit_success', { form_location: 'modal', items_count: 0 }]])
  assert.ok(await modal.locator('.form-success').evaluate(element => element.classList.contains('ym-hide-content')))
  await assertPrivateEvents(success)
  assert.ok(saved.blocked > 0, 'Production analytics script must be intercepted')
  await modal.getByRole('button', { name: 'Готово' }).click()
  await success.getByRole('button', { name: 'Рассчитать поставку', exact: true }).click()
  assert.equal((await goals(success, 'lead_form_open')).filter(call => call[3].form_location === 'modal').length, 2)
  assert.equal((await goals(success, 'lead_submit_success')).length, 1)
  await success.close()
  completed.push('Modal save confirmation, in-flight duplicate guard, one start per fill, one open per modal opening, no PII or lead ID')

  for (const response of ['error', 'unconfirmed', 'network']) {
    const { page, state } = await openPage({ response })
    const inline = page.locator('#request form')
    await inline.scrollIntoViewIfNeeded()
    await fillForm(inline)
    await inline.getByRole('button', { name: 'Отправить заявку' }).click()
    await inline.getByRole('alert').waitFor()
    assert.equal(state.posts, 1)
    assert.equal((await goals(page, 'lead_submit_success')).length, 0)
    assert.equal((await goals(page, 'lead_form_open')).filter(call => call[3].form_location === 'inline').length, 1)
    assert.equal(await inline.locator('[name="name"]').inputValue(), sample.name)
    await assertPrivateEvents(page)
    await page.close()
  }
  completed.push('HTTP failure, missing persistence confirmation and network failure never report success; form contents retained')

  for (const counter of ['missing', 'throws']) {
    const { page, state } = await openPage({ counter })
    const inline = page.locator('#request form')
    await fillForm(inline)
    await inline.getByRole('button', { name: 'Отправить заявку' }).click()
    await page.getByText('Заявка принята.', { exact: true }).waitFor()
    assert.equal(state.posts, 1)
    await page.close()
  }
  completed.push('Missing or throwing counter does not prevent a successfully saved form from showing success')

  const { page: catalog, state: catalogState } = await openPage({ path: '/catalog' })
  const add = catalog.locator('.request-button').first()
  await add.click()
  await add.click()
  assert.equal((await goals(catalog, 'product_add')).length, 1)
  await add.click()
  assert.equal((await goals(catalog, 'product_add')).length, 2)
  await catalog.locator('.floating-request').click()
  await fillForm(catalog.locator('.request-modal form'))
  await catalog.locator('.request-modal').getByRole('button', { name: 'Отправить заявку' }).click()
  await catalog.locator('.request-modal').getByText('Заявка принята.', { exact: true }).waitFor()
  assert.equal(catalogState.posts, 1)
  assert.deepEqual(await goals(catalog, 'lead_submit_success'), [[113120530, 'reachGoal', 'lead_submit_success', { form_location: 'modal', items_count: 1 }]])
  await catalog.locator('.request-modal').getByRole('button', { name: 'Готово' }).click()
  await catalog.evaluate(() => {
    document.addEventListener('click', event => event.preventDefault(), { once: true })
    document.querySelector('.header-phone').click()
  })
  assert.equal((await goals(catalog, 'contact_phone_click')).length, 1)
  await assertPrivateEvents(catalog)
  await catalog.close()

  const { page: contacts } = await openPage()
  await contacts.evaluate(() => {
    document.addEventListener('click', event => event.preventDefault(), { once: true })
    document.querySelector('a[href^="mailto:"]').click()
  })
  assert.equal((await goals(contacts, 'contact_email_click')).length, 1)
  await assertPrivateEvents(contacts)
  await contacts.close()
  completed.push('Add/remove/re-add counts additions only; saved product request reports count; phone and email clicks are separate goals')
  console.log(JSON.stringify({ passed: completed, liveLeadRequests: 0, externalNetworkRequestsAllowed: 0 }, null, 2))
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
