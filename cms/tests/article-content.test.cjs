const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateArticleContent } = require('../dist/src/api/article/content-types/article/lifecycles.js')
const seed = require('../src/data/content-migration.json')

test('Every migrated article satisfies CMS content structure', () => {
  for (const article of seed.articles) assert.doesNotThrow(() => validateArticleContent(article))
})

test('CMS rejects malformed JSON sections, sources, tables and duplicate anchors', () => {
  for (const sections of [{}, ['string'], [{ id: 'a', title: 'Title', paragraphs: 'paragraph' }], [{ id: 'a', title: 'Title', paragraphs: [], table: { rows: 'bad' } }], [{ id: 'a', title: '1', paragraphs: [] }, { id: 'a', title: '2', paragraphs: [] }]]) {
    assert.throws(() => validateArticleContent({ sections }), /Разделы/)
  }
  assert.throws(() => validateArticleContent({ sources: {} }), /Источники/)
  assert.throws(() => validateArticleContent({ related: [42] }), /Связанные/)
})

test('CMS accepts only root-relative and HTTP(S) links', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '//example.test', '/\\example.test', ' https://example.test', 'http://', 'https://exa\nmple.test']) {
    assert.throws(() => validateArticleContent({ sources: [{ label: 'Source', href }] }), /Источники/)
  }
  for (const href of ['/', '/catalog/pvh', '/documents/test.pdf#page=2', 'https://example.test/reference', 'http://example.test']) {
    assert.doesNotThrow(() => validateArticleContent({ sources: [{ label: 'Source', href }] }))
  }
})
