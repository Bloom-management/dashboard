/** Local dates are calendar labels, never instants in the browser's timezone. */
export function localDate(date: Date) { return date.toISOString().slice(0, 10); }
export function todayIn(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function monthRange(month: string) {
  const [year, index] = month.split('-').map(Number);
  return { from: `${month}-01`, to: localDate(new Date(Date.UTC(year, index, 0))) };
}
export function shiftMonth(month: string, amount: number) {
  const [year, index] = month.split('-').map(Number);
  return localDate(new Date(Date.UTC(year, index - 1 + amount, 1))).slice(0, 7);
}
export function monthCells(month: string): (string | null)[] {
  const { from, to } = monthRange(month);
  const cells: (string | null)[] = Array(new Date(`${from}T12:00:00Z`).getUTCDay()).fill(null);
  for (let day = 1; day <= Number(to.slice(-2)); day++) cells.push(`${month}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}
export function formatTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant));
}
export function money(cents: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
