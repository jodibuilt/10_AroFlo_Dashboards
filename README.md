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

## What was asked for, and where it is

The reporting brief, item by item. "Contract clients" are Ventia and SAHA
(`KPI_TARGET_CLIENTS_JSON`); Work Orders and the KPI Matrix open on the two
together — the grouped total — and the client filter gives either alone, or
everyone in AroFlo.

| Asked for | Where | Notes |
|---|---|---|
| Results for Ventia, for SAHA, and a grouped total | Client filter on Work Orders and KPI Matrix | Opens on Ventia + SAHA |
| Breakdown of P1, P2, P3, P4 work orders, separately | Work Orders → Breakdown Work Orders (P1 – P4), one tab each | AP1–AP4 are counted with P1–P4 |
| Start date v Requested date | Requested Date and Actual Start Date columns | Start = first labour entry logged on the job |
| Completed date v Required completed date | Required Completed Date, Completed Date and Days Late columns | Required = the job's due date in AroFlo |
| Late because of materials or access | Delay Reason and Substatus columns; KPI Matrix "Comments" | **Delay Reason is empty until `KPI_DELAY_REASON_SUBSTATUSES` names the substatuses that mean this.** The Matrix comments are read from the job description |
| Preventative maintenance: P5s and PMs, same columns | Work Orders → Preventative Maintenance (P5 / PM) | AP5 is P5; SM is counted as PM |
| Work orders issued for the month | General Statistics → Issued | By requested date |
| Work orders completed for the month | General Statistics → Completed | Of those issued in the range, the ones now Completed / Archived |
| Work orders overdue for the month | General Statistics → Overdue | Open past due, or finished late |
| Work orders outstanding in the system | General Statistics → Outstanding, "open in system" beneath it | Outstanding is for the range; "open in system" is every loaded open job — back to the first day covered, no further |
| Completion rate, overdue rate | General Statistics | Overdue rate is overdue ÷ completed |
| KPI targets P1 98, P2 95, P3 90, P4 90, PM 90 | Work Orders → Target KPI Compliance; KPI Matrix rows 1–10 | `KPI_REPORTING_PRIORITY_TARGETS_JSON` |
| The 14-row KPI template (No., %, comments) | KPI Matrix, and its Excel export | Rows 12–14 need a CSV upload: AroFlo's API has no invoice-to-job link, checklists or compliance forms |
| Number of invoices submitted | Invoicing → Submitted | Status Approved or Processed |
| Value of invoices submitted | Invoicing → Submitted value | Inc GST, ex GST beside it |
| Split by Ventia, SAHA, Projects/Other | Invoicing → By client, and the client filter | By the client name on the invoice |

Each report page carries the same definitions under "How these figures are
worked out, and what they leave out".

## Is the data right?

Three things answer that, in order of how often they are needed.

**`npm test`** checks the arithmetic and the AroFlo client against cases
worked out by hand: when a work order counts as overdue, days late, the
statistics tiles, date ranges, client filters, compliance by priority level,
the ageing bands, invoice totals and paid/unpaid — and that the app only
reads from AroFlo, asks for the whole period, survives a rate-limit reply and
stops short of the daily allowance. It needs no AroFlo login.

**The `Data check` line in the server log**, written after every refresh,
describes what AroFlo actually sent: the dates covered, the statuses in use,
how many work orders have a due date / completed date / logged labour, how
invoices fall into the client groups, and how many payments link to an
invoice that is held. These are the things that go wrong silently — a status
the app doesn't count as completed, a client name that doesn't match the
configured one, payments that don't link.

**A spot check against AroFlo.** Nothing in the code can tell that AroFlo
itself holds the wrong due date or priority for a job. Pick a few work
orders from a table and compare them in AroFlo; the KPI Matrix page lists
the ones AroFlo sent with no priority.

### What the reports cover

**Up to two months back.** Work orders are included by **requested date**,
invoices by **date invoiced**, from the 1st of the month
`REPORT_LOOKBACK_MONTHS` (default 2) before the current one — in October,
from 1 August. This is deliberate and it is a limit: AroFlo answers
a request that has no date filter with only the last 30 days and says
nothing about it, so the app always asks from a stated day — and nothing
before that day is in any figure. The bar at the top of each report says
which day. In particular **Overdue & Ageing counts only open jobs requested
since then**; an older job that is still open is not in it.

### Definitions worth knowing

- A work order belongs to the month it was **requested** in. "Issued",
  "Completed", "Outstanding" and "Overdue" are all counts of work orders
  requested inside the date range — "Completed" is not "work finished during
  the range".
- **Completed** = status `Completed` or `Archived` (`COMPLETED_TASK_STATUSES`).
- **Outstanding** = issued − completed, for the range. **Open in system** =
  every loaded work order for the chosen clients that isn't completed.
- **Overdue** (statistics tiles, compliance) = open and past its due date,
  *or* finished after its due date. **Overdue & Ageing** is open jobs only.
- **Overdue rate** = overdue ÷ completed, as in the earlier dashboard. It can
  pass 100% when few jobs in the range are finished yet.
- **Target KPI Compliance** = share of a level's work orders that are not
  overdue. A job that is open and not yet due counts as on time.
- **Level 5** (AP5) has no SLA target, so it is in no compliance row; it is
  listed under "P5 / PM". The KPI Matrix puts it in the 30-day P4 tier.
- **Paid** = payments recorded against the invoice add up to its total.

## AroFlo's daily request allowance

AroFlo allows an API login a fixed number of requests a day — 2,000 on the
TTS account — and locks it out for the rest of the day once they are gone.
Everything that signs in with the same login shares it.

So this app **only reads AroFlo when someone presses "Refresh from AroFlo"**
on a report page. There is no timer and nothing is fetched at startup: after
a restart the reports are empty until the first press. One press reloads the
data for everyone, and the bar it sits in shows how old the data is. What is
left of the allowance, and what each refresh used, go to the server log
(`AroFlo requests left today`).

A refresh costs one request per page (`PAGE_SIZE` records) of each zone it
reads, so the cost follows `REPORT_LOOKBACK_MONTHS`: on the TTS account
roughly 15 requests for each month covered. A zone stops at
`MAX_PAGES_PER_ZONE` pages; if one does, the bar on the report pages says the
data is short. `MIN_MANUAL_REFRESH_INTERVAL_SECONDS` is the shortest gap
allowed between presses.

The app also protects the login: once less than 10% of the allowance is left
a refresh skips Tasks, Invoices and Payments, keeps showing what it already
has, and says so in the bar. It still reads the one-request priority list,
which is how it notices the allowance has reset.

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
| `src/cache.js` | fetches Priorities, Tasks, Invoices and Payments only, each from a stated first day — **`test_all_aroflo` asks for Tasks and Invoices with no date and so only ever holds the last 30 days**; manual refresh; allowance guard |
| `src/payments.js` | takes the first day to load from, and reports when AroFlo fell back to its 30-day default |
| `src/config.js`, `src/normalize.js` | trimmed to what the above use |
| `src/db.js` | replaces `src/engine/db.js`; just `app_settings` and `dashboard_edits` |
| `src/aroflo/AroFloClient.js`, `query.js` | write methods removed, and any non-GET request refused; a retry no longer freezes the refresh — **`test_all_aroflo` has the same freeze** (see below); requests evenly spaced; daily allowance noted |
| `src/auth/seed.js` | adds the short-password warning |
| `frontend/src/App.tsx`, `components/Sidebar.tsx`, `components/Header.tsx`, `types.ts` | shell for two tabs; no quick-action or job search |
| `frontend/public/admin.*` | the user-management page, served by the app |
| `frontend/src/reporting/overdueAgeing/OverdueAgeingSection.tsx`, `reporting/types.ts` | the overdue table has no "Assigned" column |
| `frontend/src/reporting/ReportingDashboardView.tsx` | takes its pane and its theme from the app shell (optional `tab` / `themeMode` props) and then hides its own switchers; no "Striped table rows" checkbox — tables are always striped |
| `frontend/src/reporting/kpiMatrix/KpiMatrixSection.tsx`, `kpiMatrix/ingest.ts` | the matrix reads live AroFlo work orders; a CSV upload is an optional override |
| `frontend/src/nav.ts` | no Reports sub-tabs — the report panes are sidebar tabs here |
| `frontend/src/reporting/plotly.ts` | `autosize: true` in the shared chart layout — **a bug fix `test_all_aroflo` needs too** (see below) |
| `frontend/src/reporting/components/EditableTable.tsx` | shows live rows unless the user has edited the table; saves only real edits — **a bug fix `test_all_aroflo` needs too** (see below) |
| `frontend/src/reporting/charts/TrendChart.tsx` | builds its list of days in UTC — in local time a range crossing a daylight-saving change repeated a day and dropped the last one. Also wrong in `test_all_aroflo` |
| `frontend/src/reporting/AnalyticsTab.tsx` | the status chart takes the full row when one company is picked; PM hint reworded |
| `frontend/src/reporting/invoicing/InvoicingTab.tsx` | tables get a surface background so their row stripes show (they were the page colour on the page) — also wrong in `test_all_aroflo` |

Only in this app: `src/dark.css`, `hooks/useThemeMode.ts`,
`services/reportingKpiMatrix.ts`, `services/reportingRefresh.ts`,
`reporting/components/ClientMultiSelect.tsx` and
`reporting/components/RefreshControl.tsx` under `frontend/src`;
`src/priorities.js`; and the `/api/reporting/kpi-matrix` route.

**No background refresh.** `test_all_aroflo` re-reads AroFlo every few
minutes; this app only does it on the Refresh button (see "AroFlo's daily
request allowance" above).

**"Task ID" is the job number.** The breakdown tables and their Excel / PDF
exports printed AroFlo's internal `taskid` code; `buildReportingKpis` now puts
the job number in that field.

**Client filters take several clients.** On all three report pages the
client filter is a checklist, not a single pick. The selection travels as
one `view` value with the names joined by `||` (`src/views.js` splits it),
so the endpoints and the per-view saved edits still take a single string.

**Tables that froze and showed the wrong client, fixed here and still present
in `test_all_aroflo`:** `EditableTable` copied its rows into state and saved
that copy as an "edit" the first time a table was shown. Two results. The
copy was taken before the new filter's data arrived, so after changing
client or dates the table kept the previous selection's rows. And the saved
copy was then shown instead of live data for that client and date range from
then on. Now the table renders the live rows directly, only a change the
user makes becomes an edit, and an edited table says so with a Reset link.
Saved payloads without the new `edited` mark are those old snapshots and are
ignored (they stay in `dashboard_edits`; nothing reads them).

**Frozen refresh, fixed here and still present in `test_all_aroflo`:** when
AroFlo answered a request with "Exceeded Per Second Rate Limit", the client
retried from inside the rate-limiter job that was still running. With
`RATE_LIMIT_PER_SECOND=1` (the default) that job holds the only slot, so the
retry never started, the refresh never finished, and every later refresh was
skipped as "already in progress" — the data silently stopped updating until
a restart. `send()` now retries after the job has finished.

**Chart sizing bug, fixed here and still present in `test_all_aroflo`:**
Plotly keeps the size of its first draw unless the layout says
`autosize: true`. Several charts size their box from the data, so changing
the company left a chart spilling out of a box that had shrunk, or small in
one that had grown. The fix is the one line in `baseLayout`.

Six behaviours differ from the Reports tab in `test_all_aroflo`:

- **Priorities are named by AroFlo, not by a table of ids.** Each refresh
  reads the account's own priority list (the `Priorities` zone), so a task's
  priority shows under the name AroFlo gives it. The level on the P1–P5 / PM
  scale is read from that name: `P2`, `AP2` and `Priority Level 2 - …` are
  all level 2; `PM` and `SM` are both PM. A name that doesn't state a level
  takes one from `KPI_PRIORITY_CODE_MAP_JSON`; anything else stays off the
  scale and shows under its own name. The server log lists which names
  landed on which level whenever the list changes
  (`AroFlo priorities by level`).
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
