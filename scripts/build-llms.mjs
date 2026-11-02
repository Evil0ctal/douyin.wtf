/**
 * Emit `/llms.txt` and `/llms-full.txt` into the built site.
 *
 * The llmstxt.org convention puts these at the site root so a model or an agent
 * can find the documentation without crawling it. The upstream repository
 * carries its own `llms.txt` pointing at GitHub blobs - that one is the
 * repository's index and has to stay self-contained. This one points at pages
 * on this site, which are the canonical copies.
 *
 * Both are generated after the build rather than committed. A committed index
 * of seventeen pages is seventeen chances to drift, and `llms-full.txt` is
 * roughly half a megabyte of text that has no business in a git history.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'src', 'content', 'docs')
const DIST = join(ROOT, 'dist')
const SITE = 'https://douyin.wtf'

const UPSTREAM_LLMS = join(ROOT, 'vendor', 'upstream', 'llms.txt')

/** What closes the summary here: where the code lives and where to try it. */
const SITE_LINES = `Source: <https://github.com/Evil0ctal/Douyin_TikTok_Download_API>
Live demo: <https://demo.douyin.wtf> (30 requests per 10 seconds, then a 10-second cooldown)

Every page below exists in English and Simplified Chinese and the two say the
same thing.`

/**
 * The project summary, taken from upstream's own `llms.txt`: everything between
 * its title and its first section, minus the closing paragraph about the file
 * itself, which is replaced by this site's lines.
 *
 * It used to be a copy typed in here. The project added Bilibili, then
 * transcription, then live reads, and the copy kept saying "Douyin and TikTok"
 * to every model that read this site - while upstream's summary, which the
 * project does keep current, said otherwise. Falls back to a bare line rather
 * than failing the build: the page index below is the part a reader needs.
 */
async function summary() {
  const text = await readFile(UPSTREAM_LLMS, 'utf8').catch(() => '')
  const match = /^# [^\n]*\n+([\s\S]*?)\n## /m.exec(text)
  const body = (match?.[1] ?? '')
    .split(/\n\s*\n/)
    .filter((block) => !block.startsWith('This file follows'))
    .join('\n\n')
    .trim()
  return `${body || '> A self-hosted data API for Douyin, TikTok and Bilibili.'}\n\n${SITE_LINES}`
}

/** Frontmatter is small and predictable here, so a full YAML parser is overkill. */
function readFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match) return { fields: {}, body: text }
  const fields = {}
  for (const line of match[1].split('\n')) {
    const pair = /^(\w+):\s*(.+)$/.exec(line)
    if (pair) {
      try {
        fields[pair[1]] = JSON.parse(pair[2])
      } catch {
        fields[pair[1]] = pair[2]
      }
    }
  }
  return { fields, body: text.slice(match[0].length) }
}

async function pagesFor(locale) {
  const dir = locale === 'en' ? DOCS : join(DOCS, locale)
  const names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort()

  const pages = []
  for (const name of names) {
    const { fields, body } = readFrontmatter(await readFile(join(dir, name), 'utf8'))
    const slug = name.replace(/\.md$/, '')
    pages.push({
      slug,
      order: fields.title ? Number(/order:\s*(\d+)/.exec(await readFile(join(dir, name), 'utf8'))?.[1] ?? 0) : 0,
      title: fields.title ?? slug,
      description: fields.description ?? '',
      url: locale === 'en' ? `${SITE}/${slug}/` : `${SITE}/${locale}/${slug}/`,
      body,
    })
  }
  return pages.sort((a, b) => a.order - b.order)
}

async function main() {
  const en = await pagesFor('en')
  const zh = await pagesFor('zh')
  const SUMMARY = await summary()

  const index = [
    '# Douyin_TikTok_Download_API',
    '',
    SUMMARY,
    '',
    '## Documentation (English)',
    '',
    ...en.map((p) => `- [${p.title}](${p.url}): ${p.description}`),
    '',
    '## 文档（简体中文）',
    '',
    ...zh.map((p) => `- [${p.title}](${p.url}): ${p.description}`),
    '',
    '## Optional',
    '',
    `- [Full text of every page](${SITE}/llms-full.txt): All ${en.length + zh.length} pages concatenated, for a model that would rather read once than crawl.`,
    '- [Releases](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/releases): Bilingual release notes, with the git tag and the image tag listed side by side.',
    '- [Docker images](https://hub.docker.com/r/evil0ctal/douyin_tiktok_download_api): A release tag has no leading `v`: the git tag `v5.0.1` publishes the image `5.0.1`.',
    '',
  ].join('\n')

  const full = [
    '# Douyin_TikTok_Download_API - complete documentation',
    '',
    SUMMARY,
    '',
    ...[...en, ...zh].flatMap((p) => ['', '---', '', `# ${p.title}`, `Source: ${p.url}`, '', p.body.trim()]),
    '',
  ].join('\n')

  await writeFile(join(DIST, 'llms.txt'), index, 'utf8')
  await writeFile(join(DIST, 'llms-full.txt'), full, 'utf8')

  const kb = (text) => `${Math.round(Buffer.byteLength(text) / 1024)} KB`
  console.log(`llms.txt (${kb(index)}) and llms-full.txt (${kb(full)}) written to dist/`)
}

await main()
