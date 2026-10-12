import React, { useCallback, useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Accessible name for the dialog. Either pass `title` (rendered as the
  // heading and wired to aria-labelledby) or `ariaLabel` for a custom header.
  title?: React.ReactNode;
  ariaLabel?: string;
  children: React.ReactNode;
  // Extra classes for the panel (width, etc.). Defaults to a medium dialog.
  panelClassName?: string;
  // Where the panel sits vertically. `center` (default) or `top` (command-
  // palette style).
  align?: 'center' | 'top';
  // Set false to require an explicit control to dismiss (backdrop click off).
  dismissOnBackdrop?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

let openCount = 0;

// Shared dialog shell: role="dialog" + aria-modal, focus trap, Escape to
// close, focus restore on close, background scroll lock. Every modal in the
// app routes through this so keyboard and screen-reader behaviour is
// identical everywhere.
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  panelClassName = 'max-w-lg',
  align = 'center',
  dismissOnBackdrop = true,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useRef(`modal-h-${Math.random().toString(36).slice(2)}`).current;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    openCount += 1;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog — first real control, else the panel itself.
    const t = window.setTimeout(() => {
      const node =
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current ?? null;
      node?.focus();
    }, 0);

    return () => {
      window.clearTimeout(t);
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.style.overflow = '';
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`modal-overlay fixed inset-0 z-[200] bg-black/50 backdrop-blur-xs flex justify-center p-4 ${
        align === 'top' ? 'items-start pt-20' : 'items-center'
      }`}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : undefined}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`modal-panel bg-white w-full rounded-xl border border-default shadow-lg overflow-hidden focus:outline-none ${panelClassName}`}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-default bg-surface">
            <h2 id={headingId} className="text-[16px] font-semibold text-ink">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-default hover:text-ink transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
