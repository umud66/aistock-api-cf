import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
export * from './src/monitoring/RuleEngine';
export * from './src/monitoring/QuoteProvider';
export * from './src/monitoring/MonitorRepository';
export * from './src/monitoring/Webhook';
export * from './src/monitoring/MonitorService';
export * from './src/controllers/MonitorController';
export * from './src/utils/stock';
export * from './src/utils/throttle';
export * from './src/services/CacheService';
export * from './src/auth/security';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle:true, write:false, format:'esm', platform:'browser', target:'es2022' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const now = new Date('2026-11-23T02:00:00Z').getTime();
const quote = {symbol:'159915',market:'SZ',name:'创业板ETF',price:11,previousClose:10,changePercent:10,volume:1000,amount:11000,sourceTime:now,source:'eastmoney'};
const rule = {id:'12345678-1234-1234-1234-123456789012',symbol:'159915',market:'SZ',metric:'price',operator:'above',threshold:10,cooldown_seconds:300,daily_limit:3,auto_disable:0,enabled:1,previous_value:null,previous_time:null,last_triggered_at:null,count_day:null,daily_count:0};

function database() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    sqlite.function('unixepoch', () => Math.floor(now/1000));
    // Apply twice to verify idempotent startup.
    for(let i=0;i<2;i++) for(const file of ['users-schema.sql','accounts.sql','monitoring.sql']) sqlite.exec(readFileSync('scripts/'+file,'utf8'));
    const db = {
        prepare(sql) {
            let values=[];
            const prepared={ bind(...args){values=args;return prepared;},
                async first(){return sqlite.prepare(sql).all(...values)[0] ?? null;},
                async all(){return {results:sqlite.prepare(sql).all(...values),success:true};},
                async run(){const rows=sqlite.prepare(sql).all(...values);return {results:rows,success:true};} };
            return prepared;
        },
        async batch(statements){sqlite.exec('BEGIN');try{const rows=[];for(const s of statements) rows.push(await s.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}},
    };
    sqlite.exec("INSERT INTO monitor_instruments(symbol,market,name,kind) VALUES('159915','SZ','ETF','etf')");
    return {db,sqlite};
}
function insertRule(sqlite) {
    sqlite.prepare('INSERT INTO monitor_rules(id,symbol,market,metric,operator,threshold) VALUES(?,?,?,?,?,?)').run(rule.id,rule.symbol,rule.market,rule.metric,rule.operator,rule.threshold);
}

test('price and percentage thresholds use strict inequalities',()=>{
    assert.ok(api.evaluateRule(rule,quote,now).event);
    assert.equal(api.evaluateRule({...rule,threshold:11},quote,now).event,null);
    assert.ok(api.evaluateRule({...rule,metric:'change_percent',threshold:9},quote,now).event);
    assert.ok(api.evaluateRule({...rule,operator:'below',threshold:12},quote,now).event);
});
test('crossing needs a recent same-day baseline and fires in both directions',()=>{
    const cross={...rule,operator:'cross_above'};
    assert.equal(api.evaluateRule(cross,quote,now).event,null);
    assert.ok(api.evaluateRule({...cross,previous_value:10,previous_time:now-60000},quote,now).event);
    assert.equal(api.evaluateRule({...cross,previous_value:10,previous_time:now-86400000},quote,now).event,null);
    assert.equal(api.evaluateRule({...cross,previous_value:10,previous_time:now-300000},quote,now).event,null);
    assert.ok(api.evaluateRule({...cross,operator:'cross_below',threshold:12,previous_value:13,previous_time:now-60000},quote,now).event);
});
test('missing, suspended, stale, future, duplicate, wrong-market data never advances state',()=>{
    for(const q of [{...quote,price:0},{...quote,price:NaN},{...quote,sourceTime:now-121000},{...quote,sourceTime:now+11000},{...quote,market:'SH'}]) assert.equal(api.evaluateRule(rule,q,now),null);
    assert.equal(api.evaluateRule({...rule,previous_time:now},quote,now),null);
});
test('cooldown, daily reset, daily cap and automatic disable',()=>{
    assert.equal(api.evaluateRule({...rule,last_triggered_at:now-1000},quote,now).event,null);
    assert.equal(api.evaluateRule({...rule,count_day:'2026-11-23',daily_count:3},quote,now).event,null);
    const reset=api.evaluateRule({...rule,count_day:'2026-11-22',daily_count:3,auto_disable:1},quote,now);
    assert.equal(reset.daily_count,1);assert.equal(reset.enabled,0);assert.ok(reset.event);
});
test('provider validates source units, freshness, and rejects missing numeric fields',()=>{
    const raw={f12:'159915',f13:0,f14:'ETF',f2:11,f18:10,f3:10,f5:10,f6:11000,f124:now/1000};
    assert.equal(api.normalizeQuote(raw,now).volume,1000);
    for(const extra of [{f2:'-'},{f13:2},{f124:now/1000-121},{f3:1000},{f5:-1}]) assert.equal(api.normalizeQuote({...raw,...extra},now),null);
});
test('100 instruments use two upstream calls, filter unsolicited rows',async()=>{
    let calls=0;
    const fetcher=async url=>{calls++;assert.ok(new URL(url).searchParams.get('secids').split(',').length<=50);return Response.json({rc:0,data:{diff:[{f12:'999999',f13:0,f2:11,f18:10,f3:10,f5:10,f6:11000,f124:now/1000}]}});};
    assert.deepEqual(await api.fetchMonitorQuotes(Array.from({length:100},(_,i)=>({symbol:String(i).padStart(6,'0'),market:'SZ'})),now,fetcher),[]);
    assert.equal(calls,2);
});
test('scheduler lease excludes overlap and expired owners cannot persist events',async()=>{
    const {db,sqlite}=database();insertRule(sqlite);
    const repo=new api.MonitorRepository(db);
    assert.equal(await repo.acquire('first',now),true);
    assert.equal(await repo.acquire('second',now),false);
    await repo.release('second');
    assert.equal(await repo.acquire('second',now),false);
    await assert.rejects(repo.save('second',[quote],[api.evaluateRule(rule,quote,now)],now));
    assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM monitor_events').get().c,0);
    await repo.save('first',[quote],[api.evaluateRule(rule,quote,now)],now);
    await repo.save('first',[quote],[api.evaluateRule(rule,quote,now)],now);
    assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM monitor_events').get().c,1);
    assert.equal(sqlite.prepare('SELECT daily_count FROM monitor_rules').get().daily_count,1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM monitor_quotes').get().c,1);
    sqlite.close();
});
test('state and outbox roll back together on a persistence failure',async()=>{
    const {db,sqlite}=database();insertRule(sqlite);
    const repo=new api.MonitorRepository(db);await repo.acquire('owner',now);
    sqlite.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON monitor_events BEGIN SELECT RAISE(ABORT,'test failure'); END");
    await assert.rejects(repo.save('owner',[quote],[api.evaluateRule(rule,quote,now)],now));
    assert.equal(sqlite.prepare('SELECT previous_time FROM monitor_rules').get().previous_time,null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM monitor_quotes').get().c,0);
    sqlite.close();
});
test('outbox claims are exclusive and failed deliveries retry with stable event IDs',async()=>{
    const {db,sqlite}=database();insertRule(sqlite);
    const repo=new api.MonitorRepository(db);await repo.acquire('owner',now);
    await repo.save('owner',[quote],[api.evaluateRule(rule,quote,now)],now);
    const env={DB:db,MONITOR_WEBHOOK_URL:'https://hooks.company.com/notify',MONITOR_WEBHOOK_TOKEN:'secret'};
    let calls=0;
    await api.deliverEvents(env,now,async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers['Idempotency-Key'],`${rule.id}:${now}`);return new Response('',{status:503});});
    let row=sqlite.prepare('SELECT * FROM monitor_events').get();assert.equal(row.status,'pending');assert.equal(row.attempts,1);assert.equal(row.last_error,'Webhook HTTP 503');
    await api.deliverEvents(env,now,async()=>{throw new Error('should not be called');});
    assert.equal(calls,1);
    const due=row.next_attempt_at;
    const claimed=await repo.claimEvents('delivery',due);assert.equal(claimed.length,1);
    assert.equal((await repo.claimEvents('other',due)).length,0);
    await repo.completeEvent(row.id,'other',2,due,200,null);
    assert.equal(sqlite.prepare('SELECT status FROM monitor_events').get().status,'sending');
    await repo.completeEvent(row.id,'delivery',2,due,200,null);
    assert.equal(sqlite.prepare('SELECT status FROM monitor_events').get().status,'sent');
    sqlite.close();
});
test('webhook blocks local hosts, IPs, credentials, non-TLS and special ports',()=>{
    for(const url of ['http://hooks.company.com','https://localhost','https://127.0.0.1','https://[::1]','https://foo.internal','https://foo.nip.io','https://u:p@hooks.company.com','https://hooks.company.com:8443']) assert.throws(()=>api.validateWebhookUrl(url));
    assert.equal(api.validateWebhookUrl('https://hooks.company.com/path').hostname,'hooks.company.com');
});
test('management API requires admin auth, validates input and supports ETF rule CRUD',async()=>{
    const {db,sqlite}=database();const token='a'.repeat(64);const env={DB:db,ADMIN_PASSWORD:'normal-password'};
    sqlite.prepare('INSERT INTO admin_sessions(token_hash,credential_hash,expires_at) VALUES(?,?,?)').run(await api.digest(token),await api.adminCredentialHash(env.ADMIN_PASSWORD,token),Date.now()+3600000);
    const request=(path,method='GET',body)=>new Request('https://worker.test/api/monitor/'+path,{method,headers:{Cookie:'__Host-stockwatch_admin='+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await api.MonitorController.handle(new Request('https://worker.test/api/monitor/rules'),env)).status,401);
    assert.equal((await api.MonitorController.handle(request('instruments','POST',{symbol:'159915',market:'SH',kind:'etf'}),env)).status,400);
    const result=await api.MonitorController.handle(request('rules','POST',{symbol:'159915',market:'SZ',metric:'price',operator:'cross_above',threshold:2}),env);
    assert.equal(result.status,201);const id=(await result.json()).data.id;
    assert.equal((await api.MonitorController.handle(request('rules/'+id,'PUT',{enabled:false}),env)).status,200);
    assert.equal(sqlite.prepare('SELECT enabled FROM monitor_rules').get().enabled,0);
    assert.equal((await api.MonitorController.handle(request('instruments/SZ/159915','DELETE'),env)).status,200);
    assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM monitor_rules').get().c,0);
    sqlite.close();
});
test('Cron orchestration collects real-provider-shaped data, persists and delivers once',async()=>{
    const {db,sqlite}=database();insertRule(sqlite);
    const original=globalThis.fetch;let deliveries=0;let quoteRequests=0;
    globalThis.fetch=async(url,options)=>{
        if(String(url).includes('timor.tech')) return Response.json({code:0,holiday:null});
        if(String(url).includes('eastmoney.com')) {
            quoteRequests++;
            return Response.json({rc:0,data:{diff:[{f12:'159915',f13:0,f14:'ETF',f2:11,f18:10,f3:10,f5:10,f6:11000,f124:now/1000}]}});
        }
        deliveries++;
        assert.equal(JSON.parse(options.body).symbol,'159915');
        return new Response(null,{status:204});
    };
    try {
        const env={DB:db,MONITOR_ENABLED:'true',MONITOR_WEBHOOK_URL:'https://hooks.company.com/notify'};
        await api.runMonitor({...env,MONITOR_ENABLED:'false'},now);
        assert.equal(quoteRequests,0);
        await api.runMonitor(env,now);
        await api.runMonitor(env,now);
        assert.equal(quoteRequests,2);assert.equal(deliveries,1);
        assert.equal(sqlite.prepare('SELECT status FROM monitor_events').get().status,'sent');
        assert.equal(sqlite.prepare('SELECT daily_count FROM monitor_rules').get().daily_count,1);
        assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM monitor_runs').get().c,2);
    } finally {globalThis.fetch=original;sqlite.close();}
});
test('ETF and 301 market mapping, serialized throttle and KV minimum TTL',async()=>{
    assert.equal(api.getStockIdentity('159915').eastmoneyId,0);
    assert.equal(api.getStockIdentity('510300').market,'sh');
    assert.equal(api.getStockIdentity('301269').eastmoneyId,0);
    const limiter=api.createThrottler(20);const times=[];
    await Promise.all(Array.from({length:4},async()=>{await limiter.throttle();times.push(Date.now());}));
    assert.ok(times[3]-times[0]>=50);
    let ttl;await new api.CacheService({put:async(k,v,o)=>{ttl=o.expirationTtl;}},{}).put('key',{},30);
    assert.equal(ttl,60);
});
