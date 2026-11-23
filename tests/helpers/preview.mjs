import { Miniflare,Log,LogLevel } from 'miniflare';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/** Isolated integration fixture: no production bindings, credentials, or market data. */
export async function createPreview() {
    const adminKey=randomBytes(32).toString('hex');
    const mf=new Miniflare({port:0,host:'127.0.0.1',modules:true,scriptPath:resolve('.tmp/build/index.js'),
        compatibilityDate:'2026-01-08',compatibilityFlags:['nodejs_compat'],
        log:new Log(LogLevel.ERROR),d1Databases:['DB'],kvNamespaces:['KV'],
        bindings:{MONITOR_ADMIN_TOKEN:adminKey,AUTH_PASSWORD_PEPPER:randomBytes(32).toString('hex'),MONITOR_ENABLED:'false'},
        assets:{directory:resolve('.tmp/web-dist'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true},assetConfig:{not_found_handling:'single-page-application'}},
        outboundService:async request=>{
            const url=new URL(request.url);
            if(url.hostname.endsWith('eastmoney.com')&&url.pathname.includes('stock/get')) {
                const symbol=url.searchParams.get('secid')?.split('.')[1]||'000001';
                return Response.json({data:{f57:symbol,f58:'浏览器测试标的',f43:10,f170:1,f86:Math.floor(Date.now()/1000)}});
            }
            return new Response('External requests are disabled in browser test fixtures',{status:503});
        },
    });
    try{
        const db=await mf.getD1Database('DB');
        for(const file of ['users-schema.sql','user_settings.sql','accounts.sql','monitoring.sql']) {
            const statements=readFileSync('scripts/'+file,'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
            await db.batch(statements.map(sql=>db.prepare(sql)));
        }
        await db.prepare('CREATE TABLE stocks(symbol TEXT PRIMARY KEY,name TEXT,pinyin TEXT,market TEXT)').run();
        const url=(await mf.ready).toString();
        return {mf,db,url,adminKey};
    }catch(error){await mf.dispose();throw error;}
}
