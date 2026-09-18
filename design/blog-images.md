# Фотографии для блога

Созданы 18.09.2026 встроенным инструментом `image_gen` (навык `imagegen`). Это сгенерированные редакционные иллюстрации, а не съёмка завода, реальные сертификаты или подтверждение характеристик изделий.

Для каждой статьи подготовлен отдельный сюжет. Финальные изображения находятся в `web/public/images/optimized/`: версии шириной 640 и 1280 пикселей в формате WebP. Они используются в карточках, на странице статьи и в метаданных Open Graph / BlogPosting. Общие фотографии каталога сохранены.

## Соответствие статьям

| Статья | Файлы |
| --- | --- |
| `/blog/gofra-pvh-ili-pnd` | `blog-pvh-pnd-640.webp`, `blog-pvh-pnd-1280.webp` |
| `/blog/diametr-gofrotruby-16-20-25-32` | `blog-diameters-640.webp`, `blog-diameters-1280.webp` |
| `/blog/legkaya-i-tyazhelaya-gofra` | `blog-compression-640.webp`, `blog-compression-1280.webp` |
| `/blog/gofrotruba-frhf` | `blog-frhf-640.webp`, `blog-frhf-1280.webp` |
| `/blog/dokumenty-na-gofrotrubu` | `blog-documents-640.webp`, `blog-documents-1280.webp` |
| `/blog/gofrotruba-pod-stm` | `blog-private-label-640.webp`, `blog-private-label-1280.webp` |

## Промпты генерации

### blog-pvh-pnd

```text
Use case: photorealistic-natural.
Asset type: horizontal editorial cover photograph for a Russian corrugated electrical conduit manufacturer's blog, also used as a small card thumbnail.
Style: authentic high-end industrial editorial photography, real fine material texture, restrained neutral gray palette with subject-appropriate accents, soft natural light, tasteful uncluttered framing. Landscape 3:2 composition, ideally 1536 by 1024 pixels. Essential subjects comfortably within the central 70 percent so thumbnails crop gracefully.
Constraints: a single full-frame photograph, no collage, no split screen, no graphic frame, no captions, no logos, no watermark, no readable words or numbers. Do not depict a specific identifiable factory or invent official certification. Corrugated conduits must have continuous regular closely spaced circumferential ribs and hollow open ends; these are small flexible electrical conduits, not large plumbing or drainage pipes. Avoid CGI, illustration, overglossy plastic, deformed ribs, impossible geometry.
Primary request: comparing PVC and HDPE corrugated electrical conduits. A close, sculptural still life of three short gently curved flexible conduit samples: light gray, matte black and warm orange, side by side on a pale stone workbench. All three open ends are clearly visible and face slightly toward the camera, realistic small 20–25 mm electrical conduit scale. The three colors and textures are the story. Slightly elevated three-quarter camera view, delicate side light, broad negative space around objects, shallow but useful depth of field. No coils, tools, cables or labels.
```

### blog-diameters

```text
Use case: photorealistic-natural.
Asset type: horizontal editorial cover photograph for a Russian corrugated electrical conduit manufacturer's blog, also used as a small card thumbnail.
Style: authentic high-end industrial editorial photography, real fine material texture, restrained neutral gray palette with subject-appropriate accents, soft natural light, tasteful uncluttered framing. Landscape 3:2 composition, ideally 1536 by 1024 pixels. Essential subjects comfortably within the central 70 percent so thumbnails crop gracefully.
Constraints: a single full-frame photograph, no collage, no split screen, no graphic frame, no captions, no logos, no watermark, no readable words or numbers. Do not depict a specific identifiable factory or invent official certification. Corrugated conduits must have continuous regular closely spaced circumferential ribs and hollow open ends; these are small flexible electrical conduits, not large plumbing or drainage pipes. Avoid CGI, illustration, overglossy plastic, deformed ribs, impossible geometry.
Primary request: measuring corrugated conduit diameter. On a light engineering workbench, four short light-gray corrugated electrical conduit samples of progressively different diameter, approximately 16, 20, 25 and 32 mm, aligned side by side with their hollow circular ends visible. A realistic stainless steel vernier caliper resting immediately next to the largest sample, not clipping through it; its scale is subtle and not readable. Close three-quarter overhead macro composition; focus on four different opening sizes and the measuring tool. No hands, no cable, no labels. Soft morning daylight, tactile subtle shadows.
```

### blog-compression

```text
Use case: photorealistic-natural.
Asset type: horizontal editorial cover photograph for a Russian corrugated electrical conduit manufacturer's blog, also used as a small card thumbnail.
Style: authentic high-end industrial editorial photography, real fine material texture, restrained neutral gray palette with subject-appropriate accents, soft natural light, tasteful uncluttered framing. Landscape 3:2 composition, ideally 1536 by 1024 pixels. Essential subjects comfortably within the central 70 percent so thumbnails crop gracefully.
Constraints: a single full-frame photograph, no collage, no split screen, no graphic frame, no captions, no logos, no watermark, no readable words or numbers. Do not depict a specific identifiable factory or invent official certification. Corrugated conduits must have continuous regular closely spaced circumferential ribs and hollow open ends; these are small flexible electrical conduits, not large plumbing or drainage pipes. Avoid CGI, illustration, overglossy plastic, deformed ribs, impossible geometry.
Primary request: mechanical compression strength of a corrugated electrical conduit. An editorial close-up in a materials testing laboratory: one short gray flexible corrugated conduit lying horizontally on a flat metal base beneath the flat upper steel platen of a compact compression-testing machine. The upper platen just touches the conduit, with no dramatic crushing. The two flat parallel plates clearly bracket the small sample. Its open circular end and regular ribs are visible. Steel laboratory hardware in soft background blur, no display or test results visible. Low oblique eye-level camera, soft cool daylight, realistic industrial texture. No people, no extra pipe coils, no sparks or dramatic effects.
```

### blog-frhf

```text
Use case: photorealistic-natural.
Asset type: horizontal editorial cover photograph for a Russian corrugated electrical conduit manufacturer's blog, also used as a small card thumbnail.
Style: authentic high-end industrial editorial photography, real fine material texture, restrained neutral gray palette with subject-appropriate accents, soft natural light, tasteful uncluttered framing. Landscape 3:2 composition, ideally 1536 by 1024 pixels. Essential subjects comfortably within the central 70 percent so thumbnails crop gracefully.
Constraints: a single full-frame photograph, no collage, no split screen, no graphic frame, no captions, no logos, no watermark, no readable words or numbers. Do not depict a specific identifiable factory or invent official certification. Corrugated conduits must have continuous regular closely spaced circumferential ribs and hollow open ends; these are small flexible electrical conduits, not large plumbing or drainage pipes. Avoid CGI, illustration, overglossy plastic, deformed ribs, impossible geometry.
Primary request: a corrugated conduit protecting a cable in a modern indoor technical installation, illustrating a general article about FRHF material selection without demonstrating fire performance. Detail photograph of a clean galvanized open cable tray containing a neat small group of matte charcoal corrugated electrical conduits, one gently curving toward a closed light-gray junction box in a tidy equipment room. Realistic small-scale conduits and plausible bend radii, neatly secured, no exposed conductors. The junction box is a secondary background element. Three-quarter close perspective along the tray, softly blurred pale-blue technical cabinet in distance, gentle window light. No people, no fire, no smoke, no hazard symbols or labels.
```

### blog-documents

```text
Use case: photorealistic-natural.
Asset type: horizontal editorial cover photograph for a Russian corrugated electrical conduit manufacturer's blog, also used as a small card thumbnail.
Style: authentic high-end industrial editorial photography, real fine material texture, restrained neutral gray palette with subject-appropriate accents, soft natural light, tasteful uncluttered framing. Landscape 3:2 composition, ideally 1536 by 1024 pixels. Essential subjects comfortably within the central 70 percent so thumbnails crop gracefully.
Constraints: a single full-frame photograph, no collage, no split screen, no graphic frame, no captions, no logos, no watermark, no readable words or numbers. Do not depict a specific identifiable factory or invent official certification. Corrugated conduits must have continuous regular closely spaced circumferential ribs and hollow open ends; these are small flexible electrical conduits, not large plumbing or drainage pipes. Avoid CGI, illustration, overglossy plastic, deformed ribs, impossible geometry.
Primary request: checking accompanying product documentation. Overhead editorial desk photograph with an unbranded clipboard holding white technical-document sheets with subtle gray lines and an abstract table, a simple dark pen and a short gray corrugated conduit sample laid neatly beside the papers. One matte black conduit sample near the far edge ties documents to actual products. Document layouts have only indistinct faint lines, NO readable letters, no certification seals, no signatures, no stamps, no QR codes, no government symbols. Warm white desk and soft daylight, ordered but natural arrangement, all main subjects centered. Papers and pen dominate the scene; conduit samples are supporting objects. No hands.
```

### blog-private-label

```text
Use case: photorealistic-natural.
Asset type: horizontal editorial cover photograph for a Russian corrugated electrical conduit manufacturer's blog, also used as a small card thumbnail.
Style: authentic high-end industrial editorial photography, real fine material texture, restrained neutral gray palette with subject-appropriate accents, soft natural light, tasteful uncluttered framing. Landscape 3:2 composition, ideally 1536 by 1024 pixels. Essential subjects comfortably within the central 70 percent so thumbnails crop gracefully.
Constraints: a single full-frame photograph, no collage, no split screen, no graphic frame, no captions, no logos, no watermark, no readable words or numbers. Do not depict a specific identifiable factory or invent official certification. Corrugated conduits must have continuous regular closely spaced circumferential ribs and hollow open ends; these are small flexible electrical conduits, not large plumbing or drainage pipes. Avoid CGI, illustration, overglossy plastic, deformed ribs, impossible geometry.
Primary request: preparing private-label wholesale production and packaging of electrical corrugated conduit. Eye-level editorial photograph of a clean packaging workbench in a generic industrial warehouse: one neatly bundled coil of gray corrugated conduit wrapped in transparent film with a completely blank white rectangular product label, beside a second packed black conduit coil and a small stack of plain kraft shipping cartons. A roll of blank white adhesive labels is on the bench near the front. Focus on packaging and blank private-label area, full round coil shape visible. Corrugation physically consistent, realistic plastic wrap wrinkles. Softly blurred shelving in background, natural side light, restrained warm neutral colors. No printed text, barcodes, logos or people. This must feel clearly different from a product sample still life.
```
