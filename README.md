# AroFlo Dashboards

The Reports and Tools sections of `test_all_aroflo`, as a standalone app.

| Section | What's in it |
|---|---|
| **Reports** | KPI Matrix (live, or from a CSV upload), Work Orders (live analytics, overdue & ageing, breakdowns, Excel/PDF export), Invoicing |
| **Tools** | Ventia Work Order Consolidator |

Everything else in `test_all_aroflo` — jobs, schedule, rollover, inventory,
maps, the trigger engine, webhooks — is deliberately not here.

**This app only reads from AroFlo.** Its API client has GET and nothing else,
and refuses to send any other kind of request (`src/aroflo/AroFloClient.js`),
so no setting or bug can make it write.

## Run it locally

Needs Node 22.13 or newer.

```bash
npm install
npm run build        # installs and builds frontend/ into frontend/dist
cp .env.example .env # then fill in the AroFlo credentials and an admin login
npm start            # http://localhost:4300
```

For frontend work, run `npm start` in one terminal and `npm run dev` inside
`frontend/` in another; Vite serves on port 3000 and proxies `/api` and
`/auth` to 4300.

Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Add other people under
**Settings (cog) → Manage users**. Admins can hide tabs and sub-tabs for
everyone under **Manage navigation**.

## Configuration

`.env.example` documents every setting. The variable names match
`test_all_aroflo`, so an existing `.env` works as-is — this app reads fewer
of them. The one new name is `APP_DB_PATH`.

Local state is two small SQLite files:

| File | Setting | Holds |
|---|---|---|
| `data/auth.sqlite` | `AUTH_DB_PATH` | sign-in accounts and sessions |
| `data/dashboards.sqlite` | `APP_DB_PATH` | hidden tabs, each user's saved Reports edits and chart colours |

Both tables in `dashboards.sqlite` have the same definition as in
`test_all_aroflo`'s `engine.sqlite`, so pointing `APP_DB_PATH` at a copy of
that file carries existing edits across.

## Deploy to Azure App Service

A single always-on Linux App Service running Node. The package is built here
and deployed as-is — Azure runs no build step.

### 1. Create the resources (once)

Names below follow the existing `rg-tts-integrations` convention; change them
if you prefer. The app name must be globally unique.

```powershell
$RG   = "rg-tts-integrations"
$PLAN = "plan-aroflo-dashboards-prod"
$APP  = "app-aroflo-dashboards-tts-prod"

az appservice plan create -g $RG -n $PLAN --is-linux --sku B1 --location australiaeast
az webapp create -g $RG -p $PLAN -n $APP --runtime "NODE:22-lts"
az webapp update -g $RG -n $APP --https-only true
az webapp config set -g $RG -n $APP --startup-file "node src/server.js" --always-on true --min-tls-version 1.2 --ftps-state Disabled
```

Keep it at **one instance**. The AroFlo cache lives in memory and the SQLite
files allow one writer, so scaling out would give each instance its own view.

### 2. App settings

```powershell
Copy-Item deploy\appsettings.example.json deploy\appsettings.json   # git-ignored
# fill in deploy\appsettings.json, then:
az webapp config appsettings set -g $RG -n $APP --settings "@deploy/appsettings.json"
```

What the non-obvious ones are for:

- `AUTH_DB_PATH`, `APP_DB_PATH` → under `/home/data`. Only `/home` survives a
  redeploy; the default relative `data/` sits inside the deployed code and is
  wiped each time, taking every account and saved edit with it.
- `COOKIE_SECURE=true` → the session cookie is HTTPS-only.
- `TZ`, `WEBSITE_TIME_ZONE` → "overdue" and "days late" are computed in local
  time. Without these the app runs in UTC and those boundaries shift.
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false` → the zip already contains
  `node_modules` and the built frontend.
- Do **not** set `PORT`. App Service supplies it.

### 3. Package and deploy

```powershell
python scripts\package.py        # -> C:\tmp\aroflo-dashboards-pkg.zip
az webapp deploy -g $RG -n $APP --src-path C:\tmp\aroflo-dashboards-pkg.zip --type zip
```

`package.py` builds the frontend, installs production dependencies into a
short staging path, writes the zip with forward-slash entries (Windows zip
tools write `\`, which Linux reads as part of the filename), and refuses to
finish if a `.env` or `.sqlite` file of ours ended up inside.

### 4. Check it

```powershell
$SITE = az webapp show -g $RG -n $APP --query defaultHostName -o tsv
curl.exe "https://$SITE/healthz"     # {"ok":true}
az webapp log tail -g $RG -n $APP
```

In the log, look for `Refreshed Tasks`, `Refreshed Invoices` and
`Refreshed Payments` with real counts. `Failed to refresh … Authentication
Failed` means the AroFlo credentials in the app settings are wrong or revoked.
Then sign in and open Work Orders.

Judge the deploy by `/healthz` and the log, not by the CLI's exit line. The
earlier `test_all_aroflo` deploy printed "Site failed to start within 10 mins"
while the app was in fact up.

### Before sharing the URL

- Set a long random `ADMIN_PASSWORD`. The app logs a warning on every boot
  while it is shorter than 8 characters, but it will still start.
- There is no sign-in throttling. If this stays on the public internet,
  restrict who can reach it — App Service **Networking → Access restrictions**
  (office IPs), or **Authentication** with Microsoft Entra in front.

## Keeping in step with test_all_aroflo

Most of this repo is copied unchanged from `test_all_aroflo`, so a fix made
in one repo's Reports or Tools code needs applying to the other.

```bash
npm run check-drift   # are the copied files still identical to ../test_all_aroflo?
```

The list of copied files is in `scripts/checkDrift.js`. These were rewritten
for this app and are not checked:

| File | Difference |
|---|---|
| `src/server.js` | only the auth, nav-settings, reporting and dashboard-edits routes; adds `/healthz`, gzip, long-lived caching for hashed assets |
| `src/views.js` | only the four reporting builders |
| `src/cache.js` | fetches Tasks, Invoices and Payments only |
| `src/config.js`, `src/normalize.js` | trimmed to what the above use |
| `src/db.js` | replaces `src/engine/db.js`; just `app_settings` and `dashboard_edits` |
| `src/aroflo/AroFloClient.js`, `query.js` | write methods removed |
| `src/auth/seed.js` | adds the short-password warning |
| `frontend/src/App.tsx`, `components/Sidebar.tsx`, `components/Header.tsx`, `types.ts` | shell for two tabs; no quick-action or job search |
| `frontend/public/admin.*` | the user-management page, served by the app |
| `frontend/src/reporting/overdueAgeing/OverdueAgeingSection.tsx`, `reporting/types.ts` | the overdue table has no "Assigned" column |
| `frontend/src/reporting/ReportingDashboardView.tsx` | takes its pane and its theme from the app shell (optional `tab` / `themeMode` props) and then hides its own switchers |
| `frontend/src/reporting/kpiMatrix/KpiMatrixSection.tsx`, `kpiMatrix/ingest.ts` | the matrix reads live AroFlo work orders; a CSV upload is an optional override |
| `frontend/src/nav.ts` | no Reports sub-tabs — the report panes are sidebar tabs here |

Only in this app: `src/dark.css`, `hooks/useThemeMode.ts` and
`services/reportingKpiMatrix.ts` under `frontend/src`, and the
`/api/reporting/kpi-matrix` route.

Five behaviours differ from the Reports tab in `test_all_aroflo`:

- **KPI Matrix, Work Orders and Invoicing are sidebar items** under
  Dashboards, not sub-tabs of one Reports tab. Admins hide each one under
  Manage navigation → Sidebar tabs.
- **The KPI Matrix is live.** It reads work orders from the AroFlo cache
  (`/api/reporting/kpi-matrix`) with no upload needed; uploading a CSV export
  replaces the live data until it is cleared. Live mode measures KPIs 1–11
  only — AroFlo's API has no invoice-to-task link, checklists or compliance
  forms, so 12–14 read N/A unless a CSV is uploaded. "Commenced" is the first
  labour entry logged on the job (the CSV uses Schedule Start), and a due date
  with no time counts as due by the end of that day.
- **Light / dark is app-wide.** The switch is in the header and covers the
  shell, Tools, modals, login and the Manage users page, not just Reports.
  Dark styling for everything outside Reports lives in `frontend/src/dark.css`.
- **No "Assigned" column** in the overdue table. It was filled from staff
  assignments made on the Jobs and Map screens, which this app doesn't have.
- **Delay reason** in the breakdown tables uses each work order's current
  substatus. `test_all_aroflo` can also use substatus history recorded by its
  trigger engine. This only matters once `KPI_DELAY_REASON_SUBSTATUSES` is set;
  it is empty by default in both apps.
