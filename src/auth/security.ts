export interface AccountEnv {
    DB: D1Database;
    MONITOR_ADMIN_TOKEN?: string;
    AUTH_PASSWORD_PEPPER?: string;
    FRONTEND_URL?: string;
    CORS_ALLOW_ORIGIN?: string;
}

export async function digest(value: string): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    return Array.from(bytes, v => v.toString(16).padStart(2, '0')).join('');
}

export const ADMIN_COOKIE = '__Host-stockwatch_admin';
export async function isAdmin(request: Request, env: Pick<AccountEnv, 'MONITOR_ADMIN_TOKEN'> & {DB?:D1Database}): Promise<boolean> {
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!env.MONITOR_ADMIN_TOKEN || env.MONITOR_ADMIN_TOKEN.length < 32) return false;
    if (!token) {
        const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-stockwatch_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
        if (!cookie || !env.DB) return false;
        if (!['GET','HEAD','OPTIONS'].includes(request.method) && !trustedOrigin(request,env as AccountEnv)) return false;
        const row = await env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND credential_hash=? AND expires_at>?')
            .bind(await digest(cookie),await digest(env.MONITOR_ADMIN_TOKEN),Date.now()).first();
        return !!row;
    }
    if (token.length > 512) return false;
    const a = await digest(token), b = await digest(env.MONITOR_ADMIN_TOKEN);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return difference === 0;
}

export function trustedOrigin(request: Request, env: AccountEnv): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return request.headers.get('Sec-Fetch-Site') !== 'cross-site';
    const allowed = [new URL(request.url).origin];
    for (const value of [env.FRONTEND_URL, env.CORS_ALLOW_ORIGIN]) {
        if (value && value !== '*') {
            try { allowed.push(new URL(value).origin); } catch { /* Invalid configuration does not allow extra origins. */ }
        }
    }
    return allowed.includes(origin);
}

export const SESSION_COOKIE = '__Host-stockwatch_session';
export function sessionToken(request: Request): string | null {
    const value = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-stockwatch_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    return value ?? null;
}
export async function authenticatedUser(request: Request, env: AccountEnv): Promise<string | null> {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !trustedOrigin(request, env)) return null;
    const token = sessionToken(request);
    if (!token) return null;
    const row = await env.DB.prepare('SELECT user_id FROM account_sessions WHERE token_hash=? AND expires_at>?')
        .bind(await digest(token), Date.now()).first<{ user_id: string }>();
    return row?.user_id ?? null;
}
