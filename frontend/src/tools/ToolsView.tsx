import React, { useEffect, useState } from 'react';
import { WoConsolidatorTab } from './woConsolidator/WoConsolidatorTab';

type ToolTab = 'wo-consolidator';

const TABS: { id: ToolTab; label: string }[] = [
  { id: 'wo-consolidator', label: 'Ventia Work Order Consolidator' },
];

function loadLocal(key: string, fallback: ToolTab): ToolTab {
  try {
    const v = localStorage.getItem(key);
    return v && TABS.some((t) => t.id === v) ? (v as ToolTab) : fallback;
  } catch {
    return fallback;
  }
}

interface Props {
  hiddenSubTabs?: string[];
  isAdmin?: boolean;
}

// Standalone tools that don't fit the reporting model — CSV utilities, etc.
// Own sub-tab shell, mirrors the Reports tab's pattern.
export const ToolsView: React.FC<Props> = ({ hiddenSubTabs = [], isAdmin = false }) => {
  const [tab, setTab] = useState<ToolTab>(() => loadLocal('tools-subtab', 'wo-consolidator'));

  const hidden = new Set(hiddenSubTabs);
  const isHidden = (id: ToolTab) => hidden.has(`tools:${id}`);
  const visible = isAdmin ? TABS : TABS.filter((t) => !isHidden(t.id));

  useEffect(() => {
    if (!isAdmin && isHidden(tab)) setTab(visible[0]?.id ?? 'wo-consolidator');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenSubTabs, tab, isAdmin]);

  function select(id: ToolTab) {
    setTab(id);
    try {
      localStorage.setItem('tools-subtab', id);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="min-h-full bg-canvas">
      <div className="p-8 space-y-6">
        <div className="pb-3 border-b border-default">
          <h1 className="text-[1.6rem] font-bold text-ink">Tools</h1>
          <div className="text-[0.95rem] text-muted">Standalone utilities</div>
        </div>

        {visible.length > 0 && (
          <div className="inline-flex gap-1 rounded-md p-0.5 border border-default bg-white">
            {visible.map((t) => (
              <button
                key={t.id}
                onClick={() => select(t.id)}
                className="px-4 py-1.5 rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5"
                style={{
                  background: tab === t.id ? '#c85a24' : 'transparent',
                  color: tab === t.id ? '#fff' : '#18181b',
                  opacity: isHidden(t.id) ? 0.5 : 1,
                }}
              >
                {t.label}
                {isHidden(t.id) && <span className="material-symbols-outlined text-[14px]">visibility_off</span>}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-[13px] text-muted">Every tool is currently hidden.</p>
        ) : (
          tab === 'wo-consolidator' && <WoConsolidatorTab />
        )}
      </div>
    </div>
  );
};
