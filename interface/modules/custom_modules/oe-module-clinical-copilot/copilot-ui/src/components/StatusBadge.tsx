import type { Status } from '../types';

const STATUS_VARIANTS: Partial<Record<Status, { cls: string; label: string }>> = {
  loading:   { cls: 'copilot-badge-loading', label: 'Loading…' },
  streaming: { cls: 'copilot-badge-loading', label: 'Generating…' },
  live:      { cls: 'copilot-badge-live',    label: 'Live' },
  cached:    { cls: 'copilot-badge-cached',  label: 'Cached' },
};

export function StatusBadge({ status }: { status: Status }) {
  const v = STATUS_VARIANTS[status];
  if (!v) return null;
  return <span className={`copilot-badge ${v.cls}`}>{v.label}</span>;
}
