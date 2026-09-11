// @ts-check
import sitemap from '@astrojs/sitemap'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

/**
 * The site exists to be indexed. Everything here that looks like ceremony is
 * load-bearing for that: `site` is what makes canonical URLs and the sitemap
 * absolute, and the locale table is what makes hreflang correct.
 *
 * English is the root locale, so it has no prefix: `/quickstart/` rather than
 * `/en/quickstart/`. Chinese is `/zh/`. The pairing is declared once, here, and
 * everything downstream - sitemap alternates, the language picker, the
 * canonical tag - reads it from this table rather than repeating it.
 */
export default defineConfig({
  site: 'https://douyin.wtf',
  trailingSlash: 'always',

  integrations: [
    starlight({
      title: {
        en: 'Douyin_TikTok_Download_API',
        'zh-CN': 'Douyin_TikTok_Download_API',
      },
      description:
        'A self-hosted data API for Douyin and TikTok. REST, MCP and a web console, ' +
        'with an identity pool that maintains itself. Open source and free to run.',

      // `zh-CN` rather than the more precise `zh-Hans`, and it was measured
      // rather than assumed: Starlight ships interface translations keyed by
      // `zh-CN`, and under `zh-Hans` every Chinese page rendered its navigation,
      // its search box and its "On this page" heading in English. Carrying a
      // private copy of Starlight's UI strings to win a point about writing
      // systems versus regions is the wrong trade - `zh-CN` is a valid hreflang
      // value and Google reads it as Simplified Chinese either way.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        zh: { label: '简体中文', lang: 'zh-CN' },
      },

      logo: {
        src: './src/assets/logo.svg',
        alt: 'Douyin_TikTok_Download_API',
      },

      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Evil0ctal/Douyin_TikTok_Download_API',
        },
      ],

      editLink: {
        // Points at the upstream file, not at this repository. Somebody who
        // spots a mistake should land where the text actually lives.
        baseUrl:
          'https://github.com/Evil0ctal/Douyin_TikTok_Download_API/edit/main/documents/',
      },

      // The sidebar is generated from the numeric prefixes the upstream files
      // carry. Those prefixes are ordering information; they do not belong in a
      // URL, so `sync-docs.mjs` strips them from the slug and writes the number
      // into `sidebar.order` instead.
      sidebar: [{ label: 'Documentation', items: [{ autogenerate: { directory: '.' } }] }],

      expressiveCode: {
        shiki: {
          // The installation page shows a Caddyfile, and Shiki ships no grammar
          // for one. Without this the build prints a warning per occurrence per
          // language on every deploy; the blocks render as plain text either
          // way, so the only thing the alias changes is the noise.
          langAlias: { caddyfile: 'plaintext' },
        },
      },

      customCss: ['./src/styles/custom.css'],

      head: [
        {
          tag: 'link',
          attrs: { rel: 'alternate', type: 'text/plain', href: '/llms.txt' },
        },
      ],
    }),

    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', zh: 'zh-CN' },
      },
    }),
  ],
})
