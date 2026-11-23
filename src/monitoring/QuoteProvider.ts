import type { Instrument, Quote } from './types';

export function normalizeQuote(row: Record<string, unknown>, now: number): Quote | null {
    const values = [row.f2, row.f18, row.f3, row.f5, row.f6, row.f124];
    if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
    const [price, previousClose, changePercent, lots, amount, seconds] = values as number[];
    const symbol = String(row.f12 ?? '');
    if (!/^\d{6}$/.test(symbol) || (row.f13 !== 0 && row.f13 !== 1) ||
        price <= 0 || previousClose <= 0 || lots < 0 || amount < 0 ||
        now - seconds * 1000 > 120_000 || seconds * 1000 > now + 10_000) return null;
    // Reject inconsistent upstream units rather than trigger against suspect prices.
    if (Math.abs((price / previousClose - 1) * 100 - changePercent) > 0.2) return null;
    return { symbol, market: row.f13 === 1 ? 'SH' : 'SZ', name: String(row.f14 ?? ''),
        price, previousClose, changePercent, volume: lots * 100, amount,
        sourceTime: seconds * 1000, source: 'eastmoney' };
}

/** True upstream batching, separate from the legacy per-stock display API. */
export async function fetchMonitorQuotes(instruments: Instrument[], now: number, fetcher: typeof fetch = fetch): Promise<Quote[]> {
    const quotes: Quote[] = [];
    for (let offset = 0; offset < instruments.length; offset += 50) {
        const batch = instruments.slice(offset, offset + 50);
        const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
        url.searchParams.set('secids', batch.map(i => `${i.market === 'SH' ? 1 : 0}.${i.symbol}`).join(','));
        url.searchParams.set('fields', 'f12,f13,f14,f2,f18,f3,f5,f6,f124');
        url.searchParams.set('fltt', '2');
        url.searchParams.set('invt', '2');
        const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error',
            headers: { Accept: 'application/json', Referer: 'https://quote.eastmoney.com/' } });
        if (!response.ok) throw new Error(`行情源 HTTP ${response.status}`);
        const body = await response.json() as { data?: { diff?: unknown }; rc?: number };
        if (body.rc !== 0 || !Array.isArray(body.data?.diff)) throw new Error('行情源格式异常');
        const expected = new Set(batch.map(i => `${i.market}:${i.symbol}`));
        for (const row of body.data.diff) {
            if (!row || typeof row !== 'object') continue;
            const quote = normalizeQuote(row as Record<string, unknown>, now);
            const key = quote && `${quote.market}:${quote.symbol}`;
            if (quote && key && expected.delete(key)) quotes.push(quote);
        }
    }
    return quotes;
}
