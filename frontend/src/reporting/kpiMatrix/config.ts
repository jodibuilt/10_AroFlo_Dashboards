// KPI compliance-matrix config. Logic ported from the AroFlo KPI reporting
// spec; wired to a user-uploaded AroFlo CSV export rather than the live API.
//
// Values marked ASSUMPTION / UNCONFIRMED are disclosed in the UI.

export type Tier = 'P1' | 'P2' | 'P3' | 'P4' | 'PM';
export type Metric = 'commenced' | 'completed' | 'overdue' | 'invoice' | 'jsa' | 'issues';

// --------------------------------------------------------------------------
// Priority label -> [tier, slaDays]
//
// Covers both the SAHA/Ventia contract wording from the spec AND this
// account's own live priority names (Emergency / Urgent / Standard / After
// Hours), so an export from either lands on the right tier. Extend via the
// "Priority mapping" note if AroFlo introduces new wording.
// --------------------------------------------------------------------------

export const PRIORITY_MAP: Record<string, [Tier, number]> = {
  // SAHA / Ventia contract wording
  'AP1 - Emergency Work - Attend same day up until 1pm. After 1pm, attend the next calendar day': ['P1', 0],
  'Priority Level 1 - Emergency Work - Attend same day up until 1pm. After 1pm, attend the next calendar day': ['P1', 0],
  'AP2 - Attend within 3 calendar days': ['P2', 3],
  'Priority Level 2 - Attend within 3 calendar days': ['P2', 3],
  'AP3 - Attend within 14 calendar days': ['P3', 14],
  'Priority Level 3 - Attend within 14 calendar days': ['P3', 14],
  'AP4 - Attend within 30 calendar days': ['P4', 30],
  'Priority Level 4 - Attend within 30 calendar days': ['P4', 30],
  'AP5 - Attend within 30 calendar days': ['P4', 30], // deliberately P4
  'PM - Preventative Maintenance': ['PM', 30], // 30 days is an ASSUMPTION
  // This account's own live priority names
  Emergency: ['P1', 0],
  Urgent: ['P2', 3],
  Standard: ['P3', 14],
  'After Hours': ['P4', 30],
};

export const TIERS: Tier[] = ['P1', 'P2', 'P3', 'P4', 'PM'];

export const TIER_WINDOW_LABEL: Record<Tier, string> = {
  P1: 'same day / next day',
  P2: '3 days',
  P3: '14 days',
  P4: '30 days',
  PM: '30 days (assumed)',
};

export const ASSUMPTIONS = [
  'PM SLA window of 30 days was never confirmed with the client.',
  'AP5 is mapped to the P4 (30-day) tier.',
  'Commenced KPIs use Schedule Start as a proxy — AroFlo exposes no actual attendance time (every Schedule Start Time is 07:00).',
  "Completion is judged against AroFlo's own Task Due Date, not the computed contractual SLA date. Those due dates are frequently defaulted / generous.",
];

// --------------------------------------------------------------------------
// has_commenced status tests
// --------------------------------------------------------------------------

export const COMMENCED_STATUSES = new Set(['in progress', 'inprogress', 'ongoing', 'completed']);
export const COMMENCED_SUBSTATUSES = new Set(['ready for inv', 'ready for invoicing']);

export const INVOICE_SLA_DAYS = 7;

// --------------------------------------------------------------------------
// KPI definitions: [id, name, targetPct, tier, metric]
// --------------------------------------------------------------------------

export interface KpiDef {
  id: number;
  name: string;
  target: number;
  tier: Tier | null;
  metric: Metric;
}

export const KPIS: KpiDef[] = [
  { id: 1, name: 'P1 Commenced', target: 98, tier: 'P1', metric: 'commenced' },
  { id: 2, name: 'P1 Completed', target: 98, tier: 'P1', metric: 'completed' },
  { id: 3, name: 'P2 Commenced', target: 95, tier: 'P2', metric: 'commenced' },
  { id: 4, name: 'P2 Completed', target: 95, tier: 'P2', metric: 'completed' },
  { id: 5, name: 'P3 Commenced', target: 90, tier: 'P3', metric: 'commenced' },
  { id: 6, name: 'P3 Completed', target: 90, tier: 'P3', metric: 'completed' },
  { id: 7, name: 'P4 Commenced', target: 90, tier: 'P4', metric: 'commenced' },
  { id: 8, name: 'P4 Completed', target: 90, tier: 'P4', metric: 'completed' },
  { id: 9, name: 'PM Commenced', target: 90, tier: 'PM', metric: 'commenced' },
  { id: 10, name: 'PM Completed', target: 90, tier: 'PM', metric: 'completed' },
  { id: 11, name: 'Overdue work orders completed', target: 98, tier: null, metric: 'overdue' },
  { id: 12, name: 'Timely submission of payment claims', target: 98, tier: null, metric: 'invoice' },
  { id: 13, name: "Completion of JSA's", target: 100, tier: null, metric: 'jsa' },
  { id: 14, name: 'Rectification of the issues on the issues register', target: 100, tier: null, metric: 'issues' },
];

// --------------------------------------------------------------------------
// Status pass sets
// --------------------------------------------------------------------------

export const CHECKLIST_PASS = new Set(['Closed', 'Completed', 'Passed', 'Approved']);
export const COMPLIANCE_PASS = new Set(['Closed', 'Completed', 'Passed', 'Resolved']);

// Unresolved literals for KPI 13 / 14. Neither matched anything in the sample
// data during the Power BI build. Corrected here without touching logic; the
// diagnostics panel logs the distinct values found and warns on zero matches.
export const JSA_NAME = 'JSA'; // UNCONFIRMED
export const ISSUES_FORM_NAME = 'Issues Register'; // UNCONFIRMED

// --------------------------------------------------------------------------
// Failure categorisation
// --------------------------------------------------------------------------

// Appears on every ELISSUE / PDISSUE / ACPM01 completion record and means the
// notes field was left empty. MUST be stripped before keyword matching or
// hundreds of jobs miscategorise as access failures.
export const NO_ACCESS_NOTES_LITERAL = 'no access notes';

export const CATEGORY_RULES: Array<[string, string[]]> = [
  ['flooding', [
    'flood damage', 'flooded', 'water damage', 'burst water main',
    'storm damage', 'storm', 'heavy rain', 'high winds', 'weather event', 'inundated',
  ]],
  // "no supplier assigned" is a field check, after flooding, before specialist trade.
  ['specialist trade required', [
    'septic truck', 'excavate', 'excavation', 'rasac', 'welding',
    'need an electrician', 'electrician to attend', 'cutting machine',
    'hobart', 'preferred vendor', 'break down order', 'requires break down',
  ]],
  ['materials required', [
    'supply/install', 'supply / install', 'requires new', 'needs new',
    'new hoses', 'new relief valve', 'new alarms', 'replacement',
    'to be replaced', 'needs to be replaced', 'replace existing',
    'install white goods', 'flat pack',
  ]],
  ['access coordination required', [
    'confirm access', 'phone prior to schedule visit',
    'please call before attending', 'call before attending',
    'leave voicemail', 'unable to reach',
    'pets must be restrained', 'has a dog',
  ]],
  ['multi-item scope', [
    'multiples requests', 'multiple requests', 'across the two wo',
    '5 x houses', '4 x lpg', '5 x lpg', 'all vents',
    'every tap outlet', 'the following houses',
  ]],
  ['repeat visit', [
    'ongoing issue', 'happening every', "still doesn't", 'still does not',
    'multiple times now', 'has been leaking for', 'previously requested job',
    'no record of wo', '3 times this year', 'corrective action', 'pm corrective',
  ]],
];

export const DEFAULT_CATEGORY = 'reason not recorded';

export const SUPPLIER_LABEL = 'suggested supplier:';
export const SUPPLIER_BLANK_PREFIXES = ['n/a', 'not set yet', 'special access'];
export const SPECIAL_ACCESS_LABEL = 'special access requirements:';

export const KNOWN_FIELD_LABELS = [
  'suggested supplier:',
  'special access requirements:',
  'preferred vendor:',
  'site contact:',
  'contact:',
  'phone:',
  'asset:',
  'location:',
  'description of work:',
  'scope of work:',
  'additional information:',
  'priority:',
];

// --------------------------------------------------------------------------
// Source columns
// --------------------------------------------------------------------------

export const SOURCE_COLUMNS = [
  'Jobnumber', 'Task', 'Status', 'Priority',
  'Requested Date', 'Requested Time', 'Task Due Date', 'Task Due Time',
  'Schedule Start Date', 'Schedule Start Time', 'Completed Date', 'Completed Time',
  'Last Invoice Date', 'Last Invoice Status', 'Compliance Form Name', 'Compliance Form Status',
  'Checklist Name', 'Checklist Status', 'Checklist Fail Note', 'Last Task Note',
];
export const DESCRIPTION_COLUMN = 'Description';
export const SUBSTATUS_COLUMN = 'Substatus';

export const CAPTION =
  'On-time % covers jobs started within their response window and finished by their due date. ' +
  'Commenced uses scheduled start, not actual attendance. Contributing factors are conditions ' +
  'present on the job, not confirmed causes of delay.';
