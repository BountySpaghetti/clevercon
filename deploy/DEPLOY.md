# Deploying CleverCon (Railway backend + Cloudflare Pages frontend)

This ships the full product on **testnet**: the API, workers, and indexer on
Railway with managed Postgres + Redis, and the dApp on Cloudflare Pages (free).
Contracts are already deployed on testnet, so this is only hosting.

Architecture:

- `services/api` (NestJS, public HTTPS) + `services/workers` + `services/indexer`
  (internal) all run from the one repo-root `Dockerfile`, each with its own start
  command.
- Postgres + Redis are Railway plugins, reached over Railway's private network.
- `apps/web` is a static SPA on Cloudflare Pages, pointed at the API's public URL.

Everything in "Your part" below is clickable dashboard work plus pasting env vars.
The repo already contains the `Dockerfile`, `.dockerignore`, the `$PORT` binding,
the `prisma` dependency, and the `db:deploy` script.

---

## Your part, step by step

### 1. Prereqs (5 min)
- A GitHub account with this repo pushed (done).
- A Railway account (railway.app). Hobby plan, ~$5/mo of usage included.
- A Cloudflare account (free) and a domain added to it (or use the free
  `*.up.railway.app` and `*.pages.dev` subdomains to start, no domain needed).
- Generate two secrets, keep them somewhere safe:
  ```
  openssl rand -hex 32   # JWT_SECRET
  openssl rand -hex 32   # DELEGATE_ENCRYPTION_KEY  (back this up!)
  ```

### 2. Create the Railway project + data stores (5 min)
1. New Project -> Deploy from GitHub repo -> pick this repo.
2. Add a database: **Add -> Database -> PostgreSQL**.
3. Add another: **Add -> Database -> Redis**.

### 3. The `api` service (10 min)
1. The first service Railway created from the repo is your `api`. Open it ->
   Settings.
2. **Build:** Builder = Dockerfile (it auto-detects the root `Dockerfile`).
3. **Start command:** leave default (the Dockerfile's `CMD` runs the api).
4. **Networking:** click **Generate Domain** (gives `*.up.railway.app`). This is
   your API URL for now; you can map `api.yourdomain.com` later.
5. **Health check path:** `/health`.
6. **Pre-deploy command** (applies the DB schema before the app starts):
   ```
   npm run db:deploy
   ```
7. **Variables:** paste from `deploy/.env.example`. For the two stores use Railway
   references, not literals:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `REDIS_URL` = `${{Redis.REDIS_URL}}`
   Set `CORS_ORIGINS` and `HOME_DOMAIN`/`WEB_AUTH_DOMAIN` to your frontend domain
   (you can set these to the Pages URL once you have it in step 5, then redeploy).
8. Deploy. When it's green, open `https://<api>.up.railway.app/health` -> expect
   `{"status":"ok"}`, and `/ready` -> `{"status":"ready", ...}`.

### 4. The `workers` and `indexer` services (10 min)
For each of these, add a new service **from the same repo** (Add -> GitHub repo ->
same repo), Builder = Dockerfile, **no public domain**, and set the **start
command**:
- workers: `node --import tsx services/workers/src/index.ts`
- indexer: `node --import tsx services/indexer/src/index.ts`

Give both the **same variables** as the api (same `DATABASE_URL`/`REDIS_URL`
references and the Stellar/secret vars). They do not need `PORT`, `CORS_ORIGINS`,
or the SEP-10 domains. Deploy both.

> Tip: in Railway you can duplicate the api service's variables, then just change
> the start command and remove the public domain.

### 5. The frontend on Cloudflare Pages (10 min, free)
1. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git ->
   this repo.
2. Build settings:
   - Framework preset: None/Vite
   - Build command: `npm ci && npm run build -w @clevercon/web`
   - Build output directory: `apps/web/dist`
3. Environment variables:
   - `VITE_BACKEND=full`
   - `VITE_NETWORK=testnet`
   - `VITE_API_URL=https://<your-api>.up.railway.app`
4. Deploy. You get `https://<project>.pages.dev` (or map `app.yourdomain.com`).
5. Go back to the Railway `api` (and workers/indexer) vars and set
   `CORS_ORIGINS`, `HOME_DOMAIN`, `WEB_AUTH_DOMAIN` to this Pages domain, then
   redeploy the api.

### 6. Smoke test (10 min)
- Open the Pages URL, connect Freighter (set to **testnet**), fund the vault, set a
  limit, instruct the agent, watch it settle. Check `/activity`.
- From your machine, point the harness at the live API:
  ```
  API_URL=https://<your-api>.up.railway.app npx tsx scripts/e2e-testnet.ts
  ```
  Expect 29/29.

### 7. (Later) custom domains + mainnet
- Map `api.yourdomain.com` (Railway) and `app.yourdomain.com` (Pages) via
  Cloudflare DNS.
- Mainnet is mostly a variable change (contract IDs, `USDC_SAC`,
  `NETWORK_PASSPHRASE`, `STELLAR_RPC_URL`, `NETWORK=mainnet`) plus an audit via the
  SCF Audit Bank. Do not flip to mainnet before the audit.

---

## Cost control
- Three small always-on services + Postgres + Redis. Idle usage is low; a quiet
  testnet app sits near the ~$5 Hobby credit. Watch the Railway usage meter.
- Keeping the frontend on Cloudflare Pages (not Railway) avoids paying compute to
  serve static files.

## Notes on how it's wired
- The services read config from Railway-injected env (no `.env` file in the
  image). `.env.example` here is the reference list.
- The api binds `$PORT` (Railway sets it); workers/indexer are background
  processes with no port.
- `db:deploy` runs `prisma db push --accept-data-loss`, safe on a fresh database
  and additive after; it is idempotent for the current schema.
