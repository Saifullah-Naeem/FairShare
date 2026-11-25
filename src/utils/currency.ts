export function formatPkr(paisa: number): string {
  const safe = Math.trunc(paisa);
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}Rs. ${rupees.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}

export function formatPkrInput(paisa: number): string {
  const abs = Math.abs(Math.trunc(paisa));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${rupees}.${String(rem).padStart(2, '0')}`;
}

export function parsePkrInputToPaisa(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^rs\.?\s*/i, '')
    .replace(/^pkr\s*/i, '')
    .replace(/,/g, '');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [wholePart, fracPart = ''] = cleaned.split('.');
  const whole = Number.parseInt(wholePart, 10);
  const frac = Number.parseInt(fracPart.padEnd(2, '0'), 10);
  const total = whole * 100 + frac;
  if (!Number.isSafeInteger(total) || total < 0) return null;
  return total;
}

export function computeEqualSplitPreview(
  totalMinor: number,
  memberIds: number[],
): Map<number, number> {
  const result = new Map<number, number>();
  if (totalMinor <= 0 || memberIds.length === 0) return result;
  const sorted = [...new Set(memberIds)].sort((a, b) => a - b);
  const base = Math.floor(totalMinor / sorted.length);
  const rem = totalMinor % sorted.length;
  sorted.forEach((id, idx) => {
    result.set(id, base + (idx < rem ? 1 : 0));
  });
  return result;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-PK', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
