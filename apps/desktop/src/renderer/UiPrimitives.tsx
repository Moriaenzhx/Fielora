import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from './ui';

type ProductButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  icon: ReactNode;
  active?: boolean;
  testId?: string;
};

type TooltipPlacement = 'top' | 'bottom' | 'right';
type TooltipVariant = 'default' | 'card' | 'timestamp';

function useManagedTooltip<T extends HTMLElement = HTMLButtonElement>(label: ReactNode, placement: TooltipPlacement = 'top', variant: TooltipVariant = 'default') {
  const anchorRef = useRef<T>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const delayRef = useRef<number | null>(null);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const cancelDelay = () => {
    if (delayRef.current === null) return;
    window.clearTimeout(delayRef.current);
    delayRef.current = null;
  };

  const show = (delay = 420) => {
    cancelDelay();
    delayRef.current = window.setTimeout(() => {
      setPosition(null);
      setOpen(true);
      delayRef.current = null;
    }, delay);
  };

  const hide = () => {
    cancelDelay();
    setOpen(false);
    setPosition(null);
  };

  useEffect(() => () => cancelDelay(), []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setPosition(null); }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const anchorBounds = anchor.getBoundingClientRect();
      const tooltipBounds = tooltip.getBoundingClientRect();
      const viewportInset = 8;
      const offset = 8;
      const chromeBottom = document.querySelector<HTMLElement>('[data-testid="desktop-chrome"]')?.getBoundingClientRect().bottom ?? 0;
      const safeTop = Math.max(viewportInset, chromeBottom + viewportInset);
      const maxTop = Math.max(safeTop, window.innerHeight - tooltipBounds.height - viewportInset);
      if (placement === 'right') {
        const preferredLeft = anchorBounds.right + offset;
        const alternateLeft = anchorBounds.left - tooltipBounds.width - offset;
        const candidateLeft = preferredLeft + tooltipBounds.width <= window.innerWidth - viewportInset
          ? preferredLeft
          : alternateLeft;
        const left = Math.min(
          window.innerWidth - tooltipBounds.width - viewportInset,
          Math.max(viewportInset, candidateLeft),
        );
        const centeredTop = anchorBounds.top + (anchorBounds.height - tooltipBounds.height) / 2;
        const top = Math.min(maxTop, Math.max(safeTop, centeredTop));
        setPosition({ left: Math.round(left), top: Math.round(top) });
        return;
      }
      const preferredTop = placement === 'top'
        ? anchorBounds.top - tooltipBounds.height - offset
        : anchorBounds.bottom + offset;
      const alternateTop = placement === 'top'
        ? anchorBounds.bottom + offset
        : anchorBounds.top - tooltipBounds.height - offset;
      const candidateTop = preferredTop >= safeTop
        && preferredTop + tooltipBounds.height <= window.innerHeight - viewportInset
        ? preferredTop
        : alternateTop;
      const top = Math.min(maxTop, Math.max(safeTop, candidateTop));
      const centeredLeft = anchorBounds.left + (anchorBounds.width - tooltipBounds.width) / 2;
      const left = Math.min(
        window.innerWidth - tooltipBounds.width - viewportInset,
        Math.max(viewportInset, centeredLeft),
      );
      setPosition({ left: Math.round(left), top: Math.round(top) });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [label, open, placement]);

  const tooltip = open ? createPortal(
    <span
      ref={tooltipRef}
      id={tooltipId}
      className={`ui-tooltip${variant !== 'default' ? ` ui-tooltip--${variant}` : ''}`}
      role="tooltip"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      data-testid="ui-tooltip"
    >{label}</span>,
    document.body,
  ) : null;

  return { anchorRef, tooltipId, open, show, hide, tooltip };
}

/** Use the durable message/event time, never the render time. */
export function TimestampHover({ timestamp, children }: { timestamp?: number | null; children: ReactNode }) {
  const valid = typeof timestamp === 'number' && Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime());
  const label = valid ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '';
  const tip = useManagedTooltip<HTMLDivElement>(label, 'top', 'timestamp');
  if (!valid) return <>{children}</>;
  return <div className="timestamp-hover" ref={tip.anchorRef} data-recorded-at={timestamp} aria-describedby={tip.open ? tip.tooltipId : undefined}
    onPointerEnter={() => tip.show()} onPointerLeave={tip.hide} onFocus={() => tip.show(0)} onBlur={tip.hide}
    onKeyDown={event => { if (event.key === 'Escape') tip.hide(); }}>
    {children}{tip.tooltip}
  </div>;
}

/** Keep a disclosure summary as the tooltip anchor, without an extra layout wrapper. */
export function TimestampSummary({ timestamp, title, children }: { timestamp: number; title?: string; children: ReactNode }) {
  const label = new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  const tip = useManagedTooltip<HTMLElement>(label, 'top', 'timestamp');
  return <summary ref={tip.anchorRef} title={title} data-recorded-at={timestamp} aria-describedby={tip.open ? tip.tooltipId : undefined}
    onPointerEnter={() => tip.show()} onPointerLeave={tip.hide} onFocus={() => tip.show(0)} onBlur={tip.hide}
    onKeyDown={event => { if (event.key === 'Escape') tip.hide(); }}>
    {children}{tip.tooltip}
  </summary>;
}

export function Button({ variant = 'secondary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  return <button {...props} type={props.type ?? 'button'} className={`ui-button ui-button--${variant} ${className}`.trim()}>{children}</button>;
}

export function SettingsToggle({ value, onChange, label, testId, disabled = false }: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  testId?: string;
  disabled?: boolean;
}) {
  return <button type="button" className="setting-switch" role="switch" aria-label={label} aria-checked={value} disabled={disabled} onClick={() => onChange(!value)} data-testid={testId}><span /></button>;
}

export function TooltipButton({ tooltip, placement = 'right', variant = 'card', children, onPointerEnter, onPointerLeave, onFocus, onBlur, onKeyDown, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip: ReactNode;
  placement?: TooltipPlacement;
  variant?: TooltipVariant;
}) {
  const managedTooltip = useManagedTooltip(tooltip, placement, variant);
  return <>
    <button
      {...props}
      ref={managedTooltip.anchorRef}
      type={props.type ?? 'button'}
      aria-describedby={managedTooltip.open ? managedTooltip.tooltipId : undefined}
      onPointerEnter={(event) => { onPointerEnter?.(event); managedTooltip.show(); }}
      onPointerLeave={(event) => { onPointerLeave?.(event); managedTooltip.hide(); }}
      onFocus={(event) => { onFocus?.(event); managedTooltip.show(0); }}
      onBlur={(event) => { onBlur?.(event); managedTooltip.hide(); }}
      onKeyDown={(event) => { onKeyDown?.(event); if (event.key === 'Escape') managedTooltip.hide(); }}
    >{children}</button>
    {managedTooltip.tooltip}
  </>;
}

export function IconButton({ label, icon, active = false, testId, className = '', title, size = 'md', onPointerEnter, onPointerLeave, onFocus, onBlur, onKeyDown, onClick, ...props }: ProductButtonProps & {
  size?: 'sm' | 'md';
}) {
  const managedTooltip = useManagedTooltip(title ?? label);
  return <>
    <button
      {...props}
      ref={managedTooltip.anchorRef}
      type={props.type ?? 'button'}
      className={`ui-icon-button ui-icon-button--${size} ${active ? 'is-active active' : ''} ${className}`.trim()}
      onClick={(event) => { managedTooltip.hide(); onClick?.(event); }}
      aria-label={label}
      aria-describedby={managedTooltip.open ? managedTooltip.tooltipId : undefined}
      onPointerEnter={(event) => { onPointerEnter?.(event); managedTooltip.show(); }}
      onPointerLeave={(event) => { onPointerLeave?.(event); managedTooltip.hide(); }}
      onFocus={(event) => { onFocus?.(event); managedTooltip.show(0); }}
      onBlur={(event) => { onBlur?.(event); managedTooltip.hide(); }}
      onKeyDown={(event) => { onKeyDown?.(event); if (event.key === 'Escape') managedTooltip.hide(); }}
      data-testid={testId}
    >{icon}</button>
    {managedTooltip.tooltip}
  </>;
}

export function ToolbarAction({ label, icon, text, active = false, testId, className = '', title, onPointerEnter, onPointerLeave, onFocus, onBlur, onKeyDown, onClick, ...props }: ProductButtonProps & {
  text?: string;
}) {
  const managedTooltip = useManagedTooltip(title ?? label);
  return <>
    <button
      {...props}
      ref={managedTooltip.anchorRef}
      type={props.type ?? 'button'}
      className={`ui-toolbar-action ${text ? 'ui-toolbar-action--labeled' : ''} ${active ? 'is-active active' : ''} ${className}`.trim()}
      onClick={(event) => { managedTooltip.hide(); onClick?.(event); }}
      aria-label={label}
      aria-describedby={managedTooltip.open ? managedTooltip.tooltipId : undefined}
      onPointerEnter={(event) => { onPointerEnter?.(event); managedTooltip.show(); }}
      onPointerLeave={(event) => { onPointerLeave?.(event); managedTooltip.hide(); }}
      onFocus={(event) => { onFocus?.(event); managedTooltip.show(0); }}
      onBlur={(event) => { onBlur?.(event); managedTooltip.hide(); }}
      onKeyDown={(event) => { onKeyDown?.(event); if (event.key === 'Escape') managedTooltip.hide(); }}
      data-testid={testId}
    >{icon}{text && <span>{text}</span>}</button>
    {managedTooltip.tooltip}
  </>;
}

export function Menu({ label, className = '', children, ...props }: HTMLAttributes<HTMLDivElement> & {
  label: string;
}) {
  return <div {...props} className={`ui-menu ${className}`.trim()} role={props.role ?? 'menu'} aria-label={label}>{children}</div>;
}

export function MenuItem({ icon, label, description, trailing, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon?: ReactNode;
  label: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return <button {...props} type={props.type ?? 'button'} role={props.role ?? 'menuitem'} className={`ui-menu-item ${className}`.trim()}>
    {icon && <span className="ui-menu-item-icon">{icon}</span>}
    <span className="ui-menu-item-copy"><strong>{label}</strong>{description && <small>{description}</small>}</span>
    {trailing && <span className="ui-menu-item-trailing">{trailing}</span>}
  </button>;
}

export function TabStrip({ label, className = '', children, innerRef, onKeyDown, ...props }: HTMLAttributes<HTMLDivElement> & {
  label: string;
  innerRef?: Ref<HTMLDivElement>;
}) {
  return <div {...props} ref={innerRef} className={`ui-tab-strip ${className}`.trim()} role="tablist" aria-label={label} onKeyDown={(event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (!target) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
    const index = items.indexOf(target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
    items[next]?.click();
    requestAnimationFrame(() => {
      if (!items[next]?.isConnected) return;
      items[next].focus({ preventScroll: true });
      items[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }}>{children}</div>;
}

export function Tab({ label, leading, active = false, className = '', mainClassName = '', closeClassName = '', labelClassName = '', testId, closeTestId, closeLabel, onActivate, onClose, ...props }: HTMLAttributes<HTMLDivElement> & {
  label: string;
  leading?: ReactNode;
  active?: boolean;
  mainClassName?: string;
  closeClassName?: string;
  labelClassName?: string;
  testId?: string;
  closeTestId?: string;
  closeLabel?: string;
  onActivate: () => void;
  onClose: () => void;
}) {
  return <div {...props} className={`ui-tab ${active ? 'is-active active' : ''} ${className}`.trim()}>
    <button type="button" className={`ui-tab-main ${mainClassName}`.trim()} role="tab" aria-selected={active} tabIndex={active ? 0 : -1} title={label} onClick={onActivate} data-testid={testId}>
      {leading}<span className={`ui-tab-label ${labelClassName}`.trim()}>{label}</span>
    </button>
    <button type="button" className={`ui-tab-close ${closeClassName}`.trim()} tabIndex={active ? 0 : -1} aria-label={closeLabel ?? `关闭 ${label}`} onClick={onClose} data-testid={closeTestId ?? (testId ? `${testId}-close` : undefined)}><AppIcon name="close" size="sm"/></button>
  </div>;
}

export interface SelectMenuOption<T extends string = string> {
  value: T;
  label: string;
  triggerLabel?: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  tone?: 'warning';
}

export function ChevronIcon({ open = false }: { open?: boolean }) {
  return <span className={`ui-chevron chevron-icon ${open ? 'open' : ''}`} aria-hidden="true"><AppIcon name="chevronDown" size="sm"/></span>;
}

export function SelectMenu<T extends string>({ value, options, onChange, ariaLabel, testId, className = '', placement = 'bottom', leading, hideChevron = false, searchLabel }: {
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  testId?: string;
  className?: string;
  placement?: 'top' | 'bottom';
  leading?: ReactNode;
  hideChevron?: boolean;
  searchLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const [search, setSearch] = useState('');
  const visibleOptions = searchLabel ? options.filter(option => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : options;

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const enabled = visibleOptions.filter((option) => !option.disabled);
      const index = Math.max(0, enabled.findIndex((option) => option.value === value));
      const next = event.key === 'ArrowDown' ? Math.min(enabled.length - 1, index + 1) : Math.max(0, index - 1);
      if (enabled[next]) onChange(enabled[next]!.value);
    };
    window.addEventListener('pointerdown', pointer);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', pointer);
      window.removeEventListener('keydown', key);
    };
  }, [onChange, open, visibleOptions, value]);

  return <div ref={rootRef} className={`ui-select select-menu ${placement === 'top' ? 'place-top' : ''} ${open ? 'open' : ''} ${className}`.trim()} data-value={value}>
    <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setSearch(''); setOpen((current) => !current); }} data-testid={testId}>
      {leading}<span className="ui-select-value select-menu-value">{selected?.triggerLabel ?? selected?.label ?? ariaLabel}</span>{!hideChevron && <ChevronIcon open={open} />}
    </button>
    {open && <div className="ui-select-popover select-menu-popover" role="listbox" aria-label={ariaLabel} data-surface="overlay" data-testid={testId ? `${testId}-menu` : undefined}>
      {searchLabel && <input className="font-menu-search" aria-label={searchLabel} placeholder={searchLabel} value={search} onChange={event => setSearch(event.target.value)}/> }
      {visibleOptions.map((option) => <button key={option.value || 'empty'} className={option.tone ? `is-${option.tone}` : undefined} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={() => { onChange(option.value); setOpen(false); }} data-testid={testId ? `${testId}-option-${option.value || 'empty'}` : undefined}>
        <span className="ui-select-option-content">{option.icon && <span className="ui-select-option-icon">{option.icon}</span>}<span className="ui-select-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></span>{option.value === value && <span className="ui-select-check" aria-hidden="true"><AppIcon name="check" size="sm"/></span>}
      </button>)}
    </div>}
  </div>;
}

export function TextActionDialog({ title, description, value, confirmLabel, danger = false, multiline = false, onChange, onCancel, onConfirm, testId }: {
  title: string;
  description?: string;
  value?: string;
  confirmLabel: string;
  danger?: boolean;
  multiline?: boolean;
  onChange?: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const cancelRef = useRef(onCancel);
  const confirmRef = useRef(onConfirm);
  cancelRef.current = onCancel;
  confirmRef.current = onConfirm;
  useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRef.current();
      if (event.key === 'Enter' && !multiline) { event.preventDefault(); confirmRef.current(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [multiline]);

  return <div className="ui-dialog-backdrop dialog-backdrop" role="presentation" data-effect="backdrop-dim" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="ui-dialog action-dialog" role="dialog" aria-modal="true" aria-labelledby={`${testId ?? 'action-dialog'}-title`} data-surface="overlay" data-testid={testId}>
      <header><h2 id={`${testId ?? 'action-dialog'}-title`}>{title}</h2><IconButton size="sm" label="关闭" icon={<AppIcon name="close" size="sm"/>} onClick={onCancel} /></header>
      {description && <p>{description}</p>}
      {value !== undefined && (multiline
        ? <textarea ref={inputRef as RefObject<HTMLTextAreaElement>} value={value} onChange={(event) => onChange?.(event.target.value)} />
        : <input ref={inputRef as RefObject<HTMLInputElement>} value={value} onChange={(event) => onChange?.(event.target.value)} />)}
      <footer><Button variant="secondary" className="dialog-cancel" onClick={onCancel}>取消</Button><Button variant={danger ? 'danger' : 'primary'} className={danger ? 'dialog-danger' : 'dialog-confirm'} disabled={value !== undefined && !value.trim()} onClick={onConfirm}>{confirmLabel}</Button></footer>
    </section>
  </div>;
}
