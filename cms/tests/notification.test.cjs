// Run after `npm run build --prefix cms`: node --test cms/tests/notification.test.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const importedMailer = require('nodemailer')
const nodemailer = importedMailer.default || importedMailer
const notification = require('../dist/src/api/lead/services/notification.js')

test('Notification preserves contacts and quantities; failure does not lose the saved lead', async () => {
  const lead = { documentId: 'test-only', name: 'Тест', phone: '+70000000000', email: 'client@example.test', comment: '<b>Комментарий</b>', products: [{ sku: 'SKU-1', name: 'Труба', quantity: 2, coilLength: 50, pricePerMeter: 10 }] }
  const text = notification.notificationText(lead)
  assert.match(text, /100 м/)
  assert.match(text, /SKU-1/)
  assert.match(text, /client@example.test/)
  assert.match(text, /<b>Комментарий<\/b>/)
  const saved = []
  const logs = []
  const service = notification.default({ strapi: {
    documents: () => ({ update: async (value) => saved.push(value) }),
    log: { error: (message) => logs.push(message) },
  } })
  const oldTransport = nodemailer.createTransport
  const oldEnv = { ...process.env }
  try {
    process.env.SMTP_USER = 'sender@example.test'
    process.env.SMTP_PASSWORD = 'fake-test-secret'
    process.env.LEAD_EMAIL_TO = 'owner@example.test'
    nodemailer.createTransport = () => ({
      close() {},
      async sendMail(mail) {
        assert.equal(mail.to, 'owner@example.test')
        assert.equal(mail.replyTo, lead.email)
        assert.equal(mail.html, undefined)
        assert.equal(mail.disableFileAccess, true)
        return { accepted: ['owner@example.test'], rejected: [], messageId: '<test@example.test>' }
      },
    })
    await service.send(lead)
    assert.equal(saved[0].data.notificationStatus, 'Принято SMTP')
    assert.equal(saved[0].data.notificationMessageId, '<test@example.test>')
    nodemailer.createTransport = () => ({ close() {}, async sendMail() { throw new Error('fake-test-secret') } })
    await service.send(lead)
    assert.equal(saved[1].data.notificationStatus, 'Ошибка отправки')
    assert.equal(saved[1].documentId, lead.documentId)
    assert.ok(logs.every(value => !value.includes('fake-test-secret')))
  } finally {
    nodemailer.createTransport = oldTransport
    for (const key of ['SMTP_USER', 'SMTP_PASSWORD', 'LEAD_EMAIL_TO']) {
      if (oldEnv[key] === undefined) delete process.env[key]
      else process.env[key] = oldEnv[key]
    }
  }
})
