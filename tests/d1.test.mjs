import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('Workers D1 executes monitoring batch atomically with JSON and UPDATE FROM',async()=>{
    const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-01-08'});
    try {
        const db=await mf.getD1Database('DB');
        const schema=readFileSync('scripts/monitoring.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean);
        for(let i=0;i<2;i++) await db.batch(schema.map(sql=>db.prepare(sql)));
        const compiled=await build({entryPoints:['src/monitoring/MonitorRepository.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
        const {MonitorRepository}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
        const repo=new MonitorRepository(db), now=Date.now();
        await db.prepare("INSERT INTO monitor_instruments(symbol,market,kind) VALUES('510300','SH','etf')").run();
        await db.prepare("INSERT INTO monitor_rules(id,symbol,market,metric,operator,threshold) VALUES('rule','510300','SH','price','above',1)").run();
        assert.equal(await repo.acquire('owner',now),true);
        assert.equal(await repo.acquire('other',now),false);
        const state={id:'rule',previous_value:4,previous_time:now,last_triggered_at:now,count_day:'2026-11-23',daily_count:1,enabled:1,event:{id:'event',rule_id:'rule',payload:'{}',created_at:now}};
        await repo.save('owner',[{symbol:'510300',market:'SH'}],[state],now);
        assert.equal((await db.prepare('SELECT daily_count FROM monitor_rules').first()).daily_count,1);
        assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM monitor_events').first()).count,1);
        assert.equal((await repo.claimEvents('sender',now)).length,1);
        assert.equal((await repo.claimEvents('other',now)).length,0);
        await repo.completeEvent('event','sender',1,now,200,null);
        assert.equal((await db.prepare('SELECT status FROM monitor_events').first()).status,'sent');
        await repo.release('owner');
    } finally {await mf.dispose();}
});
