/**
 * UTC calendar windows for CCM period comparisons (e.g. current vs previous N-day blocks).
 */

export interface EpochWindow {
  startMs: number;
  endMs: number;
}

export interface TwoPeriodWindows {
  current: EpochWindow;
  previous: EpochWindow;
  /** Short labels for chart legend / titles */
  currentLegend: string;
  previousLegend: string;
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function formatRange(start: Date, end: Date): string {
  const a = start.toISOString().slice(0, 10);
  const b = end.toISOString().slice(0, 10);
  return a === b ? a : `${a}–${b}`;
}

/**
 * Builds two consecutive windows of `periodDays` each, in UTC, immediately before a trailing
 * excluded tail (e.g. last 2 calendar days excluded as incomplete).
 *
 * - **Excluded:** the most recent `excludeLastDays` UTC calendar days (typically “today” and “yesterday”).
 * - **Current:** `periodDays` full UTC days ending on the last day before the excluded tail.
 * - **Previous:** the `periodDays` UTC days immediately before the current window.
 */
export function computeTwoPeriodWindowsBeforeExcludedTail(
  now: Date,
  options: { excludeLastDays: number; periodDays: number },
): TwoPeriodWindows {
  const excludeLastDays = Math.max(0, Math.floor(options.excludeLastDays));
  const periodDays = Math.max(1, Math.floor(options.periodDays));

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  // First UTC midnight at or after we leave the excluded tail — i.e. start of the day *before*
  // the excluded block. If we exclude `excludeLastDays` days ending at yesterday, the last included
  // day ends at: (today - excludeLastDays) at end of day.
  const lastIncludedDayStart = new Date(Date.UTC(y, m, d - excludeLastDays));
  const endCurrent = endOfUtcDay(lastIncludedDayStart);
  const startCurrent = new Date(lastIncludedDayStart);
  startCurrent.setUTCDate(startCurrent.getUTCDate() - (periodDays - 1));
  startCurrent.setUTCHours(0, 0, 0, 0);

  const endPrevious = new Date(startCurrent);
  endPrevious.setUTCDate(endPrevious.getUTCDate() - 1);
  const endPreviousEod = endOfUtcDay(endPrevious);
  const startPrevious = new Date(endPrevious);
  startPrevious.setUTCDate(startPrevious.getUTCDate() - (periodDays - 1));
  startPrevious.setUTCHours(0, 0, 0, 0);

  return {
    current: { startMs: startCurrent.getTime(), endMs: endCurrent.getTime() },
    previous: { startMs: startPrevious.getTime(), endMs: endPreviousEod.getTime() },
    currentLegend: formatRange(startCurrent, endCurrent),
    previousLegend: formatRange(startPrevious, endPreviousEod),
  };
}
