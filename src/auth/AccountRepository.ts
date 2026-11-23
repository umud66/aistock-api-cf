export class AccountRepository {
    constructor(private db: D1Database) {}

    async settings() {
        const row = await this.db.prepare('SELECT allow_registration,updated_at FROM system_settings WHERE id=1')
            .first<{allow_registration: number; updated_at: number}>();
        return { allow_registration: row?.allow_registration === 1, updated_at: row?.updated_at ?? 0 };
    }
    async setRegistration(allowed: boolean) {
        await this.db.prepare(`INSERT INTO system_settings(id,allow_registration,updated_at) VALUES(1,?,?)
            ON CONFLICT(id) DO UPDATE SET allow_registration=excluded.allow_registration,updated_at=excluded.updated_at`)
            .bind(allowed ? 1 : 0, Date.now()).run();
        return this.settings();
    }
    async find(username: string) {
        return this.db.prepare('SELECT user_id,username,password_hash FROM account_credentials WHERE username=?')
            .bind(username).first<{user_id:string; username:string; password_hash:string}>();
    }
    async create(username: string, passwordHash: string, nickname: string, administrator: boolean) {
        const id = crypto.randomUUID();
        const gate = '(?=1 OR EXISTS(SELECT 1 FROM system_settings WHERE id=1 AND allow_registration=1))';
        // Both statements see one transaction; a concurrent close cannot leave a partial account.
        const result = await this.db.batch([
            this.db.prepare(`INSERT INTO users(openid,nickname,avatar_url) SELECT ?,?,'' WHERE ${gate}`)
                .bind(id,nickname,administrator ? 1 : 0),
            this.db.prepare(`INSERT INTO account_credentials(user_id,username,password_hash,created_at)
                SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE openid=?) AND ${gate} RETURNING user_id`)
                .bind(id,username,passwordHash,Date.now(),id,administrator ? 1 : 0),
        ]);
        return result[1].results.length ? id : null;
    }
    async consumeLimit(bucket: string, limit: number, now = Date.now()): Promise<boolean> {
        const row = await this.db.prepare(`INSERT INTO auth_rate_limits(bucket,window_start,attempts) VALUES(?,?,1)
            ON CONFLICT(bucket) DO UPDATE SET
            window_start=CASE WHEN auth_rate_limits.window_start<=? THEN excluded.window_start ELSE auth_rate_limits.window_start END,
            attempts=CASE WHEN auth_rate_limits.window_start<=? THEN 1 ELSE auth_rate_limits.attempts+1 END
            WHERE auth_rate_limits.window_start<=? OR auth_rate_limits.attempts<? RETURNING attempts`)
            .bind(bucket,now,now-900_000,now-900_000,now-900_000,limit).first();
        return !!row;
    }
    async cleanup() {
        const now = Date.now();
        await this.db.batch([
            this.db.prepare('DELETE FROM account_sessions WHERE token_hash IN (SELECT token_hash FROM account_sessions WHERE expires_at<=? LIMIT 100)').bind(now),
            this.db.prepare('DELETE FROM auth_rate_limits WHERE bucket IN (SELECT bucket FROM auth_rate_limits WHERE window_start<? LIMIT 100)').bind(now-86400_000),
        ]);
    }
}
