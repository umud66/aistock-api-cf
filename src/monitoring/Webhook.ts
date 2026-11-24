import { MonitorRepository } from './MonitorRepository';
import type { MonitorEnv } from './types';

export function validateWebhookUrl(value: string): URL {
    const url = new URL(value);
    // Each authenticated user configures their own public HTTPS destination.
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) ||
        /(?:^|\.)(localhost|local|internal|test|invalid|example|home|lan|arpa)$/.test(url.hostname) ||
        /\.(?:nip\.io|sslip\.io)$/.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
        throw new Error('Webhook 必须使用公开域名的 HTTPS URL，端口仅允许 443');
    }
    return url;
}

export async function deliverEvents(env: MonitorEnv, now: number, fetcher: typeof fetch = fetch) {
    if (!env.MONITOR_USER_ID || !env.MONITOR_WEBHOOK_URL) return;
    const url = validateWebhookUrl(env.MONITOR_WEBHOOK_URL);
    const repository = new MonitorRepository(env.DB,env.MONITOR_USER_ID);
    const owner = crypto.randomUUID();
    const events = await repository.claimEvents(owner, now);
    for (const event of events) {
        let status: number | null = null;
        let error: string | null = null;
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': event.id };
            if (env.MONITOR_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${env.MONITOR_WEBHOOK_TOKEN}`;
            const response = await fetcher(url.toString(), { method: 'POST', headers, body: event.payload,
                redirect: 'error', signal: AbortSignal.timeout(5000) });
            status = response.status;
            await response.body?.cancel();
            if (!response.ok) error = `Webhook HTTP ${response.status}`;
        } catch {
            // Do not log URL, credentials, response bodies, or upstream exception text.
            error = 'Webhook 网络失败或超时';
        }
        await repository.completeEvent(event.id, owner, event.attempts, Date.now(), status, error);
    }
}
