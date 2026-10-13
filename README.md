# AroFlo Dashboards

The Reports and Tools 

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
together — the grouped total. The client filter is the same three groups on
every dashboard: Ventia, SAHA, and Projects / Other (every other company
taken together). Nothing ticked is everyone.

| Asked for | Where | Notes |
|---|---|---|
| Results for Ventia, for SAHA, and a grouped total | Client filter on Work Orders and KPI Matrix | Opens on Ventia + SAHA |
| Breakdown of P1, P2, P3, P4 work orders, separately | Work Orders → Breakdown Work Orders (P1 – P4), one tab each | AP1–AP4 are counted with P1–P4 |
| Start date v Requested date | Requested Date and Actual Start Date columns | Start = first labour entry logged on the job |
| Completed date v Required completed date | Required Completed Date, Completed Date and Days Late columns | Required = the job's due date in AroFlo |
| Late because of materials or access | Delay Reason and Substatus columns; KPI Matrix "Comments" | Late jobs only: the current substatus if it is Non Access, Materials Ordered, On Hold/Materials Required or Sent to Procurement, otherwise a keyword match in the job's notes, marked "(from notes)". **It explains a late job; it does not excuse it — the figures count it as late either way.** The Matrix comments are read from the job description |
| Preventative maintenance, same columns | Work Orders → Preventative Maintenance (PM) | AP5 is counted with P4, so SAHA's AP5 jobs are on the P4/P5 tab of the breakdown above, not here |
| Work orders issued for the month | General Statistics → Issued | By requested date |
| Work orders completed for the month | General Statistics → Completed | Of those issued in the range, the ones now Completed / Archived |
| Work orders overdue for the month | General Statistics → Overdue | Open past due, or finished late |
| Work orders outstanding in the system | General Statistics → Outstanding, "open in system" beneath it | Outstanding is for the range; "open in system" is every loaded open job — back to the first day covered, no further |
| Completion rate, overdue rate | General Statistics | Overdue rate is shown both ways, each tile saying which: overdue ÷ issued, and overdue ÷ completed |
| KPI targets P1 98, P2 95, P3 90, P4 90, PM 90 | Work Orders → Target KPI Compliance; KPI Matrix rows 1–10 | `KPI_REPORTING_PRIORITY_TARGETS_JSON` |
| The 14-row KPI template (No., %, comments) | KPI Matrix, and its Excel and PDF | Rows 12–14 are left blank, and say so, until a CSV export is uploaded: AroFlo's API has no invoice-to-job link, checklists or compliance forms |
| Number of invoices submitted | Invoicing → Submitted | Status Approved, In Progress or Processed. In Progress has gone to the client, so it counts; the tile says how many are in progress |
| Value of invoices submitted | Invoicing → Submitted value | Inc GST, ex GST beside it |
| Split by Ventia, SAHA, Projects/Other | Invoicing → By client, and the client filter | By the client name on the invoice |

Each report page carries the same definitions under "How these figures are
worked out, and what they leave out".

### Finding things in the tables

The long tables — the Work Orders breakdowns, the overdue list, the invoice
list and the Matrix's late jobs — all work the same way:

- **Click a heading to sort**: smallest first, again for largest first, a
  third time for the order the table opened in.
- **A filter under each heading.** A box matches what the cell shows ("sep"
  finds every September date, a job number finds the job); a list offers the
  values in the column; a number column takes "at least" — `1` in Days Late
  is the late jobs, which the breakdown tables also have as a **Late only**
  button.
- **A count** above the table says how many rows are showing, with **Clear
  filters** once any are on.
- **Quick range** buttons above Work Orders and Invoicing set the dates to a
  whole month, this month so far, or everything loaded.

Sorting and filtering are for looking at a table. The tiles, charts and the
Excel / PDF reports are worked out from every row whatever is filtered.

### Downloading

Everything on the report pages can be taken away as a file.

| What | Where | Holds |
|---|---|---|
| Work Orders report — Excel, PDF | "Download report" under the date pickers, and again at the foot of the page | General Statistics (with open in system), Target KPI Compliance, both breakdown tables in full, the Overdue & Ageing summary and list, notes on what the figures cover; the PDF also has the charts |
| Invoicing report — Excel, PDF | the same two places on Invoicing | Summary, By client, By status, every invoice in the range |
| KPI Matrix — Excel, PDF | "Download report" beside the month and tier filters | the 14-row matrix, the late jobs behind it, notes |
| Any long table — CSV | "Download CSV" above the table | that table exactly as it is showing: filters, sort and any on-screen edits applied |

One click each; the file is built and saved straight away, for the clients
and dates chosen. A table that has been edited on screen with the pencil goes
into the Excel and PDF as edited — changed cells, added rows, added columns —
and the report's notes say which tables were. (General Statistics are never
editable, so are always as loaded.) A filter or a sort on a table changes
nothing in the reports; the CSV is the one that follows what is showing.

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
how many work orders have a due date / completed date / logged labour /
notes, how many late ones got a delay reason and from where, how invoices
fall into the client groups, and how many payments link to an invoice that
is held. These are the things that go wrong silently — a status
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

### Adelaide time

The reports run on **Adelaide time** (`REPORT_TIME_ZONE`, default
`Australia/Adelaide`) — not on the clock of the machine the server runs on,
and not on each person's browser. That decides:

- what day **today** is: which jobs are overdue, how many days late, where
  "this month" starts, and the first day the data is loaded from;
- the **times shown** ("AroFlo data as of 13 Oct, 8:30 am ACDT");
- the **date stamped** on an Excel or PDF report and in its file name.

So a server hosted on UTC, or someone opening the page from Manila or
Darwin, gets the same figures and the same dates as someone in Adelaide.
AroFlo's own dates are shown as AroFlo sends them. `src/time.js` and
`frontend/src/reporting/time.ts` are the two places this is done; the tests
re-run every report on machines set to UTC, Honolulu and London.

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
- **Overdue rate** is given both ways, each tile saying which: overdue ÷
  issued, and overdue ÷ completed (as in the earlier dashboard). The second
  can pass 100% when few jobs in the range are finished yet.
- **Target KPI Compliance** = on time ÷ (on time + late), for each level.
  A job that is open and not yet due is **in progress**: counted in its own
  column, and in neither side of the percentage. A level with nothing
  finished or overdue yet has no percentage, and reads "In progress".
- **AP5 is counted with P4**: the same 30-day window and the same 90%
  target, on both pages. A group that holds AP5 jobs is headed "P4/P5"; each
  breakdown table has a Priority column with the job's own.
- **Delay Reason** is given for late work orders only, from the two places
  AroFlo can hold one. First the job's **current substatus**, when it is
  Non Access, Materials Ordered, On Hold/Materials Required or Sent to
  Procurement (`KPI_DELAY_REASON_SUBSTATUSES`). Failing that the job's **notes**, searched
  for wording about materials or access and shown as e.g. "Non Access (from
  notes)". The notes match is on keywords — "ordered", "parts", "no access" —
  so it is a prompt to read the job, not a finding. AroFlo keeps no history
  of substatuses: a job that was held up and has since moved on shows a
  reason only if a note says so. "-" means neither place gave one. A delay
  reason changes no figure — a late job counts as late whatever the cause.
- **Paid** = payments recorded against the invoice add up to its total.

### Why the two pages agree

Work Orders and the KPI Matrix use one rule for a late work order: **finished
after its due date, or still open past it**, judged by day (finished any time
on the due date is on time), with "finished" taken from the status. The due
date on the job in AroFlo is the deadline.

So for the same clients and the same month, a Matrix "Completed" row and
that priority's line under Target KPI Compliance on Work Orders show the
same three counts — on time, late, in progress — and the same percentage, on
time ÷ (on time + late). A late job is listed with the same number of days
late on both pages.

The Matrix has one thing Work Orders does not: **Commenced**, whether a job
was started in time. AroFlo's substatus says where a job is now, not when it
got there, so this is read as follows (`reporting/kpiMatrix/ingest.ts`):

- *started* = finished, In Progress, or a substatus of Materials Ordered, On
  Hold/Materials Required, Sent to Procurement, Non Access, Ready for
  Invoicing, To be Reviewed, Re-book or Job Cancelled;
- *late to start* = still not started once the priority's time limit has
  passed (P1 the same day if requested before 1 pm, otherwise the next day;
  P2 3 days; P3 14; P4/AP5 and PM 30);
- a job that has been started counts as on time, because nothing records
  when it began — so Commenced percentages lean generous;
- not started and still inside the limit is in progress.

A job can therefore be in the Matrix's "Late jobs" for starting late without
being overdue; the list's **Late for** column says which it was. With an
uploaded CSV the Matrix works as the original spec has it, from the export's
own start dates.

The `Data check` log line splits the late work orders into "finished after
its due date" and "still open past its due date". Both pages state the late
rule in one line under their filters (`reporting/components/LateRuleNote.tsx`).

### Still to be confirmed

The rules above were confirmed by the business on 13 October 2026, bar one:
whether the P1–P4 time limits for *starting* a job are the contracts' own.
**[docs/to-confirm.md](docs/to-confirm.md)** has that question, how Commenced
works in plain words, notes for whoever runs the dashboards, and the table
of what was confirmed.

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

One always-on Linux App Service running Node. The package is built here and
deployed as-is — Azure runs no build step.

### What it needs

Measured on 13 October 2026 by booting the deployment package itself on Node
24 against a stand-in for AroFlo holding what the TTS account holds (3,000
work orders with notes, 3,200 invoices, 2,988 payments):

| | Measured | B1 gives |
|---|---|---|
| Memory, data loaded | 93 MB | 1.75 GB |
| Memory, worst case — a refresh landing while reports are reloaded in a loop | 426 MB peak | 1.75 GB |
| CPU for a refresh | 1.6 s of CPU over the 50 s it takes (it is paced at one AroFlo request a second) | 1 core |
| CPU for a report | about 35 ms each; 10–75 ms to answer one visitor | 1 core |
| 20 people opening every report at once | all answered, half within 0.4 s, the slowest in 1.6 s | — |
| Disk | 15 MB of code (a 3.8 MB zip), two database files of 20 KB | 10 GB |
| Start-up | under a second | — |

Those times are from a desktop PC; a B1 core is slower, so allow two to three
times as long. With three people using it that is still well inside one
**B1** (1 core, 1.75 GB): the smallest plan that has **Always On**, which
this app needs because the loaded AroFlo data lives in memory. On the Free
plan the app is unloaded after about twenty idle minutes, and every visit
would then start with a Refresh — 47 requests from the shared AroFlo
allowance each time.

| Resource | Setting | About, per month |
|---|---|---|
| Resource group | `rg-tts-integrations` (exists, Australia East) | — |
| App Service plan | Linux, **B1**, one instance | A$20 |
| Web app | Node 24 LTS, Always On, HTTPS only | on the plan |
| Storage | the plan's own `/home` share, for the two database files | on the plan |
| Outbound data | a few hundred MB at most; the first 100 GB is free | A$0 |

The price is Azure's list price for Australia East, before GST, read on 13
October 2026 (B1 Linux A$0.0271 an hour). The next size up, B2, is A$38;
nothing measured suggests needing it. There is no database server, no
storage account and no Application Insights to pay for.

Go up a size only if the plan's memory stays above about 1.2 GB or its CPU
above 70% for long stretches (App Service plan → Metrics). Neither is near.

### The short way

`scripts\deploy-azure.ps1` does steps 1 to 4 below. The first deploy and
every later one are the same command.

```powershell
.\scripts\deploy-azure.ps1 -InitSettings   # once: writes deploy\appsettings.json
.\scripts\deploy-azure.ps1 -Check          # changes nothing; says what a deploy would do
.\scripts\deploy-azure.ps1                 # creates what is missing, deploys, waits for /healthz
```

- **`-InitSettings`** builds `deploy\appsettings.json` (git-ignored) from
  the local `.env`: the AroFlo login and any report settings changed
  locally come across, the settings that differ on App Service are set for
  it, and it makes a new 24-character admin password — which is in the file,
  and is what you sign in to the deployed site with. Only the settings this
  app reads (`.env.example`) are taken; anything else in `.env` stays put.
  No value is printed, only names. If `AROFLO_HOST_IP` is set locally it
  says so and leaves it out.
- **Before touching Azure** it checks the settings file: no placeholder
  left, an admin password of 12 characters or more, a secure cookie, the
  databases under `/home`, no `PORT`. It stops if any of that is wrong.
- **It creates the plan and the web app only if they are not there**, so
  running it again is just a redeploy. Other names or a different size:
  `-Plan`, `-App`, `-ResourceGroup`, `-Sku`.

**Or keep the secrets out of files altogether** — this is how the site was
first deployed, on 13 October 2026:

```powershell
.\scripts\deploy-azure.ps1 -SettingsInPortal
```

No settings file is used. The script applies the plain settings from
`deploy\appsettings.example.json` (only the ones the app does not have yet,
so a value changed in the portal later is left alone), and these six are
added by hand in the Azure portal, under the web app's **Settings →
Environment variables → App settings**:

| Setting | What goes in it |
|---|---|
| `AROFLO_SECRET_KEY`, `AROFLO_UENCODED`, `AROFLO_PENCODED`, `AROFLO_ORG_ENCODED` | the AroFlo API login, as in the local `.env` |
| `ADMIN_USERNAME` | the admin's sign-in name |
| `ADMIN_PASSWORD` | 12 characters or more — not the local one |

The app does not start until they are there, and the script says so
instead of waiting for it. Pressing **Apply** in the portal restarts the
app with them. Later deploys are the same command; once the six are in
place it waits for `/healthz` as usual.

The steps it runs, for doing them by hand or seeing what it did:

### 1. Create the resources (once)

Names below follow the existing `rg-tts-integrations` convention; change them
if you prefer. The app name must be globally unique.

```powershell
$RG   = "rg-tts-integrations"
$PLAN = "plan-aroflo-dashboards-prod"
$APP  = "app-aroflo-dashboards-tts-prod"

az appservice plan create -g $RG -n $PLAN --is-linux --sku B1 --location australiaeast
az webapp create -g $RG -p $PLAN -n $APP --runtime "NODE:24-lts"
az webapp update -g $RG -n $APP --https-only true
az webapp config set -g $RG -n $APP --startup-file "node src/server.js" --always-on true --min-tls-version 1.2 --ftps-state Disabled
az webapp log config -g $RG -n $APP --docker-container-logging filesystem
```

Node 24 is supported by Azure until April 2028; the tests also pass on Node
22, whose support ends April 2027.

Keep it at **one instance**. The AroFlo cache lives in memory and the SQLite
files allow one writer, so scaling out would give each instance its own view.

### 2. App settings

```powershell
Copy-Item deploy\appsettings.example.json deploy\appsettings.json   # git-ignored
# fill in deploy\appsettings.json, then:
az webapp config appsettings set -g $RG -n $APP --settings "@deploy/appsettings.json" -o none
```

`-o none` keeps az from echoing the settings back to the screen. What the
non-obvious ones are for:

- `AUTH_DB_PATH`, `APP_DB_PATH` → under `/home/data`. Only `/home` survives a
  redeploy; the default relative `data/` sits inside the deployed code and is
  wiped each time, taking every account and saved edit with it.
- `COOKIE_SECURE=true` → the session cookie is HTTPS-only.
- `REPORT_TIME_ZONE` → the reports' "today" and every time shown. It is the
  default anyway; the app does not go by the server's clock, so `TZ` and
  `WEBSITE_TIME_ZONE` are not needed.
- `NODE_ENV=production` → an unexpected error answers with a plain "Internal
  Server Error", not a stack trace.
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false` → the zip already contains
  `node_modules` and the built frontend.
- Do **not** set `PORT`. App Service supplies it.
- `AROFLO_HOST_IP` → only if it is set in the `.env` used locally. It names
  the machine AroFlo expects requests from, which on Azure is a different
  address (`az webapp show -g $RG -n $APP --query outboundIpAddresses`).

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

1. The log says `AroFlo Dashboards listening on …`.
2. Sign in at `https://$SITE`. Signing in writes to the database under
   `/home/data`, so it proves that storage works too.
3. Press **Refresh from AroFlo**. Nothing is loaded until someone does —
   after this deploy and after every later one or restart.
4. In the log, `Refreshed Tasks`, `Refreshed Invoices` and `Refreshed
   Payments` with real counts, then `AroFlo requests left today` and the
   `Data check` line. `Failed to refresh … Authentication Failed` means the
   AroFlo credentials in the app settings are wrong or revoked.

Judge the deploy by `/healthz` and the log, not by the CLI's exit line: it
can print "Site failed to start within 10 mins" while the app is in fact up.

Optional: in the portal, **Monitoring → Health check**, path `/healthz`.
Azure then pings it every minute and reports if it stops answering.

### Before sharing the URL

- Set a long random `ADMIN_PASSWORD`. The app logs a warning on every boot
  while it is shorter than 8 characters, but it will still start.
- Sign-in is limited: ten wrong passwords from one address and that address
  waits 15 minutes (`src/loginThrottle.js`). That slows guessing; it is not
  a reason for a short password. To close the site to everyone outside the
  business as well, use App Service **Networking → Access restrictions**
  (office IPs), or **Authentication** with Microsoft Entra in front.
- Create the two managers' accounts under Settings → Manage users.

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
| `frontend/src/reporting/kpiMatrix/engine.ts`, `kpiMatrix/ingest.ts` | a job still open past its due date is late on its "Completed" row, as it is on Work Orders |
| `EditableTable.tsx`, `OverdueAgeingSection.tsx`, `InvoicingTab.tsx`, `KpiMatrixSection.tsx`, `AnalyticsTab.tsx` | long tables scroll in their box, sort by heading and filter by column; quick date ranges; today is the local day |
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

These behaviours differ from the Reports tab in `test_all_aroflo`:

- **Priorities are named by AroFlo, not by a table of ids.** Each refresh
  reads the account's own priority list (the `Priorities` zone), so a task's
  priority shows under the name AroFlo gives it. The level on the P1–P4 / PM
  scale is read from that name, and only from what it states: `P2`, `AP2`
  and `Priority Level 2 - …` are all level 2; `AP5` is level 5, which is
  reported as part of P4; `PM` is PM. A name that doesn't state a level
  takes one from `KPI_PRIORITY_CODE_MAP_JSON`; anything else — `PHONECALL`,
  `SM` — stays off the scale and shows under its own name. The server log lists which names
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
  labour entry logged on the job (the CSV uses Schedule Start), and lateness
  is judged by day: due by the end of the due date, whatever time AroFlo
  holds against it.
- **An open job past its due date is late on the KPI Matrix.** In
  `test_all_aroflo` a "Completed" row judges only jobs that have been
  finished, so an overdue job that is still open is late on Work Orders and
  nowhere on the Matrix. Here it is late on both (see "Why the two pages
  agree" above). This applies to an uploaded CSV as well.
- **Tables scroll.** A long breakdown table scrolls inside its box under a
  fixed header, like the other report tables, instead of running down the
  page.
- **Priorities are listed up the scale** — P1 to P4, then PM — in the
  Overdue chart and its picker, not most jobs first.
- **The long tables sort and filter by column**, and the date pickers have
  one-click month ranges (`reporting/components/tableControls.tsx`,
  `DatePresets.tsx` — see "Finding things in the tables").
- **Downloads are one click, and complete** (see "Downloading" above). In
  `test_all_aroflo` a report is prepared first and downloaded second, the
  Work Orders report leaves out the Overdue & Ageing section, the Matrix has
  no PDF, and no table can be saved on its own. Its export note also says
  on-screen edits are included in the reports; there they are not, and here
  they now are.
- **The sign-in screen** says what went wrong in plain words, warns when
  Caps Lock is on, says who to ask about a forgotten password, and comes back
  with "your session has ended" instead of leaving the reports answering
  "Not signed in".
- **The Refresh bar shows the load.** While AroFlo is being read it says
  which of the four things it is on, with a progress bar; afterwards it says
  "All data loaded" with the counts, or what is missing. It also says that a
  refresh uses a daily allowance shared with other tools.
- **One client filter everywhere:** Ventia, SAHA, Projects / Other.
  `test_all_aroflo` lists every client in AroFlo on Work Orders.
- **The icon font holds only the icons used** (24 KB, not 3.9 MB), so icons
  don't show as words while it loads. A new icon has to be added to the
  `icon_names` list in `frontend/index.html`.
- **Each page is headed with its own name** (the words in the sidebar), with
  the report title small above it; a new page opens at its top; the tables
  are all headed the same way; "Sign out", not "Logout"; dates read
  "13 Oct 2026" everywhere. Questions for the report's owner are in
  `docs/to-confirm.md`, not on the pages.
- **Everything is on Adelaide time** (see "Adelaide time" above). In
  `test_all_aroflo` "today" is the server's own day for what is overdue, the
  UTC day for the default date range and the date stamped on an export, and
  the browser's zone for the times shown.
- **Invoicing opens on this month to today**, like Work Orders. It used to
  reopen on the dates it was last left on, so a range saved last week kept
  ending last week and left out every invoice since, without saying so.
- **Light / dark is app-wide.** The switch is in the header and covers the
  shell, Tools, modals, login and the Manage users page, not just Reports.
  Dark styling for everything outside Reports lives in `frontend/src/dark.css`.
- **No "Assigned" column** in the overdue table. It was filled from staff
  assignments made on the Jobs and Map screens, which this app doesn't have.
- **Delay reason** in the breakdown tables comes from each late work order's
  current substatus, and failing that from its notes (`src/delayReason.js`;
  the Tasks fetch asks AroFlo for notes as well). `KPI_DELAY_REASON_SUBSTATUSES`
  defaults to the account's four held-up substatuses here; in
  `test_all_aroflo` it is empty by default, notes are not read, and the
  reason can come from substatus history recorded by its trigger engine.
