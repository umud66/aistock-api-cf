import { isAdmin } from '../auth/security';
import { runtimeEnv } from '../monitoring/RuntimeSettings';
import { createResponse } from '../utils/response';
import { MonitorRepository } from '../monitoring/MonitorRepository';
import { fetchMonitorQuotes } from '../monitoring/QuoteProvider';
import { validateWebhookUrl } from '../monitoring/Webhook';
import type { Instrument, MonitorEnv, Rule } from '../monitoring/types';

class InputError extends Error {}
function check(condition: unknown, message: string): asserts condition {
    if (!condition) throw new InputError(message);
}
function flag(value: unknown, fallback = 1): number {
    if (value === undefined) return fallback;
    check(typeof value === 'boolean', '启停字段必须是 boolean');
    return value ? 1 : 0;
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
    const result = value === undefined ? fallback : value;
    check(typeof result === 'number' && Number.isInteger(result) && result >= min && result <= max, `整数范围必须为 ${min}–${max}`);
    return result;
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
    check(request.headers.get('Content-Type')?.includes('application/json'), '请求需要 application/json');
    const text = await request.text();
    check(text.length <= 16_384, '请求体超过 16 KB');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new InputError('请求体不是有效 JSON'); }
    check(body && typeof body === 'object' && !Array.isArray(body), '请求体需要 JSON 对象');
    return body as Record<string, unknown>;
}

export class MonitorController {
    static async handle(request: Request, env: MonitorEnv): Promise<Response> {
        if (!await isAdmin(request, env)) return createResponse(401, '请先登录管理员账号');
        const path = new URL(request.url).pathname.replace(/\/$/, '');
        const repository = new MonitorRepository(env.DB);
        let lockOwner: string | null = null;
        try {
            env = await runtimeEnv(env);
            if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) return createResponse(405, 'Method Not Allowed');
            if (request.method !== 'GET') {
                lockOwner = crypto.randomUUID();
                if (!await repository.acquire(lockOwner, Date.now())) {
                    lockOwner = null;
                    return createResponse(409, '监控任务正在执行，请稍后重试');
                }
            }
            if (path === '/api/monitor/status' && request.method === 'GET') {
                const runs = await env.DB.prepare('SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT 10').all();
                const counts = await env.DB.prepare('SELECT status,COUNT(*) AS count FROM monitor_events GROUP BY status').all();
                return createResponse(200, 'success', { enabled: env.MONITOR_ENABLED === 'true',
                    webhook_configured: !!env.MONITOR_WEBHOOK_URL, source: 'eastmoney', runs: runs.results, notifications: counts.results });
            }
            if (path === '/api/monitor/instruments') {
                if (request.method === 'GET') {
                    const quotes = await env.DB.prepare('SELECT market,symbol,payload,received_at FROM monitor_quotes').all<{market:string;symbol:string;payload:string;received_at:number}>();
                    const byKey = new Map(quotes.results.map(q => [`${q.market}:${q.symbol}`, {
                        ...JSON.parse(q.payload), received_at: q.received_at,
                        stale: Date.now() - JSON.parse(q.payload).sourceTime > 120_000,
                    }]));
                    return createResponse(200, 'success', (await repository.instruments()).map(i => ({ ...i, quote: byKey.get(`${i.market}:${i.symbol}`) ?? null })));
                }
                if (request.method === 'POST') {
                    const b = await bodyOf(request);
                    const item = this.instrument(b);
                    const result = await env.DB.prepare(`INSERT INTO monitor_instruments(symbol,market,name,kind,enabled)
                        SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM monitor_instruments)<100
                        ON CONFLICT(market,symbol) DO NOTHING RETURNING symbol`)
                        .bind(item.symbol,item.market,item.name,item.kind,item.enabled).first();
                    return result ? createResponse(201, '已添加', item) : createResponse(409, '标的已存在或已达到 100 只上限');
                }
                return createResponse(405, '仅支持 GET/POST');
            }
            const instrumentMatch = path.match(/^\/api\/monitor\/instruments\/(SH|SZ)\/(\d{6})$/);
            if (instrumentMatch) {
                const [, market, symbol] = instrumentMatch;
                if (request.method === 'DELETE') {
                    const result = await env.DB.prepare('DELETE FROM monitor_instruments WHERE market=? AND symbol=? RETURNING symbol').bind(market,symbol).first();
                    return createResponse(result ? 200 : 404, result ? '已删除标的及其规则' : '标的不存在');
                }
                if (request.method === 'PUT') {
                    const existing = await env.DB.prepare('SELECT * FROM monitor_instruments WHERE market=? AND symbol=?').bind(market,symbol).first<Instrument>();
                    if (!existing) return createResponse(404,'标的不存在');
                    const b = await bodyOf(request);
                    const item = this.instrument({ ...existing, enabled: !!existing.enabled, ...b, market, symbol });
                    await env.DB.prepare('UPDATE monitor_instruments SET name=?,kind=?,enabled=? WHERE market=? AND symbol=?').bind(item.name,item.kind,item.enabled,market,symbol).run();
                    return createResponse(200,'已更新',item);
                }
                return createResponse(405,'仅支持 PUT/DELETE');
            }
            if (path === '/api/monitor/rules' && request.method === 'GET') return createResponse(200,'success',await repository.rules());
            const ruleMatch = path.match(/^\/api\/monitor\/rules\/([a-f0-9-]{36})$/);
            if (path === '/api/monitor/rules' && request.method === 'POST' || ruleMatch && request.method === 'PUT') {
                const id = ruleMatch ? ruleMatch[1] : crypto.randomUUID();
                const old = ruleMatch ? await env.DB.prepare('SELECT * FROM monitor_rules WHERE id=?').bind(id).first<Rule>() : null;
                if (ruleMatch && !old) return createResponse(404,'规则不存在');
                const b = { ...(old ? { ...old, enabled: !!old.enabled, auto_disable: !!old.auto_disable } : {}), ...await bodyOf(request) };
                check(typeof b.symbol === 'string' && /^\d{6}$/.test(b.symbol) && ['SH','SZ'].includes(String(b.market)), '需要有效 symbol 和 market');
                check(['price','change_percent'].includes(String(b.metric)), 'metric 支持 price/change_percent');
                check(['above','below','cross_above','cross_below'].includes(String(b.operator)), 'operator 不受支持');
                check(typeof b.threshold === 'number' && Number.isFinite(b.threshold) && Math.abs(b.threshold) <= 1e9 && (b.metric !== 'price' || b.threshold > 0), 'threshold 必须为有效数值，价格阈值必须大于 0');
                const cooldown = integer(b.cooldown_seconds,300,60,86400);
                const dailyLimit = integer(b.daily_limit,3,1,100);
                const enabled = flag(b.enabled), autoDisable = flag(b.auto_disable,0);
                check(await env.DB.prepare('SELECT symbol FROM monitor_instruments WHERE market=? AND symbol=?').bind(b.market,b.symbol).first(), '请先添加监控标的');
                if (!old) {
                    const result = await env.DB.prepare(`INSERT INTO monitor_rules(id,symbol,market,metric,operator,threshold,cooldown_seconds,daily_limit,auto_disable,enabled)
                        SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM monitor_rules)<200 RETURNING id`)
                        .bind(id,b.symbol,b.market,b.metric,b.operator,b.threshold,cooldown,dailyLimit,autoDisable,enabled).first();
                    if (!result) return createResponse(409,'最多支持 200 条规则');
                } else {
                    await env.DB.prepare(`UPDATE monitor_rules SET symbol=?,market=?,metric=?,operator=?,threshold=?,cooldown_seconds=?,daily_limit=?,auto_disable=?,enabled=?,previous_value=NULL,previous_time=NULL WHERE id=?`)
                        .bind(b.symbol,b.market,b.metric,b.operator,b.threshold,cooldown,dailyLimit,autoDisable,enabled,id).run();
                }
                return createResponse(old ? 200 : 201,'规则已保存', { id });
            }
            if (ruleMatch && request.method === 'DELETE') {
                const row = await env.DB.prepare('DELETE FROM monitor_rules WHERE id=? RETURNING id').bind(ruleMatch[1]).first();
                return createResponse(row ? 200 : 404,row ? '已删除' : '规则不存在');
            }
            if (path === '/api/monitor/events' && request.method === 'GET') {
                const url = new URL(request.url);
                const page = Number(url.searchParams.get('page') || 1);
                check(Number.isSafeInteger(page) && page >= 1 && page <= 10000,'page 范围为 1–10000');
                const rows = await env.DB.prepare('SELECT * FROM monitor_events ORDER BY created_at DESC,id LIMIT 50 OFFSET ?').bind((page-1)*50).all();
                return createResponse(200,'success',{page,page_size:50,events:rows.results});
            }
            const retryMatch = path.match(/^\/api\/monitor\/events\/([^/]+)\/retry$/);
            if (retryMatch && request.method === 'POST') {
                const id = decodeURIComponent(retryMatch[1]);
                check(id.length<=128,'无效事件编号');
                const row = await env.DB.prepare("UPDATE monitor_events SET status='pending',attempts=0,next_attempt_at=0,lease_owner=NULL,lease_until=0,last_error=NULL WHERE id=? AND status='failed' RETURNING id").bind(id).first();
                return createResponse(row ? 202 : 409,row ? '通知已重新排队' : '该通知不存在或不处于失败状态');
            }
            if (path === '/api/monitor/webhook/test' && request.method === 'POST') {
                check(env.MONITOR_ENABLED === 'true', '请先在系统设置中开启自动监控，测试通知将在下一轮检查中发送');
                check(env.MONITOR_WEBHOOK_URL,'尚未配置 Webhook Secret');
                validateWebhookUrl(env.MONITOR_WEBHOOK_URL);
                const id = `test:${crypto.randomUUID()}`;
                const now = Date.now();
                await env.DB.prepare('INSERT INTO monitor_events(id,payload,created_at) VALUES(?,?,?)')
                    .bind(id,JSON.stringify({event:'stockwatch.test',event_id:id,timestamp:new Date(now).toISOString()}),now).run();
                return createResponse(202,'已排队，将由下一轮 Cron 发送',{id});
            }
            if (path === '/api/monitor/probe' && request.method === 'POST') {
                const instruments = (await repository.instruments()).filter(i=>i.enabled);
                check(instruments.length,'请先添加测试标的');
                const quotes = await fetchMonitorQuotes(instruments, Date.now());
                return createResponse(200,'仅返回真实且两分钟内更新的行情；休市时可能为空',{
                    requested: instruments.length, valid:quotes.length,quotes,
                    missing:instruments.filter(i=>!quotes.some(q=>q.market===i.market && q.symbol===i.symbol)),
                });
            }
            return createResponse(404,'监控接口不存在');
        } catch (error) {
            return createResponse(error instanceof InputError ? 400 : 500,
                error instanceof InputError ? error.message : '监控操作失败，请检查数据库迁移或服务配置');
        } finally {
            if (lockOwner) await repository.release(lockOwner);
        }
    }

    private static instrument(b: Record<string, unknown>): Instrument {
        check(typeof b.symbol === 'string' && /^\d{6}$/.test(b.symbol),'symbol 必须为六位字符串');
        check(b.market === 'SH' || b.market === 'SZ','market 必须为 SH/SZ');
        check(b.kind === 'stock' || b.kind === 'etf','kind 必须为 stock/etf');
        const prefix = b.kind === 'etf' ? (b.market === 'SH' ? /^(51|56|58)/ : /^15/)
            : (b.market === 'SH' ? /^(60|68)/ : /^(00|30)/);
        check(prefix.test(b.symbol),'证券代码与市场或类型不匹配');
        check(b.name === undefined || typeof b.name === 'string' && b.name.length <= 80,'名称最长 80 字符');
        return { symbol:b.symbol,market:b.market,kind:b.kind,name:String(b.name ?? ''),enabled:flag(b.enabled) };
    }
}
