#!/usr/bin/env python3
"""Validate an editorial JSON document and unique cover, then publish to Strapi CMS.

Artel Operator calls this fixed command; generated prose is never executed.
The last stdout line is the publication receipt. Build logs go to stderr.
"""
import argparse
from contextlib import contextmanager
from datetime import date
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import struct
import zlib
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://rusplast-zavod.ru'
SSH_HOST = 'root@130.49.151.239'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(article):
    return hashlib.sha256(canonical(article).encode()).hexdigest()


def run(args, *, cwd=ROOT, capture=False, env=None):
    result = subprocess.run([str(arg) for arg in args], cwd=cwd, env=env,
                            stdout=subprocess.PIPE if capture else sys.stderr,
                            stderr=sys.stderr, text=True, check=True, timeout=900)
    return result.stdout if capture else None


def context():
    return json.loads(run(['node', ROOT / 'scripts/editorial-context.mjs'], capture=True))


def validate(article, ctx):
    if not isinstance(article, dict):
        raise ValueError('Article must be a JSON object')
    required = ['slug', 'title', 'seoTitle', 'description', 'category', 'image', 'imageAlt',
                'intro', 'takeaway', 'publishedAt', 'author']
    for key in required:
        value = article.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > 4000:
            raise ValueError('Invalid text field: ' + key)
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', article['slug']) or len(article['slug']) > 110:
        raise ValueError('Invalid article slug')
    if date.fromisoformat(article['publishedAt']) > date.today():
        raise ValueError('Future publication date')
    if article.get('modifiedAt'):
        date.fromisoformat(article['modifiedAt'])
    if article['author'] != 'Редакция РУСПЛАСТЗАВОДА':
        raise ValueError('Use the actual editorial author')
    if article['image'] != 'generated-cover':
        raise ValueError('A newly generated article cover is required')
    if not 35 <= len(article['seoTitle']) <= 110 or not 90 <= len(article['description']) <= 250:
        raise ValueError('Missing or excessive search metadata')
    sections = article.get('sections')
    if not isinstance(sections, list) or not 5 <= len(sections) <= 16:
        raise ValueError('Expected 5 to 16 substantive sections')
    paths = set(ctx['internalPaths']) | set(ctx['documents'])
    paths.add('/blog/' + article['slug'])
    internal = set()

    def check_links(links):
        if not isinstance(links, list):
            raise ValueError('Links must be a list')
        for link in links:
            if not isinstance(link, dict) or not isinstance(link.get('label'), str) or not link['label'].strip():
                raise ValueError('Invalid link label')
            href = link.get('href', '')
            if not isinstance(href, str):
                raise ValueError('Invalid URL')
            if href.startswith('/') and not href.startswith('//'):
                if href not in paths:
                    raise ValueError('Unknown internal link: ' + href)
                internal.add(href)
            elif not re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::443)?(?:/[^\s<>]*)?', href):
                raise ValueError('Only known local links and HTTPS source URLs are allowed')

    text = [article['intro'], article['takeaway']]
    ids = set()
    for section in sections:
        if not isinstance(section, dict):
            raise ValueError('Invalid section')
        sid = section.get('id', '')
        if not isinstance(sid, str) or not re.fullmatch(r'[a-z][a-z0-9-]*', sid) or sid in ids:
            raise ValueError('Invalid or duplicate section anchor')
        ids.add(sid)
        paragraphs = section.get('paragraphs')
        if not isinstance(section.get('title'), str) or not isinstance(paragraphs, list) or not paragraphs:
            raise ValueError('Section needs heading and paragraphs')
        values = [section['title'], *paragraphs, *section.get('list', [])]
        table = section.get('table')
        if table:
            if not isinstance(table, dict) or not isinstance(table.get('caption'), str) or not isinstance(table.get('headings'), list) or not isinstance(table.get('rows'), list):
                raise ValueError('Invalid table')
            if not table['headings'] or any(not isinstance(row, list) or len(row) != len(table['headings']) for row in table['rows']):
                raise ValueError('Table columns must match')
            values += [table['caption'], *table['headings'], *[cell for row in table['rows'] for cell in row]]
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise ValueError('Editorial content must be non-empty text')
        text += values
        check_links(section.get('links', []))
    if len(' '.join(text).split()) < 450:
        raise ValueError('Article lacks substantive coverage')
    sources = article.get('sources')
    if not sources:
        raise ValueError('Verified sources are required')
    check_links(sources)
    if len(internal) < 3:
        raise ValueError('At least three relevant internal links required')
    related = article.get('related')
    known = {item['slug'] for item in ctx['articles']}
    if not isinstance(related, list) or not 2 <= len(related) <= 4 or any(slug not in known or slug == article['slug'] for slug in related):
        raise ValueError('Choose two to four existing related articles')
    for existing in ctx['articles']:
        if existing['slug'] != article['slug'] and existing['title'].casefold() == article['title'].casefold():
            raise ValueError('Duplicate article title')


def inspect_cover(path):
    if not path or not path.is_file() or not 80_000 <= path.stat().st_size <= 30_000_000:
        raise ValueError('Generated cover file required (80 KB to 30 MB)')
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError('Generated cover must be native PNG')
    offset, width, height, ended = 8, 0, 0, False
    while offset + 12 <= len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError('Truncated cover PNG')
        kind, chunk = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + length]
        if zlib.crc32(kind + chunk) & 0xffffffff != struct.unpack('>I', data[offset + 8 + length:end])[0]:
            raise ValueError('Corrupt cover PNG')
        if kind == b'IHDR' and length == 13:
            width, height = struct.unpack('>II', chunk[:8])
        if kind == b'IEND':
            ended = end == len(data)
            break
        offset = end
    if not ended or width < 1400 or height < 800 or width * height > 20_000_000 or not 1.2 <= width / height <= 2:
        raise ValueError('Cover must be landscape, at least 1400x800, ratio 1.2 to 2')
    return {'sha256': hashlib.sha256(data).hexdigest(), 'width': width, 'height': height, 'bytes': len(data)}


@contextmanager
def cms_transfer_inputs(bundle, image_path):
    """Transfer private inputs with node ownership before entering cap_drop:ALL.

    Docker's host-side copy preserves the numeric owner; no privileged chown or
    root-owned cleanup is attempted inside the restricted container.
    """
    input_sha = bundle['inputSha256']
    if not re.fullmatch(r'[a-f0-9]{64}', input_sha):
        raise ValueError('Invalid input digest for CMS transfer')
    transport = ['-o', 'BatchMode=yes', '-o', 'IPQoS=none', '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=3', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
    ssh = ['ssh', *transport, SSH_HOST]
    remote = '/tmp/rusplast-editorial-' + input_sha
    # All shell values below are fixed paths or hexadecimal digests, never prose.
    with tempfile.TemporaryDirectory(prefix='rusplast-editorial-') as tmp:
        archive = Path(tmp) / 'article.tar'
        payload = Path(tmp) / 'article.json'
        payload.write_text(json.dumps(bundle, ensure_ascii=False))
        with tarfile.open(archive, 'w') as tar:
            tar.add(payload, arcname='article.json')
            tar.add(image_path, arcname='cover.png')
        run(['scp', '-q', *transport, archive, SSH_HOST + ':' + remote + '.tar'])
        try:
            transfer = (f'umask 077; mkdir -p {remote}; tar -xf {remote}.tar -C {remote}; '
                        f'chmod 700 {remote}; chmod 600 {remote}/article.json {remote}/cover.png; '
                        f'chown -R 1000:1000 {remote}; '
                        f'docker cp -a {remote} rusplast-cms-1:/tmp/')
            run([*ssh, 'set -e; ' + transfer])
            yield ssh, remote
        finally:
            run([*ssh, f'set -e; docker exec --user 1000:1000 rusplast-cms-1 rm -rf {remote}; rm -rf {remote} {remote}.tar'])


def publish_cms(article, image_path, image):
    """Fixed server-side CMS CLI. No generated code or new API credentials."""
    input_sha = digest({'article': article, 'imageSha256': image['sha256']})
    bundle = {'article': article, 'imageSha256': image['sha256'], 'inputSha256': input_sha,
              'imageGeneration': {'generator': 'codex-built-in-imagegen', **image}}
    with cms_transfer_inputs(bundle, image_path) as (ssh, remote):
        command = (f'flock -w 180 /var/lock/rusplast-cms-editorial.lock docker exec --user 1000:1000 rusplast-cms-1 '
                   f'node /app/scripts/publish-article.cjs {remote}/article.json {remote}/cover.png')
        output = run([*ssh, command], capture=True)
        result = json.loads(output.strip().splitlines()[-1])
    if result.get('inputSha256') != input_sha or result.get('slug') != article['slug']:
        raise ValueError('CMS did not confirm the exact input article and cover')
    normalized = result.get('article') or {}
    if normalized != {**article, 'image': normalized.get('image')} or result.get('sha256') != digest(normalized):
        raise ValueError('CMS returned different article content')
    if not re.fullmatch(r'https://cms\.rusplast-zavod\.ru/uploads/[a-zA-Z0-9_.-]+', normalized.get('image', '')):
        raise ValueError('CMS did not return a Media Library image URL')
    return result


def atomic_json(path, value):
    temporary = path.with_suffix('.json.new')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temporary, path)


def fetch(path):
    for attempt in range(3):
        try:
            with urlopen(ORIGIN + path, timeout=30) as response:
                return response.read()
        except OSError:
            if attempt == 2:
                raise


def receipt_for(article):
    try:
        manifest = json.loads(fetch('/publication-manifest.json'))
        found = manifest['articles'].get(article['slug'])
        if found and found['sha256'] == digest(article):
            html = fetch('/blog/' + article['slug']).decode()
            class HeadingParser(HTMLParser):
                in_heading = False
                parts = []

                def handle_starttag(self, tag, attrs):
                    if tag == 'h1':
                        self.in_heading = True

                def handle_endtag(self, tag):
                    if tag == 'h1':
                        self.in_heading = False

                def handle_data(self, value):
                    if self.in_heading:
                        self.parts.append(value)

            heading = HeadingParser()
            heading.parts = []
            heading.feed(html)
            if (article['title'] == ''.join(heading.parts) and article['image'] in html
                    and ('/blog/' + article['slug']) in fetch('/sitemap.xml').decode()):
                return {'url': ORIGIN + '/blog/' + article['slug'], 'slug': article['slug'],
                        'sha256': digest(article), 'release': manifest.get('release', 'verified-live')}
    except (OSError, ValueError, KeyError):
        pass
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--article', type=Path, required=True)
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--image', type=Path, help='New generated PNG cover; required for article publication')
    args = parser.parse_args()
    (ROOT / '.tmp').mkdir(exist_ok=True)
    with (ROOT / '.tmp/editorial-publish.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        article = json.loads(args.article.read_text())
        ctx = context()
        validate(article, ctx)
        image = inspect_cover(args.image)
        if args.validate_only:
            print(json.dumps({'valid': True, 'slug': article['slug'], 'sha256': digest(article), 'image': image}))
            return
        published = publish_cms(article, args.image.resolve(), image)
        # Runtime pages/sitemap are sourced from the same published CMS entry.
        # The server cache may still contain the previous publication for 30s.
        for attempt in range(13):
            receipt = receipt_for(published['article'])
            if receipt:
                break
            if attempt < 12:
                time.sleep(5)
        if not receipt:
            raise RuntimeError('CMS article published but public page/manifest not confirmed; retry the same JSON and PNG')
        published.update(receipt)
        atomic_json(ROOT / '.tmp/last-editorial-publication.json', published)
        print(json.dumps(published, ensure_ascii=False))



if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Publication failed: {error}', file=sys.stderr)
        sys.exit(1)
