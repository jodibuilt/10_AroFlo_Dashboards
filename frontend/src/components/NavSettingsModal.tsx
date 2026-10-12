import React from 'react';
import { NAV_CATEGORIES } from './Sidebar';
import { SUB_TAB_CATALOG, NavHidden } from '../nav';
import { Modal } from './Modal';

interface Props {
  hidden: NavHidden;
  saving: boolean;
  error: string | null;
  onChange: (next: NavHidden) => void;
  onClose: () => void;
}

// Admin-only. Toggling a row hides/unhides that tab or sub-tab in the
// sidebar for everyone, admins included — this modal always lists the full
// catalog regardless of hidden state, so hiding something here doesn't lose
// your way back to it. Changes persist immediately via the parent's onChange.
export const NavSettingsModal: React.FC<Props> = ({ hidden, saving, error, onChange, onClose }) => {
  const tabSet = new Set(hidden.tabs);
  const subSet = new Set(hidden.subTabs);

  const toggleTab = (tab: string) => {
    const next = new Set(tabSet);
    next.has(tab) ? next.delete(tab) : next.add(tab);
    onChange({ tabs: [...next], subTabs: hidden.subTabs });
  };
  const toggleSub = (key: string) => {
    const next = new Set(subSet);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange({ tabs: hidden.tabs, subTabs: [...next] });
  };

  const Row: React.FC<{ label: string; visible: boolean; onToggle: () => void; icon?: string }> = ({
    label,
    visible,
    onToggle,
    icon,
  }) => (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={visible}
      aria-label={`${label} — ${visible ? 'visible' : 'hidden'} in the sidebar`}
      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-surface text-left transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">
        {icon && <span className="material-symbols-outlined text-[18px] text-muted" aria-hidden="true">{icon}</span>}
        <span className={`text-[13px] truncate ${visible ? 'text-ink' : 'text-muted'}`}>{label}</span>
      </span>
      <span
        className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${visible ? 'bg-accent' : 'bg-strong'}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${visible ? 'left-4' : 'left-0.5'}`}
        />
      </span>
    </button>
  );

  const subGroups = [...new Set(SUB_TAB_CATALOG.map((s) => s.group))];

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Manage navigation"
      panelClassName="max-w-lg max-h-[85vh] flex flex-col"
    >
      <div className="overflow-y-auto p-4 space-y-5 flex-1">
        <p className="text-[12px] text-muted px-1">
          Hidden items disappear from the sidebar for everyone. This list always shows everything, so you can toggle them back on here.
        </p>
        {error && (
          <p className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted px-3 mb-1">Sidebar tabs</h3>
          {NAV_CATEGORIES.map((cat) => (
            <div key={cat.key} className="mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted px-3">{cat.label}</p>
              {cat.items.map((item) => (
                <Row
                  key={item.tab}
                  label={item.label}
                  icon={item.icon}
                  visible={!tabSet.has(item.tab)}
                  onToggle={() => toggleTab(item.tab)}
                />
              ))}
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted px-3 mb-1">Sub-tabs</h3>
          {subGroups.map((g) => (
            <div key={g} className="mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted px-3">{g}</p>
              {SUB_TAB_CATALOG.filter((s) => s.group === g).map((s) => (
                <Row key={s.key} label={s.label} visible={!subSet.has(s.key)} onToggle={() => toggleSub(s.key)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-default flex items-center justify-between shrink-0">
        <span className="text-[11px] text-muted" aria-live="polite">
          {saving ? 'Saving…' : 'Changes save automatically'}
        </span>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-md bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover transition-colors"
        >
          Done
        </button>
      </div>
    </Modal>
  );
};
