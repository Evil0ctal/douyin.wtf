# douyin.wtf

The landing page and documentation site for
[Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API).

| | |
|---|---|
| Landing and docs | <https://douyin.wtf> |
| Live console demo | <https://demo.douyin.wtf> |
| The project itself | <https://github.com/Evil0ctal/Douyin_TikTok_Download_API> |

## The documentation is not written here

`documents/` in the upstream repository is the only copy. It sits next to the
code it describes — the configuration reference lists real settings, the CLI
reference tracks real commands — so a second copy here would be a copy that
drifts, and the drifting one would be the one search engines index.

The upstream repository is a submodule at `vendor/upstream`. `npm run sync`
reads `vendor/upstream/documents/`, applies the transformations that turn
GitHub-flavoured markdown into site pages, and writes `src/content/docs/`.
That directory is generated and git-ignored. Do not edit it.

To pick up new upstream docs:

```bash
git submodule update --remote
git commit -am "chore: follow upstream docs"
```

## Running it

```bash
git clone --recurse-submodules https://github.com/Evil0ctal/douyin.wtf.git
cd douyin.wtf
npm install
npm run dev
```

Already cloned without submodules:

```bash
git submodule update --init --recursive
```

| Command | What it does |
|---|---|
| `npm run sync` | Regenerate `src/content/docs/` from the submodule |
| `npm run dev` | Sync, then start the dev server |
| `npm run build` | Sync, build to `dist/`, generate `llms.txt` and `llms-full.txt` |
| `npm run preview` | Serve `dist/` locally |

## Deployment

The site runs on the same host as the console demo, as one nginx container
behind the existing Cloudflare tunnel.

```
douyin.wtf        -> tunnel -> 127.0.0.1:8080   this site
demo.douyin.wtf   -> tunnel -> 127.0.0.1:8000   the console
```

**CI builds; the server only pulls.** Pushing to `main` builds the image and
publishes it to `ghcr.io/evil0ctal/douyin-wtf`. The host has two cores and
shares ~2 GB of free memory with a headless Chromium, so an `npm ci` there is a
way to take PostgreSQL down with it.

On the server:

```bash
cd /opt/douyin-wtf
git pull
./sitectl pull
./sitectl up -d
```

`./sitectl` is the only entry point, and it exists for one reason: it carries
`-p douyin-wtf`. The API stack on that host is `-p dtk`, and a bare
`docker compose` here would invent a project name from the directory.

| | |
|---|---|
| Image | `ghcr.io/evil0ctal/douyin-wtf:latest`, or a `sha-` tag to pin |
| Port | `127.0.0.1:8080`, loopback only — the host opens nothing inbound |
| Footprint | 32 MB image, ~17 MB resident, capped at 96 MB |
| State | None. No volumes, nothing to back up; `pull && up -d` rebuilds it exactly |

Caching is described here and done by Cloudflare: HTML is `s-maxage=600`, hashed
assets under `/_astro/` are immutable for a year. The edge absorbs the traffic so
a single droplet does not have to.

### Cloudflare Pages instead

Nothing stops it — build command `npm run build`, output `dist`, Node 22,
submodules enabled. It would be less to operate and faster worldwide. It is not
what this deploys to, because the tunnel and the box were already there.

## Two build warnings that are expected

`The collection "i18n" does not exist or is empty` and `Entry docs → 404 was not
found` are Starlight noticing that this site does not override its interface
strings or its 404 page. Supplying either produces a different warning - an
empty i18n directory, or a route collision with Starlight's own `/404` - so both
are left alone deliberately. Anything else in a build log is worth reading.

## Design documents

They are not in this repository either. They live with the project, in
`docs/douyin-wtf/` of the upstream checkout — which is git-ignored there and
local-only, so this repository stays what it says it is: the code that builds
the site.
