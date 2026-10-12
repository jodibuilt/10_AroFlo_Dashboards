// Catalog of the Reports / Tools sub-tabs, so the admin "Manage navigation"
// modal can list them and each shell can hide the ones an admin has turned
// off. Keys are namespaced and match the ids used inside each shell.
export interface SubTabEntry {
  key: string;
  label: string;
  group: string;
}

export const SUB_TAB_CATALOG: SubTabEntry[] = [
  { key: 'reports:matrix', label: 'KPI Matrix', group: 'Reports' },
  { key: 'reports:analytics', label: 'Work Orders', group: 'Reports' },
  { key: 'reports:invoicing', label: 'Invoicing', group: 'Reports' },
  { key: 'tools:wo-consolidator', label: 'Ventia Work Order Consolidator', group: 'Tools' },
];

export interface NavHidden {
  tabs: string[];
  subTabs: string[];
}

export const NAV_HIDDEN_EMPTY: NavHidden = { tabs: [], subTabs: [] };
