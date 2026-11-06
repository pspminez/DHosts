# StayXI

[![CI](https://github.com/pspminez/DHosts/actions/workflows/ci.yml/badge.svg)](https://github.com/pspminez/DHosts/actions/workflows/ci.yml)

The AI text line for independent vacation rentals. Each property gets its own
number, guests text it, and the answer comes back from the guide the host
approved. A Davenport Host Co product.

## What's in here

| Path | What it is |
|---|---|
| `bot/` | The Cloudflare Worker: guest text line, admin panel, host portal |
| `site/` | The marketing site, deployed to Cloudflare Pages |
| `tools/` | Verification: rendered-UI checks, production smoke, screenshots, Lighthouse |
| `schema.sql`, `migrations/` | D1 schema and incremental migrations |
| `wrangler.toml` | Worker configuration: D1, KV, routes |

## Checks

```bash
npm install
npm test                  # unit suite + landing-page and setup-doc checks
npm run typecheck
npm run check:predeploy   # live smoke against production, then the Lighthouse floors
```

`npm run check:predeploy` reads `STAYXI_ADMIN_PASSWORD` from the environment, or
from the git-ignored `.dev.vars` at the repo root. CI runs the typecheck and the
test suite on every push and pull request, and the pre-deploy gate on `main`.

## Docs

- [Deploy guide](bot/README.md)
- [Launch readiness](LAUNCH_READINESS.md)
- [Pilot program](PILOT_PROGRAM.md)
- [A2P and messaging notes](A2P_NOTES.md)
