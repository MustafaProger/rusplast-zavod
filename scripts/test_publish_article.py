"""Publisher validation and retry checks; no network, build or deployment runs.

Run with: python3 -m unittest discover -s scripts -p 'test_publish_article.py' -v
"""
from contextlib import ExitStack, redirect_stdout
from copy import deepcopy
from datetime import date, timedelta
from html import escape
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'publish_article', Path(__file__).with_name('publish-article.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def article_fixture():
    # Synthetic prose exercises the publication contract, not editorial quality.
    paragraph = ' '.join(['Проверка характеристик трубы перед заказом по проекту.'] * 14)
    return {
        'slug': 'proverka-gofry-pered-zakazom',
        'title': 'Гофра "ПВХ": диаметр < 32 мм & требования проекта',
        'seoTitle': 'Как проверить характеристики гофротрубы перед заказом',
        'description': 'Проверяем материал, диаметр и исполнение гофротрубы перед закупкой. '
                       'Сопоставляем спецификацию, маркировку и документы выбранной поставки.',
        'category': 'Выбор трубы', 'image': 'generated-cover',
        'imageAlt': 'Серая гофрированная труба ПВХ с зондом',
        'intro': 'Проверьте характеристики выбранного исполнения перед закупкой.',
        'takeaway': 'Сопоставляйте документы и требования проекта.',
        'publishedAt': date.today().isoformat(),
        'author': 'Редакция РУСПЛАСТЗАВОДА',
        'sections': [
            {'id': f'section-{index}', 'title': f'Проверка {index}',
             'paragraphs': [paragraph], 'links': []}
            for index in range(5)
        ],
        'sources': [{'label': 'Документ производителя',
                     'href': 'https://example.org/specification'}],
        'related': ['gofra-pvh-ili-pnd', 'dokumenty-na-gofrotrubu'],
    }


def context_fixture():
    return {
        'approvedImages': [{'image': 'generated-cover'}, {'image': 'pipe-black'}],
        'internalPaths': ['/', '/catalog', '/catalog/pvh', '/catalog/aksessuary', '/blog', '/#contacts', '/#certificates', '/#about', '/#delivery', '/#request'],
        'documents': ['/documents/pvh.pdf'],
        'articles': [
            {'slug': 'gofra-pvh-ili-pnd', 'title': 'ПВХ или ПНД'},
            {'slug': 'dokumenty-na-gofrotrubu', 'title': 'Документы на гофротрубу'},
        ],
    }


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.article = article_fixture()
        self.article['sections'][0]['links'] = [
            {'label': 'Каталог', 'href': '/catalog'},
            {'label': 'Трубы ПВХ', 'href': '/catalog/pvh'},
            {'label': 'Документ', 'href': '/documents/pvh.pdf'},
        ]
        self.context = context_fixture()
        self.responses = {}
        mocks = ExitStack()
        self.addCleanup(mocks.close)
        self.urlopen = mocks.enter_context(patch.object(
            publisher, 'urlopen', side_effect=self.mock_urlopen))
        self.command_run = mocks.enter_context(patch.object(
            publisher, 'run', side_effect=AssertionError('External commands forbidden in tests')))

    def mock_urlopen(self, url, timeout):
        self.assertEqual(timeout, 30)
        self.assertTrue(url.startswith(publisher.ORIGIN + '/'))
        path = url.removeprefix(publisher.ORIGIN)
        if path not in self.responses:
            raise AssertionError('Unexpected network request: ' + path)
        response = self.responses[path]
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(response)

    def live_article(self, *, article_hash=None, heading=None):
        article = self.article
        self.responses = {
            '/publication-manifest.json': json.dumps({
                'release': 'test-release',
                'articles': {article['slug']: {
                    'sha256': article_hash or publisher.digest(article)}}
            }).encode(),
            '/blog/' + article['slug']: (
                '<!doctype html><h1>' + escape(heading or article['title']) + '</h1><img src="' + article['image'] + '">'
            ).encode(),
            '/sitemap.xml': (
                '<urlset><url><loc>' + publisher.ORIGIN + '/blog/' + article['slug']
                + '</loc></url></urlset>'
            ).encode(),
        }

    def main_in(self, directory, current):
        root = Path(directory)
        image = root / 'cover.png'
        image.write_bytes(b'test-fixture-only')
        data = root / 'legacy-articles.json'
        article_path = root / 'article.json'
        data.write_text(json.dumps(current, ensure_ascii=False))
        article_path.write_text(json.dumps(self.article, ensure_ascii=False))
        output = io.StringIO()
        with patch.object(publisher, 'ROOT', root), \
                patch.object(publisher, 'inspect_cover', return_value={'sha256': '1' * 64}), \
                patch.object(publisher, 'publish_cms', return_value={'article': self.article, 'inputSha256': '2' * 64}), \
                patch.object(publisher, 'context', return_value=deepcopy(self.context)), \
                patch.object(sys, 'argv', ['publish-article.py', '--article', str(article_path), '--image', str(image)]), \
                redirect_stdout(output):
            publisher.main()
        return json.loads(output.getvalue()), json.loads(data.read_text())

    def test_valid_article_accepts_known_document_and_metadata(self):
        publisher.validate(self.article, self.context)
        self.urlopen.assert_not_called()

    def test_invalid_source_schemes_and_hosts_are_rejected(self):
        for href in ('javascript:alert(1)', 'http://example.org/specification',
                     '//example.org/specification', 'https://user@example.org/document',
                     'https://example.org/a b'):
            with self.subTest(href=href):
                article = deepcopy(self.article)
                article['sources'][0]['href'] = href
                with self.assertRaisesRegex(ValueError, 'HTTPS source URLs'):
                    publisher.validate(article, self.context)

    def test_generic_images_are_rejected(self):
        for image in ('blog-generated', '/images/products/2021001.webp',
                      'https://example.org/photo.jpg'):
            with self.subTest(image=image):
                article = deepcopy(self.article)
                article['image'] = image
                with self.assertRaisesRegex(ValueError, 'newly generated article cover'):
                    publisher.validate(article, self.context)

    def test_unknown_internal_path_is_rejected(self):
        self.article['sections'][0]['links'][0]['href'] = '/catalog/missing#selection'
        with self.assertRaisesRegex(ValueError, 'Unknown internal link'):
            publisher.validate(self.article, self.context)

    def test_unknown_home_anchor_is_rejected(self):
        self.article['sections'][0]['links'][0]['href'] = '/#invented-section'
        with self.assertRaisesRegex(ValueError, 'Unknown internal link'):
            publisher.validate(self.article, self.context)

    def test_real_home_anchor_is_accepted(self):
        self.article['sections'][0]['links'][0]['href'] = '/#certificates'
        publisher.validate(self.article, self.context)

    def test_path_traversal_slug_is_rejected(self):
        self.article['slug'] = '../catalog'
        with self.assertRaisesRegex(ValueError, 'Invalid article slug'):
            publisher.validate(self.article, self.context)

    def test_future_publication_is_rejected(self):
        self.article['publishedAt'] = (date.today() + timedelta(days=1)).isoformat()
        with self.assertRaisesRegex(ValueError, 'Future publication date'):
            publisher.validate(self.article, self.context)

    def test_live_receipt_decodes_html_entities_in_title(self):
        self.live_article()
        expected = {'url': publisher.ORIGIN + '/blog/' + self.article['slug'],
                    'slug': self.article['slug'], 'sha256': publisher.digest(self.article),
                    'release': 'test-release'}
        self.assertEqual(publisher.receipt_for(self.article), expected)
        self.assertEqual(publisher.receipt_for(self.article), expected)
        self.command_run.assert_not_called()

    def test_live_receipt_rejects_wrong_digest_before_reading_page(self):
        self.live_article(article_hash='0' * 64)
        self.assertIsNone(publisher.receipt_for(self.article))
        self.assertEqual(self.urlopen.call_count, 1)

    def test_live_receipt_rejects_wrong_heading(self):
        self.live_article(heading='Заголовок другого релиза')
        self.assertIsNone(publisher.receipt_for(self.article))

    def test_live_receipt_requires_sitemap_entry(self):
        self.live_article()
        self.responses['/sitemap.xml'] = b'<urlset></urlset>'
        self.assertIsNone(publisher.receipt_for(self.article))

    def test_live_receipt_requires_the_cms_cover_on_the_page(self):
        self.live_article()
        self.responses['/blog/' + self.article['slug']] = self.responses['/blog/' + self.article['slug']].replace(self.article['image'].encode(), b'wrong-image')
        self.assertIsNone(publisher.receipt_for(self.article))

    def test_live_receipt_handles_network_failure_without_receipt(self):
        self.responses['/publication-manifest.json'] = OSError('Simulated unavailable site')
        self.assertIsNone(publisher.receipt_for(self.article))
        self.assertEqual(self.urlopen.call_count, 3)

    def test_bound_curl_failure_is_retried_and_leaves_receipt_pending(self):
        for error in (publisher.subprocess.CalledProcessError(28, ['curl']),
                      publisher.subprocess.TimeoutExpired(['curl'], 35)):
            with self.subTest(error=type(error).__name__), \
                    patch.dict(publisher.os.environ, {'RUSPLAST_NETWORK_INTERFACE': 'en0'}), \
                    patch.object(publisher.subprocess, 'run', side_effect=error) as command:
                self.assertIsNone(publisher.receipt_for(self.article))
                self.assertEqual(command.call_count, 3)
                self.assertIn('--interface', command.call_args.args[0])
        self.urlopen.assert_not_called()

    def test_bound_curl_recovers_after_transient_failure(self):
        responses = [publisher.subprocess.CalledProcessError(28, ['curl']),
                     publisher.subprocess.CompletedProcess(['curl'], 0, stdout=b'live-response')]
        with patch.dict(publisher.os.environ, {'RUSPLAST_NETWORK_INTERFACE': 'en0'}), \
                patch.object(publisher.subprocess, 'run', side_effect=responses) as command:
            self.assertEqual(publisher.fetch('/publication-manifest.json'), b'live-response')
            self.assertEqual(command.call_count, 2)
        self.urlopen.assert_not_called()

    def test_cms_publication_never_changes_legacy_article_json(self):
        self.live_article()
        for current in ([self.article], []):
            with self.subTest(legacy_present=bool(current)), tempfile.TemporaryDirectory() as directory:
                receipt, stored = self.main_in(directory, current)
                self.assertEqual(receipt['release'], 'test-release')
                self.assertEqual(stored, current)
        self.command_run.assert_not_called()

    def test_transfer_sets_host_owner_and_preserves_it_in_restricted_container(self):
        bundle = {'article': self.article, 'inputSha256': 'ab' * 32}
        calls = []
        def capture(args, **kwargs):
            calls.append([str(arg) for arg in args])
            self.assertIn('IPQoS=none', args)
            if args[0] == 'scp':
                with tarfile.open(args[-2]) as archive:
                    self.assertEqual(archive.getnames(), ['article.json', 'cover.png'])
                    self.assertEqual(json.load(archive.extractfile('article.json')), bundle)
                    self.assertEqual(archive.extractfile('cover.png').read(), b'generated-png-fixture')
        self.command_run.side_effect = capture
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'cover.png'
            image.write_bytes(b'generated-png-fixture')
            with publisher.cms_transfer_inputs(bundle, image) as (ssh, remote):
                self.assertEqual(remote, '/tmp/rusplast-editorial-' + 'ab' * 32)
                self.assertEqual(ssh[0], 'ssh')
        transfer, cleanup = calls[1][-1], calls[2][-1]
        self.assertLess(transfer.index('chown -R 1000:1000'), transfer.index('docker cp -a'))
        self.assertIn('chmod 600', transfer)
        self.assertIn('docker exec --user 1000:1000 rusplast-cms-1 rm -rf', cleanup)
        self.assertNotIn('docker exec -u root', transfer + cleanup)
        self.assertNotIn('docker exec --user root', transfer + cleanup)
        self.assertNotIn(self.article['title'], transfer + cleanup)

    def test_transfer_cleans_up_as_node_when_publication_fails(self):
        self.command_run.side_effect = None
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'cover.png'
            image.write_bytes(b'fixture')
            with self.assertRaisesRegex(RuntimeError, 'publication failed'):
                with publisher.cms_transfer_inputs({'inputSha256': 'a' * 64}, image):
                    raise RuntimeError('publication failed')
        cleanup = self.command_run.call_args.args[0][-1]
        self.assertIn('docker exec --user 1000:1000 rusplast-cms-1 rm -rf', cleanup)

    def test_cover_is_required_even_for_validation(self):
        with self.assertRaisesRegex(ValueError, 'Generated cover file required'):
            publisher.inspect_cover(None)

    def test_legacy_stock_image_cannot_be_published(self):
        self.article['image'] = 'pipe-gray'
        with self.assertRaisesRegex(ValueError, 'newly generated'):
            publisher.validate(self.article, self.context)


if __name__ == '__main__':
    unittest.main()
