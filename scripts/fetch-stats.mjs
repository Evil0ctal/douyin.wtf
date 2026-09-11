/**
 * Fetch the project's public numbers and write them into the build.
 *
 * Baked at build time rather than fetched by the page, for three reasons that
 * all point the same way: a number in the HTML is a number a search engine and
 * a language model can read, the page stays a static file with no request of
 * its own, and a reader is never shown a row of spinners that resolve into
 * "—" because an API was rate-limited.
 *
 * `stats.json` is committed. It is the fallback when GitHub or Docker Hub is
 * unreachable, which must not fail a deploy - stale numbers on a working site
 * beat a site that would not build. Every value carries the day it was read so
 * nothing pretends to be live.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'data', 'stats.json')

const REPO = 'Evil0ctal/Douyin_TikTok_Download_API'
const IMAGES = [
  'evil0ctal/douyin_tiktok_download_api',
  'evil0ctal/douyin_tiktok_download_api-downloader',
]

/** Give up quickly: this is decoration on a page that must still build. */
const TIMEOUT_MS = 8000

async function getJson(url) {
  const stop = AbortSignal.timeout(TIMEOUT_MS)
  const response = await fetch(url, {
    signal: stop,
    headers: { accept: 'application/json', 'user-agent': 'douyin.wtf build' },
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

async function collect() {
  const repo = await getJson(`https://api.github.com/repos/${REPO}`)
  const release = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`)

  let pulls = 0
  for (const image of IMAGES) {
    const meta = await getJson(`https://hub.docker.com/v2/repositories/${image}/`)
    pulls += Number(meta.pull_count) || 0
  }

  return {
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    // Both images together: an operator running the downloader profile pulls
    // two, and splitting the number would invite the reader to add it up.
    pulls,
    version: release.tag_name,
    since: repo.created_at.slice(0, 10),
    license: 'Apache-2.0',
    measured: new Date().toISOString().slice(0, 10),
  }
}

async function main() {
  let previous = null
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'))
  } catch {
    previous = null
  }

  try {
    const stats = await collect()
    await writeFile(OUT, `${JSON.stringify(stats, null, 2)}\n`, 'utf8')
    console.log(
      `stats: ${stats.stars} stars, ${stats.pulls} pulls, ${stats.version}, read ${stats.measured}`,
    )
  } catch (error) {
    if (!previous) throw error
    console.warn(`stats: keeping ${previous.measured} figures - ${error.message}`)
  }
}

await main()
