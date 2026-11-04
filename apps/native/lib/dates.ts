/**
 * Dansk datoformatering uden Intl, så output er ens på Hermes (iOS/Android) og web.
 */
const MONTHS = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];
const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → lokal Date kl. 00:00 */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Lokal Date → "YYYY-MM-DD" */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "12.–19. maj", "28. maj – 3. juni", "28. dec. 2026 – 3. jan. 2027" */
export function formatDateRange(startIso: string, endIso: string): string {
  const s = parseIsoDate(startIso);
  const e = parseIsoDate(endIso);
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.getDate()}. ${MONTHS[s.getMonth()]} ${s.getFullYear()} – ${e.getDate()}. ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  }
  if (s.getMonth() !== e.getMonth()) {
    return `${s.getDate()}. ${MONTHS[s.getMonth()]} – ${e.getDate()}. ${MONTHS[e.getMonth()]}`;
  }
  if (s.getDate() === e.getDate()) return `${s.getDate()}. ${MONTHS[s.getMonth()]}`;
  return `${s.getDate()}.–${e.getDate()}. ${MONTHS[s.getMonth()]}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** "i dag 14:32", "i går 19:05", "12. maj" (eller "12. maj 2025" for andre år) */
export function formatRelative(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return `i dag ${formatTime(d)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `i går ${formatTime(d)}`;
  const base = `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "14. maj 2026 kl. 14:32" */
export function formatDateTimeLong(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()} kl. ${formatTime(d)}`;
}

/** "Tirsdag 12. maj" – overskrift i galleriet */
export function formatDayHeading(date: Date): string {
  const wd = WEEKDAYS[date.getDay()]!;
  return `${wd[0]!.toUpperCase()}${wd.slice(1)} ${date.getDate()}. ${MONTHS[date.getMonth()]}`;
}

/** Datofelt i formularer: "12.05.2026" ↔ "2026-05-12" */
export function formatDateInput(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function parseDateInput(text: string): string | null {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/.exec(text);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getDate() !== Number(d) || date.getMonth() !== Number(mo) - 1) return null;
  return toIsoDate(date);
}
