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
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM = join(ROOT, 'vendor', 'upstream')
const SOURCE = join(UPSTREAM, 'documents')
const OUT = join(ROOT, 'src', 'content', 'docs')
const LANDING = join(ROOT, 'src', 'landing')

/** Where a link that points outside `documents/` has to resolve instead. */
const REPO_BLOB =
  'https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/main'

/** Upstream directory -> the path segment Starlight serves it under. */
const LOCALES = { en: '', zh: 'zh' }

const SITE = 'https://douyin.wtf'

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

function frontmatter(fields) {
  const yaml = Object.entries(fields)
    .map(([key, value]) =>
      typeof value === 'object'
        ? `${key}:\n${Object.entries(value)
            .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
            .join('\n')}`
        : `${key}: ${JSON.stringify(value)}`,
    )
    .join('\n')
  return `---\n${yaml}\n---\n\n`
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
function faqStructuredData(body, url) {
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
        text: answer
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/\s+/g, ' ')
          .replace(/[*`]/g, '')
          .trim()
          .slice(0, 600),
      },
    })
  }

  if (questions.length === 0) return null
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url,
    mainEntity: questions,
  })
}

async function syncLocale(locale) {
  const files = (await readdir(join(SOURCE, locale)))
    .filter((name) => name.endsWith('.md'))
    .sort()

  const target = LOCALES[locale] ? join(OUT, LOCALES[locale]) : OUT
  await mkdir(target, { recursive: true })

  for (const filename of files) {
    const { order, slug } = parseName(filename)
    const raw = await readFile(join(SOURCE, locale, filename), 'utf8')
    const { title, body } = takeTitle(rewriteLinks(stripCrumb(raw), locale))

    const fields = {
      title,
      // `description` is what a search result and an AI summary quote. The
      // upstream lead paragraph is written to be exactly that, so the first
      // sentence of the body is the honest source for it.
      description: firstSentence(body, title),
      sidebar: { order },
    }

    const faq = slug === 'faq' ? faqStructuredData(body, `${SITE}${urlFor(locale, slug)}`) : null
    const head = faq
      ? `head:\n  - tag: script\n    attrs:\n      type: application/ld+json\n    content: ${JSON.stringify(faq)}\n`
      : ''

    // `frontmatter()` closes with `---\n\n`; the head block goes in before
    // that fence, not after it.
    const matter = head
      ? frontmatter(fields).replace(/---\n\n$/, `${head}---\n\n`)
      : frontmatter(fields)

    await writeFile(join(target, `${slug}.md`), matter + body, 'utf8')
  }

  return files.length
}

/** First sentence of the lead paragraph, capped so it fits a meta description. */
function firstSentence(body, fallback) {
  const paragraph = body.split('\n\n').find((block) => !block.startsWith('>')) ?? ''
  const flat = paragraph.replace(/\s+/g, ' ').replace(/[*`]/g, '').trim()
  if (!flat) return fallback
  const end = flat.search(/[.。](\s|$)/)
  const sentence = end === -1 ? flat : flat.slice(0, end + 1)
  return sentence.length > 300 ? `${sentence.slice(0, 297)}...` : sentence
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
  for (const locale of Object.keys(LOCALES)) counts[locale] = await syncLocale(locale)

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
