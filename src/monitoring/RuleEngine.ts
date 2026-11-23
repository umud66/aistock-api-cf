import type { Evaluation, Quote, Rule } from './types';

export function chinaDay(time: number): string {
    return new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
}

/** Invalid/stale/out-of-order data never advances crossing state. */
export function evaluateRule(rule: Rule, quote: Quote, now: number): Evaluation | null {
    const value = rule.metric === 'price' ? quote.price : quote.changePercent;
    if (!rule.enabled || rule.symbol !== quote.symbol || rule.market !== quote.market ||
        !Number.isFinite(value) || quote.price <= 0 || quote.previousClose <= 0 ||
        !Number.isFinite(quote.sourceTime) || now - quote.sourceTime > 120_000 ||
        quote.sourceTime > now + 10_000 || chinaDay(now) !== chinaDay(quote.sourceTime) ||
        (rule.previous_time !== null && quote.sourceTime <= rule.previous_time)) return null;

    // Never infer an intraday crossing from yesterday's close or a long sampling gap.
    const previous = rule.previous_time !== null &&
        chinaDay(rule.previous_time) === chinaDay(now) && quote.sourceTime - rule.previous_time <= 180_000
        ? rule.previous_value : null;
    let matched = false;
    switch (rule.operator) {
        case 'above': matched = value > rule.threshold; break;
        case 'below': matched = value < rule.threshold; break;
        case 'cross_above': matched = previous !== null && previous <= rule.threshold && value > rule.threshold; break;
        case 'cross_below': matched = previous !== null && previous >= rule.threshold && value < rule.threshold; break;
    }
    const day = chinaDay(now);
    const count = rule.count_day === day ? rule.daily_count : 0;
    const trigger = matched && count < rule.daily_limit &&
        (rule.last_triggered_at === null || now - rule.last_triggered_at >= rule.cooldown_seconds * 1000);
    return {
        id: rule.id, previous_value: value, previous_time: quote.sourceTime,
        last_triggered_at: trigger ? now : rule.last_triggered_at,
        count_day: day, daily_count: count + (trigger ? 1 : 0),
        enabled: trigger && rule.auto_disable ? 0 : rule.enabled,
        event: trigger ? {
            id: `${rule.id}:${quote.sourceTime}`, rule_id: rule.id, created_at: now,
            payload: JSON.stringify({
                event: 'stockwatch.rule.triggered', event_id: `${rule.id}:${quote.sourceTime}`,
                symbol: quote.symbol, market: quote.market, name: quote.name, price: quote.price,
                change_percent: quote.changePercent, volume: quote.volume, amount: quote.amount,
                source: quote.source, source_time: new Date(quote.sourceTime).toISOString(),
                timestamp: new Date(now).toISOString(),
                rule: { id: rule.id, metric: rule.metric, operator: rule.operator, threshold: rule.threshold },
            }),
        } : null,
    };
}
