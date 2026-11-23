import { MonitorRepository } from './MonitorRepository';
import { fetchMonitorQuotes } from './QuoteProvider';
import { evaluateRule } from './RuleEngine';
import { deliverEvents } from './Webhook';
import { isAShareTradingTime } from '../utils/tradingTime';
import type { Evaluation, MonitorEnv } from './types';
import { runtimeEnv } from './RuntimeSettings';

export async function runMonitor(env: MonitorEnv, now = Date.now()): Promise<void> {
    env = await runtimeEnv(env);
    if (env.MONITOR_ENABLED !== 'true') return;
    const repository = new MonitorRepository(env.DB);
    const owner = crypto.randomUUID();
    if (!await repository.acquire(owner, now)) return;
    try {
        await repository.cleanup(now);
        if (await isAShareTradingTime({ now })) {
            await env.DB.prepare("INSERT INTO monitor_runs(id,started_at,status) VALUES(?,?,'running')").bind(owner, now).run();
            try {
                const instruments = (await repository.instruments()).filter(i => i.enabled);
                const quotes = instruments.length ? await fetchMonitorQuotes(instruments, now) : [];
                const byKey = new Map(quotes.map(q => [`${q.market}:${q.symbol}`, q]));
                const evaluations: Evaluation[] = [];
                for (const rule of await repository.rules()) {
                    const quote = byKey.get(`${rule.market}:${rule.symbol}`);
                    const evaluation = quote && evaluateRule(rule, quote, now);
                    if (evaluation) evaluations.push(evaluation);
                }
                await repository.save(owner, quotes, evaluations, now);
                const partial = quotes.length < instruments.length;
                await env.DB.prepare('UPDATE monitor_runs SET finished_at=?,status=?,quote_count=?,event_count=?,error=? WHERE id=?')
                    .bind(Date.now(), partial ? 'partial' : 'success', quotes.length, evaluations.filter(e => e.event).length,
                        partial ? `有效行情 ${quotes.length}/${instruments.length}，缺失或过期标的不计算规则` : null, owner).run();
            } catch {
                await env.DB.prepare("UPDATE monitor_runs SET finished_at=?,status='failed',error='行情采集或规则持久化失败' WHERE id=?")
                    .bind(Date.now(), owner).run();
            }
        }
        // Retry delivery outside trading hours as well.
        await deliverEvents(env, now);
    } finally {
        await repository.release(owner);
    }
}
