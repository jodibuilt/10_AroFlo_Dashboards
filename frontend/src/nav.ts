// Catalog of the Tools sub-tabs, so the admin "Manage navigation" modal can
// list them and the shell can hide the ones an admin has turned off. Keys
// are namespaced and match the ids used inside the shell. The report panes
// aren't here — in this app they are sidebar tabs (NAV_CATEGORIES).
export interface SubTabEntry {
  key: string;
  label: string;
  group: string;
}

export const SUB_TAB_CATALOG: SubTabEntry[] = [
  { key: 'tools:wo-consolidator', label: 'Ventia Work Order Consolidator', group: 'Tools' },
];

export interface NavHidden {
  tabs: string[];
  subTabs: string[];
}

export const NAV_HIDDEN_EMPTY: NavHidden = { tabs: [], subTabs: [] };
