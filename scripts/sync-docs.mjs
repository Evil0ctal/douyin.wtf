/**
 * Turn the upstream `documents/` tree into Starlight content.
 *
 * The upstream markdown is written for GitHub, and three things about it do not
 * survive the move unchanged:
 *
 *   1. Every page opens with a blockquote naming the project, linking the docs
 *      index and linking its translation. That exists because GitHub has no
 *      breadcrumb, no language picker and no sidebar. Starlight has all three,
 *      so here it is duplication. Stripped.
 *   2. Links are relative paths to `.md` files. On a site they have to be URLs.
 *      Rewritten, anchors kept.
 *   3. Filenames carry a numeric prefix so they sort in a directory listing.
 *      That is ordering information, not identity, and it must not reach a URL -
 *      a URL that changes later costs every ranking it had earned. The number
 *      moves into `sidebar.order`.
 *
 * Everything this writes is derived. `src/content/docs/` is git-ignored, and
 * editing it by hand is a change that the next build silently discards.
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM = join(ROOT, 'vendor', 'upstream')
const SOURCE = join(UPSTREAM, 'documents')
const OUT = join(ROOT, 'src', 'content', 'docs')
const LANDING = join(ROOT, 'src', 'landing')
const STATS = join(ROOT, 'src', 'data', 'stats.json')
/** Page path -> when its source last changed. Read by the sitemap in astro.config.mjs. */
const LASTMOD = join(ROOT, 'src', 'data', 'lastmod.json')

/** Where a link that points outside `documents/` has to resolve instead. */
const REPO_BLOB =
  'https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/main'

/** Upstream directory -> the path segment Starlight serves it under. */
const LOCALES = { en: '', zh: 'zh' }

const SITE = 'https://douyin.wtf'

/** Upstream directory -> the page's language, as hreflang and JSON-LD spell it. */
const LANG = { en: 'en', zh: 'zh-CN' }

/**
 * Upstream directory -> Open Graph locale. Starlight fills `og:locale` from the
 * page language, which gives `en` and `zh-CN`; the Open Graph format is
 * `language_TERRITORY`, and a crawler that parses it strictly reads neither.
 */
const OG_LOCALE = { en: 'en_US', zh: 'zh_CN' }

/** The share card's alt text, which the global head only has in English. */
const IMAGE_ALT = {
  en: 'The Douyin_TikTok_Download_API console, showing the identity pool with live health and cooldown state',
  zh: 'Douyin_TikTok_Download_API 控制台：身份池，以及每个身份实时的健康度和冷却状态',
}

const AUTHOR = { '@type': 'Person', name: 'Evil0ctal', url: 'https://github.com/Evil0ctal' }

/** `01-quickstart.md` -> { order: 1, slug: 'quickstart' } */
function parseName(filename) {
  const match = /^(\d+)-(.+)\.md$/.exec(filename)
  if (!match) throw new Error(`unexpected documentation filename: ${filename}`)
  return { order: Number(match[1]), slug: match[2] }
}

function urlFor(locale, slug) {
  const prefix = LOCALES[locale]
  return prefix ? `/${prefix}/${slug}/` : `/${slug}/`
}

/** The docs index page of a locale, which on this site is its landing page. */
function indexUrlFor(locale) {
  const prefix = LOCALES[locale]
  return prefix ? `/${prefix}/` : '/'
}

/**
 * The project line, and only it: an H1 followed by a blockquote whose first
 * line starts with the project name in bold. Deliberately anchored to the
 * project name rather than to "a blockquote after the H1", so a page that opens
 * with a real quotation keeps it.
 */
const CRUMB = /^(#[^\n]*\n)\n> \*\*\[Douyin_TikTok_Download_API\][^\n]*(?:\n>[^\n]*)*\n/

function stripCrumb(text) {
  return text.replace(CRUMB, '$1')
}

/** Pull the H1 out and drop it: Starlight renders the title from frontmatter. */
function takeTitle(text) {
  const match = /^#\s+(.+)\n/.exec(text)
  if (!match) throw new Error('page does not open with an H1')
  return { title: match[1].trim(), body: text.slice(match[0].length).trimStart() }
}

function rewriteLinks(text, locale) {
  const other = locale === 'en' ? 'zh' : 'en'

  return (
    text
      // ./04-concepts.md#anchor  ->  /concepts/#anchor   (same locale)
      .replace(/\(\.\/(\d+)-([a-z0-9-]+)\.md(#[^)]*)?\)/g, (_m, _n, slug, hash) =>
        `(${urlFor(locale, slug)}${hash ?? ''})`,
      )
      // ../zh/11-api.md  ->  /zh/api/            (the other locale)
      .replace(
        new RegExp(`\\(\\.\\./${other}/(\\d+)-([a-z0-9-]+)\\.md(#[^)]*)?\\)`, 'g'),
        (_m, _n, slug, hash) => `(${urlFor(other, slug)}${hash ?? ''})`,
      )
      // ../README.md and ../README.zh-CN.md  ->  the locale's index
      .replace(/\(\.\.\/README\.zh-CN\.md\)/g, `(${indexUrlFor('zh')})`)
      .replace(/\(\.\.\/README\.md\)/g, `(${indexUrlFor('en')})`)
      // ../screenshots/console-en.gif  ->  /screenshots/console-en.gif
      .replace(/\.\.\/screenshots\//g, '/screenshots/')
      // Anything that climbs out of documents/ is pointing at a file in the
      // repository, not at a page on this site. Send it to GitHub rather than
      // to a 404: `../../install/README.md` is the installer's own readme, and
      // there is no site page that could stand in for it.
      .replace(
        /\(\.\.\/\.\.\/([^)#]+)(#[^)]*)?\)/g,
        (_m, path, hash) => `(${REPO_BLOB}/${path}${hash ?? ''})`,
      )
  )
}

/**
 * YAML frontmatter. Values go out as JSON, which YAML reads as flow syntax -
 * except a Date, which has to be a bare YAML timestamp: quoted, it is a string,
 * and Starlight's `lastUpdated` rejects a string and fails the build.
 */
function frontmatter(fields) {
  const yaml = Object.entries(fields)
    .map(([key, value]) => {
      if (value instanceof Date) return `${key}: ${value.toISOString()}`
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return `${key}:\n${Object.entries(value)
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join('\n')}`
      }
      return `${key}: ${JSON.stringify(value)}`
    })
    .join('\n')
  return `---\n${yaml}\n---\n\n`
}

/** CJK ideographs, kana and full-width punctuation: text that takes no spaces. */
const CJK = '\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef'

/**
 * Markdown prose as one line. Upstream wraps paragraphs at a fixed width, and
 * collapsing every line break to a space put a space in the middle of Chinese
 * words - "术语解释 一遍", "不必 停下来" - in the meta description every Chinese
 * search result quoted. A break between two CJK characters is now dropped
 * instead; anywhere else it is still a space.
 */
function flatten(text) {
  return text
    .replace(new RegExp(`([${CJK}])\\s*\\n\\s*([${CJK}])`, 'g'), '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * When a file last changed, from the upstream checkout's history.
 *
 * Feeds the sitemap's `lastmod` and the page's visible "Last updated", which
 * are how a crawler decides what to fetch again and how a reader judges whether
 * a page is current. Needs the history: CI checks out with `fetch-depth: 0`,
 * because in a shallow clone every file would claim the date of the one commit
 * there is. Undefined when git cannot answer, and then nothing is claimed.
 */
function lastChanged(repo, path) {
  try {
    const iso = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%cI', '--', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return iso ? new Date(iso) : undefined
  } catch {
    return undefined
  }
}

/**
 * FAQ questions, as `FAQPage` structured data.
 *
 * The upstream FAQ is already written as questions - "Is this legal?", "Can it
 * download without a watermark?" - which is the shape both a rich result and a
 * generative answer want, and it would be a waste to publish it as prose and
 * leave that on the floor. Generated from the H3s rather than maintained by
 * hand, so the two cannot say different things.
 *
 * Answers are trimmed to the first paragraph and capped: the schema wants an
 * answer, not the page.
 */
function faqStructuredData(body) {
  const questions = []
  const sections = body.split(/^### /m).slice(1)

  for (const section of sections) {
    const [heading, ...rest] = section.split('\n')
    const answer = rest
      .join('\n')
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .find((block) => block && !block.startsWith('|') && !block.startsWith('```'))
    if (!heading.trim() || !answer) continue
    questions.push({
      '@type': 'Question',
      name: heading.trim(),
      acceptedAnswer: {
        '@type': 'Answer',
        // `[text](url)` collapses to `text`. Stripping only the brackets left
        // "Apache License 2.0(https://www.apache.org/...)" in the answer, which
        // is the kind of thing a rich result renders verbatim.
        text: flatten(answer.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))
          .replace(/[*`]/g, '')
          .slice(0, 600),
      },
    })
  }

  if (questions.length === 0) return null
  return { '@type': 'FAQPage', mainEntity: questions }
}

/**
 * Every documentation page's structured data, as one `@graph`.
 *
 * `TechArticle` says what the page is, in which language and when it last
 * changed - the facts a generative engine checks before it quotes a page as
 * current. `BreadcrumbList` puts "Douyin_TikTok_Download_API > page" under the
 * title in a search result instead of a bare URL. The FAQ's questions join the
 * same graph rather than a second script tag, so the page states one thing.
 */
function structuredData({ locale, title, description, url, modified, faq }) {
  const home = `${SITE}${indexUrlFor(locale)}`
  const graph = [
    {
      '@type': 'TechArticle',
      '@id': `${url}#article`,
      headline: title,
      description,
      url,
      inLanguage: LANG[locale],
      ...(modified ? { dateModified: modified.toISOString() } : {}),
      image: `${SITE}/og.png`,
      author: AUTHOR,
      publisher: AUTHOR,
      isPartOf: { '@type': 'WebSite', name: 'Douyin_TikTok_Download_API', url: `${SITE}/` },
      about: { '@type': 'SoftwareApplication', name: 'Douyin_TikTok_Download_API', url: home },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Douyin_TikTok_Download_API', item: home },
        { '@type': 'ListItem', position: 2, name: title, item: url },
      ],
    },
    ...(faq ? [{ ...faq, url }] : []),
  ]
  return scriptSafe(JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }))
}

/**
 * JSON that can sit inside a `<script>` element. The text comes from upstream
 * prose, and a title or an FAQ answer that mentions `</script>` - a page about
 * HTML could - would close the element there and run the rest as markup. The
 * escapes are JSON's own, so the data a crawler parses is unchanged.
 */
function scriptSafe(json) {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Head entries every page adds to Starlight's own. A page-level entry replaces
 * Starlight's default with the same `property` (its `mergeHead`), which is how
 * `og:locale` gets corrected per page.
 */
function pageHead(locale, jsonLd) {
  const other = locale === 'en' ? 'zh' : 'en'
  return [
    { tag: 'meta', attrs: { property: 'og:locale', content: OG_LOCALE[locale] } },
    { tag: 'meta', attrs: { property: 'og:locale:alternate', content: OG_LOCALE[other] } },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: IMAGE_ALT[locale] } },
    { tag: 'script', attrs: { type: 'application/ld+json' }, content: jsonLd },
  ]
}

async function syncLocale(locale, lastmod) {
  const files = (await readdir(join(SOURCE, locale)))
    .filter((name) => name.endsWith('.md'))
    .sort()

  const target = LOCALES[locale] ? join(OUT, LOCALES[locale]) : OUT
  await mkdir(target, { recursive: true })

  for (const filename of files) {
    const { order, slug } = parseName(filename)
    const raw = await readFile(join(SOURCE, locale, filename), 'utf8')
    const { title, body } = takeTitle(rewriteLinks(stripCrumb(raw), locale))
    const path = urlFor(locale, slug)
    const url = `${SITE}${path}`
    const modified = lastChanged(UPSTREAM, `documents/${locale}/${filename}`)
    // `description` is what a search result and an AI summary quote. The
    // upstream lead paragraph is written to be exactly that, so the first
    // sentence of the body is the honest source for it.
    const description = firstSentence(body, title)

    const fields = {
      title,
      description,
      sidebar: { order },
      ...(modified ? { lastUpdated: modified } : {}),
    }
    if (modified) lastmod[path] = modified.toISOString()

    const faq = slug === 'faq' ? faqStructuredData(body) : null
    const jsonLd = structuredData({ locale, title, description, url, modified, faq })
    // JSON is YAML flow syntax, so the head goes in as one line of it. The
    // hand-written YAML this replaced had to be indented just so.
    const head = `head: ${JSON.stringify(pageHead(locale, jsonLd))}\n`

    // `frontmatter()` closes with `---\n\n`; the head block goes in before
    // that fence, not after it.
    const matter = frontmatter(fields).replace(/---\n\n$/, `${head}---\n\n`)

    await writeFile(join(target, `${slug}.md`), matter + body, 'utf8')
  }

  return files.length
}

/**
 * First sentence of the lead paragraph, capped so it fits a meta description.
 *
 * A Chinese full stop ends a sentence with no space after it. The search used
 * to want whitespace after `。` as after `.`, never found it, and every Chinese
 * description ran on to the end of the paragraph.
 */
function firstSentence(body, fallback) {
  const paragraph = body.split('\n\n').find((block) => !block.startsWith('>')) ?? ''
  const flat = flatten(paragraph).replace(/[*`]/g, '')
  if (!flat) return fallback
  const end = flat.search(/\.(\s|$)|[。！？]/)
  const sentence = end === -1 ? flat : flat.slice(0, end + 1)
  return sentence.length > 300 ? `${sentence.slice(0, 297)}...` : sentence
}

/**
 * The landing pages' `softwareVersion`, from the release the build measured.
 *
 * It was typed into the frontmatter and said 5.1.7 two releases later. The
 * source keeps a real version so it stays valid on its own; the copy the build
 * serves gets the one `fetch-stats.mjs` read, without the tag's `v`.
 */
async function stampVersion(file) {
  const stats = JSON.parse(await readFile(STATS, 'utf8').catch(() => '{}'))
  const version = String(stats.version ?? '').replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+/.test(version)) return
  const text = await readFile(file, 'utf8')
  await writeFile(file, text.replace(/"softwareVersion": "[^"]*"/, `"softwareVersion": "${version}"`), 'utf8')
}

async function main() {
  try {
    await readdir(SOURCE)
  } catch {
    throw new Error(
      `vendor/upstream/documents is missing. The submodule is not checked out:\n` +
        `  git submodule update --init --recursive`,
    )
  }

  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const counts = {}
  const lastmod = {}
  for (const locale of Object.keys(LOCALES)) counts[locale] = await syncLocale(locale, lastmod)

  // The two landing pages are this site's own content - the only prose here
  // that is not upstream's. They live outside src/content/docs because that
  // directory is wholly generated and therefore git-ignored.
  //
  // Relative paths inside them are written for where they LAND, not for where
  // they are stored: `src/landing/index.mdx` becomes `src/content/docs/
  // index.mdx`, so its imports climb from there. The Chinese page lands one
  // level deeper and climbs one more. Getting this wrong is a build error
  // rather than a silent miss, which is the one mercy in it.
  await cp(LANDING, OUT, { recursive: true })
  for (const [locale, file] of [
    ['en', 'index.mdx'],
    ['zh', join('zh', 'index.mdx')],
  ]) {
    await stampVersion(join(OUT, file))
    // The landing pages are this repository's own, so their date comes from
    // this repository's history rather than upstream's.
    const modified = lastChanged(ROOT, relative(ROOT, join(LANDING, file)))
    if (modified) lastmod[indexUrlFor(locale)] = modified.toISOString()
  }
  await writeFile(LASTMOD, `${JSON.stringify(lastmod, null, 2)}\n`, 'utf8')

  await cp(join(UPSTREAM, 'screenshots'), join(ROOT, 'public', 'screenshots'), {
    recursive: true,
  })
  // The project's own marks, from the same place the README takes them, so the
  // site cannot end up showing a logo the project has stopped using.
  await cp(join(UPSTREAM, 'logo'), join(ROOT, 'public', 'logo'), { recursive: true })

  const upstream = await readFile(join(UPSTREAM, '.git'), 'utf8').catch(() => '')
  console.log(
    `synced ${counts.en} English and ${counts.zh} Chinese pages` +
      (upstream ? '' : ''),
  )
}

await main()
