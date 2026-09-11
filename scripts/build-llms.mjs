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

const SUMMARY = `> A self-hosted data API for Douyin (抖音) and TikTok. One \`docker compose up\`
> gives you a REST API, an MCP server and a web console, backed by an identity
> pool (cookies + proxies + fingerprints) that mints, tests, cools and retires
> its own identities. Open source (Apache-2.0), free, and it runs entirely on
> your own machine - there is no hosted tier and nothing is proxied through a
> third party.

Built with Python 3.12, FastAPI, PostgreSQL + TimescaleDB and Redis; the console
is React. It fetches posts, authors, comments, mixes and search from both
platforms, downloads video and image albums using the watermark-free stream the
platform already publishes (it selects that stream, it does not strip a
watermark), and archives what it collects so a post deleted upstream is still
readable locally.

Signing is native Python - \`a_bogus\`, \`X-Bogus\` and the TikTok signatures are
implemented in-process rather than driven through a browser - with a headless
browser kept as a fallback and as a drift detector.

Source: <https://github.com/Evil0ctal/Douyin_TikTok_Download_API>
Live demo: <https://demo.douyin.wtf> (30 requests per 10 seconds, then a 10-second cooldown)

Every page below exists in English and Simplified Chinese and the two say the
same thing.`

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
    `- [Full text of every page](${SITE}/llms-full.txt): All thirty-four pages concatenated, for a model that would rather read once than crawl.`,
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
