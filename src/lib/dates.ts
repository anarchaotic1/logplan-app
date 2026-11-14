/** Date logic. Days are local ISO strings (YYYY-MM-DD); times are minutes since midnight.
 *  Storing local calendar days (not UTC instants) keeps old days intact across time-zone changes. */
export type ISODate = string;

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function isoDate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function daysBetween(a: ISODate, b: ISODate): number {
  const A = parseISO(a), B = parseISO(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
}
/** 0 = Monday … 6 = Sunday */
export function dow(s: ISODate): number {
  return (parseISO(s).getDay() + 6) % 7;
}
export function mondayOf(s: ISODate): ISODate {
  return addDays(s, -dow(s));
}
/** ISO-8601 week number and week-year. */
export function isoWeek(s: ISODate): { week: number; year: number } {
  const thursday = addDays(mondayOf(s), 3);
  const year = parseISO(thursday).getFullYear();
  const firstMonday = mondayOf(`${year}-01-04`);
  return { week: 1 + Math.round(daysBetween(firstMonday, mondayOf(s)) / 7), year };
}
export function weeksInISOYear(year: number): number {
  return isoWeek(`${year}-12-28`).week;
}
export function firstISOMonday(year: number): ISODate {
  return mondayOf(`${year}-01-04`);
}
export function weekDays(monday: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
export function monthGrid(year: number, month0: number): ISODate[] {
  const first = `${year}-${pad2(month0 + 1)}-01`;
  const start = mondayOf(first);
  const out: ISODate[] = [];
  for (let i = 0; i < 42; i++) out.push(addDays(start, i));
  return out;
}
export const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
export function parseHM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}
export function nowMin(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}
/** The "logical day" for a wall-clock moment when the user's day starts at `startHour`
 *  (e.g. 01:30 with startHour 4 still belongs to yesterday). */
export function logicalDay(d: Date, startHour: number): ISODate {
  const iso = isoDate(d);
  return d.getHours() < startHour ? addDays(iso, -1) : iso;
}
export function fmtDur(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
export function snap15(min: number): number {
  return Math.round(min / 15) * 15;
}
