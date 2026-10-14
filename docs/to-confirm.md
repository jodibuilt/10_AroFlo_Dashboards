# AroFlo Dashboards — points to confirm

Almost every choice the dashboards rest on was confirmed on 13 October 2026;
they are listed at the end. **One is still open**, and it is first.

Figures quoted are from the TTS AroFlo account as loaded on 12 October 2026
(2,967 work orders requested since 1 August 2026).

## Still open

### The time limits for starting a job

The KPI Matrix has a "Commenced" row for each priority: was the job started
in time? That needs a time limit per priority. The dashboards use:

| Priority | A job must be started by |
|---|---|
| P1 | the same day if it was requested before 1 pm, otherwise the next day |
| P2 | 3 days after it was requested |
| P3 | 14 days |
| P4 / AP5 | 30 days |
| PM | 30 days (confirmed) |

**Are the P1–P4 limits the ones in the contracts?** They came from the
wording of the priorities in AroFlo ("Attend within 3 calendar days"), so
they are probably right, but nobody has said so.

## How "Commenced" works now

Worth knowing before the figures are shown to anyone, because it is the one
row that cannot be measured exactly.

AroFlo's substatus says where a job is **now**, not when it got there. So
the dashboards can tell *whether* a job has been started, not *when*:

- **Started** = the job is finished, or In Progress, or its substatus is
  Materials Ordered, On Hold/Materials Required, Sent to Procurement, Non
  Access, Ready for Invoicing, To be Reviewed, Re-book or Job Cancelled.
- **Not started** = anything else: Scheduled to Employee, Quoting, New WO to
  be Raised, or no substatus.
- A job is **late to start** only if it has still not been started once its
  time limit (above) has passed.
- A job that has been started counts as **on time**, even if it was started
  late — nothing records when it began. So "Commenced" percentages lean
  generous. "Completed" percentages do not: they are judged against the due
  date.
- A job not yet started and still inside its limit is **in progress**: its
  own count, and in neither side of the percentage.

## Notes for whoever runs it

- **TTS RMS only.** Work orders and invoices owned by any other business
  unit are dropped as they are loaded. The Refresh bar says how many were
  left out, and the `Data check` log line lists what AroFlo sent for each
  unit. If the bar instead says none belong to TTS RMS, the unit has a
  different name in AroFlo: the bar lists the names that came, and the right
  one goes in the `AROFLO_BUSINESS_UNITS` setting.
- **Re-book and Job Cancelled** are treated as closed jobs, as confirmed.
  Whether a job counts as *finished* still comes from its status (Completed
  or Archived). The `Data check` line in the server log counts any job that
  has one of these two substatuses while its status is still open
  (`closedSubstatusButOpen`) — if that is ever above zero, those jobs are
  being reported as open, and overdue once past their due date.
- **KPIs 12–14** are blank on live data and say so. They fill in when a CSV
  export is uploaded on the KPI Matrix page. The upload looks for a
  checklist named "JSA" and a compliance form named "Issues Register"; if
  the export calls them something else the page says which names it found.
- **A priority called "SM"** exists in the AroFlo priority list. No work
  order uses it. It would show under its own name if a job ever did.
- **Invoicing opens on all three client groups** (Ventia, SAHA, Projects /
  Other), because its job is the split between them. Work Orders and the KPI
  Matrix open on Ventia + SAHA.
- **Refreshing** uses 47 of the 2,000 requests AroFlo allows a day, shared
  with anything else on the same login. The Refresh bar says the allowance
  is shared, shows the load as it happens, and the app stops refreshing when
  fewer than 200 are left.
- **After every deploy or restart the reports are empty** until someone
  presses Refresh: the loaded data is held in memory. "Always On" in Azure
  stops it being put to sleep in between.
- **Before giving anyone the address:** set a long admin password (the one
  in use locally is under 8 characters). Ten wrong passwords from one
  address locks that address out of signing in for 15 minutes.

## Confirmed on 13 October 2026

| Point | Decision |
|---|---|
| A job still open past its due date | Counts as late |
| The Due Date on a job in AroFlo | Is the deadline |
| Time of day on a due date | Does not count — judged by day |
| The percentage | On time ÷ (on time + late), the same on both pages |
| A job that is open and not yet due | "In progress": its own count, not in the percentage |
| "Commenced" | Read from the status and substatus (see above), not from logged labour |
| Re-book, Job Cancelled | Closed jobs |
| A delay reason on a late job | Shown, but the job still counts as late |
| Substatuses that give a delay reason | Non Access, Materials Ordered, On Hold/Materials Required, Sent to Procurement — no others |
| Sent to Procurement | A delay reason, on past-due jobs only |
| Delay reason from job notes (keyword match) | Acceptable |
| KPI targets | P1 98, P2 95, P3 90, P4 90, PM 90; template rows 98, 98, 100, 100 |
| Overdue rate | Show both — of issued, and of completed — each saying which |
| PM time limit | 30 days |
| AP5 | Part of P4, headed "P4/P5" where it applies |
| Other priorities (PHONECALL, SLA Urgent 1hour, "1") | Used as they are; not put on a level |
| Work orders with no priority (176) | Correct as they are in AroFlo |
| Which month a job belongs to | The month it was requested |
| Quotes | Counted as work orders (they are in AroFlo's task list) |
| How far back | Two months, and the pages say so |
| Clients | Ventia, SAHA, Projects / Other on every dashboard; opens on Ventia + SAHA |
| Business unit | TTS RMS only — no other business unit's work orders or invoices |
| Invoices with status In Progress | Submitted — they have gone to the client — and shown as in progress |
| A part-paid invoice | Counts as unpaid |
| Invoice value | Including GST first |
| KPIs 12–14 | Blank on live data; filled only from an uploaded CSV |
| Who uses it | The developer is the admin; two managers are users |
| Hosting | Azure |
| Who refreshes | The users, sparingly |
| Edits made on screen | Go into the Excel and PDF reports |
| What users see | Every page; hiding and showing pages is for the admin |
| Report titles | Fine as they are |
| Time zone | Adelaide |
