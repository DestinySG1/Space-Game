const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf1.format(n / 1e6)} Mio`;
  if (a >= 1e4) return `${nf1.format(n / 1e3)}k`;
  return nf.format(Math.floor(n));
}

export const fmt1 = (n: number) => nf1.format(n);

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export const esc = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
