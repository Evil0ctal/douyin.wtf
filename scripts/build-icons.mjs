/**
 * The site's icons, drawn from the project mark and nothing else.
 *
 * The site had none: Starlight links `/favicon.svg` by default and the file
 * was never there, so every page asked for a 404 and every tab and bookmark
 * showed the browser's blank page. `public/logo/logo.svg` is already drawn for
 * this - a 32x32 viewBox carrying its own colours - so the icons are rendered
 * from it rather than kept as separately drawn files that could drift.
 *
 *   favicon.svg           the mark itself, for every browser that takes SVG
 *   favicon.ico           16, 32 and 48 px, for whatever asks for /favicon.ico
 *                         by name - older browsers, feed readers, crawlers
 *   apple-touch-icon.png  180 px, square: iOS rounds the corners itself, and
 *                         the mark's own transparent corners would turn black
 *
 * Run by hand when the mark changes (`npm run icons`) and commit the output.
 * It is not part of the build because the inputs change once in a long while,
 * and a build that rewrites committed files is a build that dirties the tree.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const MARK = join(PUBLIC, 'logo', 'logo.svg')

/** The SVG without its leading comment, which is for whoever edits the file. */
function bare(svg) {
  return svg.replace(/^\s*<!--[\s\S]*?-->\s*/, '').trim() + '\n'
}

async function png(svg, size) {
  return sharp(Buffer.from(svg), { density: (72 * size) / 32 })
    .resize(size, size)
    .png()
    .toBuffer()
}

/**
 * An ICO file holding PNG images. Every browser that reads ICO at all has read
 * PNG-in-ICO since Windows Vista, and it keeps each size exactly as rendered.
 */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = header.length + 16 * images.length
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width, 0 meaning 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette size
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
}

const svg = bare(await readFile(MARK, 'utf8'))
const square = svg.replace(/(<rect[^>]*?)\s+rx="[^"]*"/, '$1')
if (square === svg) throw new Error('logo.svg has no rounded background rect to square off')

await writeFile(join(PUBLIC, 'favicon.svg'), svg)
await writeFile(
  join(PUBLIC, 'favicon.ico'),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(svg, size) })))),
)
await writeFile(join(PUBLIC, 'apple-touch-icon.png'), await png(square, 180))

console.log('wrote public/favicon.svg, public/favicon.ico, public/apple-touch-icon.png')
