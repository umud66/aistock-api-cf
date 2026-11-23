export interface AccountEnv {
    DB: D1Database;
    KV?: KVNamespace;
    ADMIN_PASSWORD?: string;
    AUTH_PASSWORD_PEPPER?: string;
    FRONTEND_URL?: string;
    CORS_ALLOW_ORIGIN?: string;
}

export async function digest(value: string): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    return Array.from(bytes, v => v.toString(16).padStart(2, '0')).join('');
}

export const ADMIN_COOKIE = '__Host-stockwatch_admin';
export async function adminCredentialHash(password: string, session: string): Promise<string> {
    // Bind password rotation to the unpersisted random cookie, not a fast password hash in D1.
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('stockwatch:admin-password:v2:'+session));
    return Array.from(new Uint8Array(signed),value=>value.toString(16).padStart(2,'0')).join('');
}
export async function isAdmin(request: Request, env: Pick<AccountEnv, 'ADMIN_PASSWORD'> & {DB?:D1Database}): Promise<boolean> {
    if (!env.ADMIN_PASSWORD || !env.DB) return false;
    const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-stockwatch_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!cookie) return false;
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && !trustedOrigin(request,env as AccountEnv)) return false;
    const row = await env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND credential_hash=? AND expires_at>?')
        .bind(await digest(cookie),await adminCredentialHash(env.ADMIN_PASSWORD,cookie),Date.now()).first();
    return !!row;
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
