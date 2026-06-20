/**
 * Historical USD → ILS conversion using the Frankfurter API (ECB reference
 * rates, free, no API key). Rates are published per business day; weekends and
 * holidays resolve to the most recent prior business day automatically.
 *
 * Costs are stored in USD; we convert each cost using the exchange rate of the
 * day it was incurred ("שער הדולר באותו יום").
 */
const cache = new Map<string, number | null>();

function toDateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

async function fetchRate(dateKey: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${dateKey}?from=USD&to=ILS`);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.ILS;
    return typeof rate === 'number' ? rate : null;
  } catch {
    return null;
  }
}

/** Fetch USD→ILS rates for a set of ISO timestamps, keyed by YYYY-MM-DD. */
export async function getUsdToIlsRates(isoDates: string[]): Promise<Map<string, number | null>> {
  const keys = [...new Set(isoDates.map(toDateKey))];
  const missing = keys.filter((k) => !cache.has(k));
  await Promise.all(
    missing.map(async (k) => {
      cache.set(k, await fetchRate(k));
    })
  );
  const result = new Map<string, number | null>();
  for (const k of keys) result.set(k, cache.get(k) ?? null);
  return result;
}

/** Look up a previously-fetched rate for a given ISO timestamp. */
export function rateForDate(rates: Map<string, number | null>, iso: string): number | null {
  return rates.get(toDateKey(iso)) ?? null;
}

export function formatIls(n: number): string {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n);
}
