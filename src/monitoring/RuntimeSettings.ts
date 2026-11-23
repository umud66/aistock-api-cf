import type { MonitorEnv } from './types';
import { validateWebhookUrl } from './Webhook';

async function key(env: MonitorEnv): Promise<CryptoKey> {
    if (!env.AUTH_PASSWORD_PEPPER || env.AUTH_PASSWORD_PEPPER.length < 32) throw new Error('请先配置账号加密密钥');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`stockwatch:settings:${env.AUTH_PASSWORD_PEPPER}`));
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function seal(value: string, env: MonitorEnv): Promise<string> {
    if (!value) return '';
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),new TextEncoder().encode(value));
    const bytes = new Uint8Array(iv.length+encrypted.byteLength);
    bytes.set(iv);bytes.set(new Uint8Array(encrypted),iv.length);
    return btoa(String.fromCharCode(...bytes));
}
async function open(value: string, env: MonitorEnv): Promise<string> {
    if (!value) return '';
    const bytes = Uint8Array.from(atob(value),c=>c.charCodeAt(0));
    const decoded = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await key(env),bytes.slice(12));
    return new TextDecoder().decode(decoded);
}
export async function runtimeEnv(env: MonitorEnv): Promise<MonitorEnv> {
    const row = await env.DB.prepare('SELECT * FROM monitor_settings WHERE id=1')
        .first<{monitor_enabled:number|null;webhook_url:string|null;webhook_token:string|null}>();
    if (!row) return env;
    return {...env,
        MONITOR_ENABLED:row.monitor_enabled===null ? env.MONITOR_ENABLED : String(row.monitor_enabled===1),
        MONITOR_WEBHOOK_URL:row.webhook_url===null ? env.MONITOR_WEBHOOK_URL : await open(row.webhook_url,env),
        MONITOR_WEBHOOK_TOKEN:row.webhook_token===null ? env.MONITOR_WEBHOOK_TOKEN : await open(row.webhook_token,env),
    };
}
export async function publicRuntime(env: MonitorEnv) {
    const current = await runtimeEnv(env);
    let host = '';
    try {host = current.MONITOR_WEBHOOK_URL ? new URL(current.MONITOR_WEBHOOK_URL).hostname : '';} catch { /* Invalid URL is shown as unconfigured. */ }
    return {monitor_enabled:current.MONITOR_ENABLED==='true',webhook_configured:!!host,webhook_host:host,
        webhook_token_configured:!!current.MONITOR_WEBHOOK_TOKEN,source:'东方财富',interval_seconds:60,max_instruments:100,max_rules:200};
}
export async function saveRuntime(env: MonitorEnv, input: Record<string,unknown>) {
    for (const name of Object.keys(input)) if (!['monitor_enabled','webhook_url','webhook_token','clear_webhook','clear_webhook_token'].includes(name)) throw new Error('包含未知设置项');
    if (input.monitor_enabled!==undefined && typeof input.monitor_enabled!=='boolean') throw new Error('监控开关必须为布尔值');
    for (const name of ['clear_webhook','clear_webhook_token']) if (input[name]!==undefined && typeof input[name]!=='boolean') throw new Error('清除选项必须为布尔值');
    for (const name of ['webhook_url','webhook_token']) if (input[name]!==undefined && (typeof input[name]!=='string' || String(input[name]).length>2048)) throw new Error('通知配置最长 2048 字符');
    if (input.webhook_url) validateWebhookUrl(String(input.webhook_url));
    const old = await env.DB.prepare('SELECT * FROM monitor_settings WHERE id=1')
        .first<{monitor_enabled:number|null;webhook_url:string|null;webhook_token:string|null}>();
    const url = input.clear_webhook ? '' : input.webhook_url ? await seal(String(input.webhook_url),env) : old?.webhook_url ?? null;
    const token = input.clear_webhook_token ? '' : input.webhook_token ? await seal(String(input.webhook_token),env) : old?.webhook_token ?? null;
    const enabled = typeof input.monitor_enabled==='boolean' ? Number(input.monitor_enabled) : old?.monitor_enabled ?? null;
    await env.DB.prepare(`INSERT INTO monitor_settings(id,monitor_enabled,webhook_url,webhook_token) VALUES(1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET monitor_enabled=excluded.monitor_enabled,webhook_url=excluded.webhook_url,webhook_token=excluded.webhook_token`)
        .bind(enabled,url,token).run();
    return publicRuntime(env);
}
