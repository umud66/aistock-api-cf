import type { Evaluation, Instrument, Quote, Rule } from './types';

export class MonitorRepository {
    constructor(private db: D1Database, private userId: string) {
        if (!userId) throw new Error('监控操作需要用户身份');
    }
    async acquire(owner: string, now: number): Promise<boolean> {
        const row = await this.db.prepare(`INSERT INTO user_monitor_locks(user_id,id,owner,expires_at) VALUES(?,'tick',?,?)
            ON CONFLICT(user_id,id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
            WHERE user_monitor_locks.expires_at<=? RETURNING owner`).bind(this.userId, owner, now + 120_000, now).first();
        return !!row;
    }
    async release(owner: string) {
        await this.db.prepare("DELETE FROM user_monitor_locks WHERE user_id=? AND id='tick' AND owner=?").bind(this.userId,owner).run();
    }
    async instruments(): Promise<Instrument[]> {
        return (await this.db.prepare('SELECT * FROM user_monitor_instruments WHERE user_id=? ORDER BY market,symbol').bind(this.userId).all<Instrument>()).results;
    }
    async rules(): Promise<Rule[]> {
        return (await this.db.prepare('SELECT * FROM user_monitor_rules WHERE user_id=? ORDER BY id').bind(this.userId).all<Rule>()).results;
    }
    async save(owner: string, quotes: Quote[], evaluations: Evaluation[], now: number) {
        const guard = "EXISTS(SELECT 1 FROM user_monitor_locks WHERE user_id=? AND id='tick' AND owner=? AND expires_at>unixepoch()*1000)";
        // Three SQL statements for the whole tick, including 100 instruments/200 rules.
        await this.db.batch([
            this.db.prepare(`INSERT INTO user_monitor_quotes(user_id,market,symbol,payload,received_at)
                SELECT ?,json_extract(value,'$.market'),json_extract(value,'$.symbol'),value,? FROM json_each(?) WHERE ${guard}
                ON CONFLICT(user_id,market,symbol) DO UPDATE SET payload=excluded.payload,received_at=excluded.received_at`)
                .bind(this.userId, now, JSON.stringify(quotes), this.userId, owner),
            this.db.prepare(`UPDATE user_monitor_rules SET
                previous_value=json_extract(j.value,'$.previous_value'), previous_time=json_extract(j.value,'$.previous_time'),
                last_triggered_at=json_extract(j.value,'$.last_triggered_at'),count_day=json_extract(j.value,'$.count_day'),
                daily_count=json_extract(j.value,'$.daily_count'),enabled=json_extract(j.value,'$.enabled')
                FROM json_each(?) AS j WHERE user_monitor_rules.user_id=? AND user_monitor_rules.id=json_extract(j.value,'$.id') AND ${guard}`)
                .bind(JSON.stringify(evaluations), this.userId, this.userId, owner),
            this.db.prepare(`INSERT OR IGNORE INTO user_monitor_events(user_id,id,rule_id,payload,created_at)
                SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.rule_id'),json_extract(value,'$.payload'),
                json_extract(value,'$.created_at') FROM json_each(?) WHERE ${guard}`)
                .bind(this.userId, JSON.stringify(evaluations.flatMap(e => e.event ? [e.event] : [])), this.userId, owner),
        ]);
        const lease = await this.db.prepare("SELECT owner FROM user_monitor_locks WHERE user_id=? AND id='tick' AND owner=? AND expires_at>unixepoch()*1000").bind(this.userId,owner).first();
        if (!lease) throw new Error('监控租约已失效，本轮结果未提交');
    }
    async claimEvents(owner: string, now: number) {
        return (await this.db.prepare(`UPDATE user_monitor_events SET status='sending',lease_owner=?,lease_until=?,attempts=attempts+1
            WHERE user_id=? AND id IN (SELECT id FROM user_monitor_events WHERE user_id=? AND
                ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))
                AND attempts<5 ORDER BY created_at LIMIT 5)
            RETURNING id,payload,attempts`).bind(owner, now + 60_000, this.userId, this.userId, now, now)
            .all<{id: string; payload: string; attempts: number}>()).results;
    }
    async completeEvent(id: string, owner: string, attempts: number, now: number, status: number | null, error: string | null) {
        await this.db.prepare(`UPDATE user_monitor_events SET status=?,next_attempt_at=?,lease_until=0,lease_owner=NULL,
            http_status=?,last_error=?,sent_at=? WHERE user_id=? AND id=? AND lease_owner=? AND status='sending'`)
            .bind(error ? (attempts >= 5 ? 'failed' : 'pending') : 'sent', now + 60_000 * 2 ** (attempts - 1),
                status, error, error ? null : now, this.userId, id, owner).run();
    }
    async cleanup(now: number) {
        await this.db.batch([
            this.db.prepare('DELETE FROM user_monitor_runs WHERE user_id=? AND started_at<?').bind(this.userId,now - 7 * 86400_000),
            this.db.prepare("DELETE FROM user_monitor_events WHERE user_id=? AND status IN ('sent','failed') AND created_at<?").bind(this.userId,now - 30 * 86400_000),
            this.db.prepare("UPDATE user_monitor_events SET status='failed',last_error='发送租约过期且重试次数已耗尽' WHERE user_id=? AND status='sending' AND lease_until<=? AND attempts>=5").bind(this.userId,now),
        ]);
    }
}
