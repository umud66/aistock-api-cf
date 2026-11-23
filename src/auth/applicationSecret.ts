interface CryptoEnvironment {
    DB: D1Database;
    KV?: KVNamespace;
    AUTH_PASSWORD_PEPPER?: string;
}

const cache=new Map<string,string>();
const prefix='stockwatch:application-key:v1:';

/** Stable across administrator password changes; never derive data keys from a login password. */
export async function applicationSecret(env: CryptoEnvironment): Promise<string> {
    const kv=env.KV;
    if(!kv)throw new Error('请先在控制台绑定名称为 KV 的存储资源');
    let row=await env.DB.prepare('SELECT key_id FROM application_crypto_config WHERE id=1').first<{key_id:string}>();
    if(!row&&!env.AUTH_PASSWORD_PEPPER){
        const legacy=await env.DB.prepare(`SELECT
            EXISTS(SELECT 1 FROM account_credentials) OR
            EXISTS(SELECT 1 FROM monitor_settings WHERE length(webhook_url)>0 OR length(webhook_token)>0) AS present`)
            .first<{present:number}>();
        if(legacy?.present){
            row=await env.DB.prepare('SELECT key_id FROM application_crypto_config WHERE id=1').first<{key_id:string}>();
            if(!row)throw new Error('检测到旧加密数据，首次升级需保留旧加密配置，系统接管后即可移除');
        }
    }
    if(!row){
        const keyId=crypto.randomUUID();
        // Import the former optional pepper once so existing credentials/config remain readable.
        const secret=env.AUTH_PASSWORD_PEPPER || Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
        // Each contender writes a unique KV key before a D1 compare-and-set selects the winner.
        await kv.put(prefix+keyId,secret);
        await env.DB.prepare('INSERT OR IGNORE INTO application_crypto_config(id,key_id) VALUES(1,?)').bind(keyId).run();
        row=await env.DB.prepare('SELECT key_id FROM application_crypto_config WHERE id=1').first<{key_id:string}>();
        if(row?.key_id===keyId){cache.set(keyId,secret);return secret;}
    }
    if(!row)throw new Error('内部加密配置初始化失败，请稍后重试');
    const cached=cache.get(row.key_id);if(cached)return cached;
    const secret=await kv.get(prefix+row.key_id);
    // KV may briefly lag after initial creation. Never generate a replacement for an existing ID.
    if(!secret)throw new Error('内部加密配置暂不可用，请稍后重试');
    cache.set(row.key_id,secret);
    return secret;
}
