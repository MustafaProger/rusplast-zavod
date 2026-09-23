import nodemailer from 'nodemailer'
import type { Core } from '@strapi/strapi'

type Lead = {
  documentId: string
  name: string
  phone: string
  email: string
  comment?: string
  products: Array<{ sku: string; name?: string; quantity: number; coilLength?: number; pricePerMeter?: number }>
}

export function notificationText(lead: Lead) {
  const products = lead.products.map((item, index) => {
    const meters = Number.isFinite(item.coilLength) && item.coilLength! > 0 ? item.coilLength! * item.quantity : null
    const amount = meters !== null && Number.isFinite(item.pricePerMeter) && item.pricePerMeter! >= 0 ? meters * item.pricePerMeter! : null
    return `${index + 1}. ${item.name || 'Товар'} — арт. ${item.sku}\nКоличество: ${item.quantity} бухт${meters !== null ? ` · ${meters} м` : ''}${amount !== null ? ` · предварительно ${amount.toLocaleString('ru-RU')} ₽` : ''}`
  })
  return [
    'Новая заявка с сайта РУСПЛАСТЗАВОД',
    `Номер: ${lead.documentId}`,
    `Имя: ${lead.name}`, `Телефон: ${lead.phone}`, `Email: ${lead.email}`,
    `Комментарий: ${lead.comment || 'Не указан'}`,
    '', 'Товары:', products.length ? products.join('\n\n') : 'Без выбранных товаров — запрос консультации.',
    '', 'Стоимость предварительная, по данным каталога на момент заявки. Цены, объём и доставку нужно согласовать с клиентом.',
  ].join('\n')
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async send(lead: Lead) {
    let messageId: string
    try {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.LEAD_EMAIL_TO) throw new Error('SMTP_NOT_CONFIGURED')
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.mail.ru',
        port: Number(process.env.SMTP_PORT || 465),
        secure: process.env.SMTP_SECURE !== 'false',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
        logger: false, debug: false,
      })
      try {
        const info = await transport.sendMail({
          from: { name: 'РУСПЛАСТЗАВОД — заявки', address: process.env.SMTP_USER },
          to: process.env.LEAD_EMAIL_TO,
          replyTo: lead.email,
          subject: `Новая заявка РУСПЛАСТЗАВОД №${lead.documentId}`,
          text: notificationText(lead),
          disableFileAccess: true, disableUrlAccess: true,
        })
        if (!info.accepted.length || info.rejected.length) throw new Error('SMTP_RECIPIENT_REJECTED')
        messageId = info.messageId
      } finally {
        transport.close()
      }
    } catch {
      // Never log provider errors: they may include authentication or customer data.
      strapi.log.error(`Lead ${lead.documentId}: email notification failed; request remains saved in CMS`)
      await strapi.documents('api::lead.lead').update({
        documentId: lead.documentId, data: { notificationStatus: 'Ошибка отправки' },
      })
      return
    }
    // SMTP acceptance is recorded separately from actual mailbox delivery.
    await strapi.documents('api::lead.lead').update({
      documentId: lead.documentId,
      data: { notificationStatus: 'Принято SMTP', notificationSentAt: new Date().toISOString(), notificationMessageId: messageId },
    })
  },
})
