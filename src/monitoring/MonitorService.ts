import { MonitorRepository } from './MonitorRepository';
import { fetchMonitorQuotes } from './QuoteProvider';
import { evaluateRule } from './RuleEngine';
import { deliverEvents } from './Webhook';
import { isAShareTradingTime } from '../utils/tradingTime';
import type { Evaluation, MonitorEnv } from './types';
import { runtimeEnv } from './RuntimeSettings';

export async function runMonitor(env: MonitorEnv, now = Date.now()): Promise<void> {
    const system = await runtimeEnv({...env,MONITOR_USER_ID:undefined});
    if(system.MONITOR_ENABLED !== 'true') return;
    const users=await env.DB.prepare(`SELECT s.user_id FROM user_monitor_settings s
        JOIN account_credentials c ON c.user_id=s.user_id WHERE s.monitor_enabled=1 ORDER BY s.user_id`).all<{user_id:string}>();
    for(const user of users.results) {
        try { await runUserMonitor({...env,MONITOR_USER_ID:user.user_id},now); }
        catch { console.error('[Monitor] 用户监控任务失败',user.user_id); }
    }
}

async function runUserMonitor(env: MonitorEnv & {MONITOR_USER_ID:string}, now: number): Promise<void> {
    const userId=env.MONITOR_USER_ID;
    const current = await runtimeEnv(env);
    if (current.MONITOR_ENABLED !== 'true') return;
    const repository = new MonitorRepository(env.DB,userId);
    const owner = crypto.randomUUID();
    if (!await repository.acquire(owner, now)) return;
    try {
        await repository.cleanup(now);
        if (await isAShareTradingTime({ now })) {
            await env.DB.prepare("INSERT INTO user_monitor_runs(user_id,id,started_at,status) VALUES(?,?,?,'running')").bind(userId,owner, now).run();
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
                await env.DB.prepare('UPDATE user_monitor_runs SET finished_at=?,status=?,quote_count=?,event_count=?,error=? WHERE user_id=? AND id=?')
                    .bind(Date.now(), partial ? 'partial' : 'success', quotes.length, evaluations.filter(e => e.event).length,
                        partial ? `有效行情 ${quotes.length}/${instruments.length}，缺失或过期标的不计算规则` : null, userId,owner).run();
            } catch {
                await env.DB.prepare("UPDATE user_monitor_runs SET finished_at=?,status='failed',error='行情采集或规则持久化失败' WHERE user_id=? AND id=?")
                    .bind(Date.now(),userId,owner).run();
            }
        }
        // Retry delivery outside trading hours as well.
        await deliverEvents(current, now);
    } finally {
        await repository.release(owner);
    }
}
