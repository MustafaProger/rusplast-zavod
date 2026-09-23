import { createHash } from 'node:crypto'
import consentDocument from './consent.json'

export const CONSENT_VERSION = consentDocument.version
// Archive the document that is actually shown by the frontend, not client text.
export const CONSENT_TEXT = [consentDocument.title, `Редакция ${consentDocument.version}`, ...consentDocument.sections.flat()].join('\n\n')
export const CONSENT_TEXT_SHA256 = createHash('sha256').update(CONSENT_TEXT, 'utf8').digest('hex')

export function consentEvidence(now = new Date()) {
  const expiresAt = new Date(now)
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)
  return {
    consent: true,
    consentVersion: CONSENT_VERSION,
    consentedAt: now.toISOString(),
    consentText: CONSENT_TEXT,
    consentTextSha256: CONSENT_TEXT_SHA256,
    consentMethod: 'separate-unchecked-checkbox-and-submit',
    retentionExpiresAt: expiresAt.toISOString(),
  }
}
