# ux-explorer

The walkthrough driver for `docs/ux-walkthrough-playbook.md`. Not wired into
CI — this is an instrument for discovery passes, not a test runner.

## Boot the target (in-container recipe, learned in Session 0)

Docker Hub is egress-blocked in remote sessions, so the `tools/test-db`
compose route is unavailable there; the working recipe is native services:

```bash
apt-get install -y --no-install-recommends postgresql-16
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" -c "CREATE DATABASE forma360;"
redis-server --daemonize yes --port 6379

pnpm install --frozen-lockfile
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forma360 pnpm --filter @forma360/db db:migrate
# apps/web/.env — copy the e2e job's env block from .github/workflows/ci.yml,
# BRAND=freehs / NEXT_PUBLIC_BRAND=freehs, DB/Redis pointed at the above.
NODE_ENV=production pnpm --filter @forma360/web build
pnpm --filter @forma360/web start &
```

On a machine with Docker Hub access, `docker compose -f
tools/test-db/docker-compose.yml up -d` replaces the first block (ports 5433 /
6380 — adjust `.env`).

## Drive

```bash
# mint a seeded workspace (W2) and look at where it lands
node tools/ux-explorer/explore.mjs --session uxw4 --actions '[
  {"provision": {"scenarioId": "permit", "refinementId": "hotWork"}},
  {"screenshot": "landing"}
]'

# continue the same signed-in session (profile persists) on a phone, offline
node tools/ux-explorer/explore.mjs --session uxw2 --device phone-390 --offline \
  --actions '[{"goto": "/en/my-work"}, {"screenshot": "offline-my-work"}]'
```

Every invocation prints each step, ends with the final URL/title, a
screenshot, and an aria snapshot of the page — the look/predict/act/compare
loop runs on those. Profiles and screenshots live under `UXW_WORK_DIR`
(default: system tmp). `--delay 3000` is world W5's slow-mutation switch;
`{"offline": true}` toggles mid-batch. A failed action exits non-zero with a
`FAILED` screenshot — in a walkthrough that is a finding, not a flake.

`coverage.mjs` regenerates `docs/reviews/ux-walkthrough-coverage.md`, the
master route ledger the passes tick against.
