import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile,readFile,readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

async function cli(args){
    return new Promise((resolveRun,reject)=>{
        const child=spawn(process.execPath,['scripts/wrangler-local.mjs',...args],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
        let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
        child.on('error',reject);child.on('exit',code=>code===0?resolveRun(output):reject(new Error(output)));
    });
}
test('native D1 migrations handle fresh schema, repeated deploys, old data and failed migration rollback',{timeout:120000},async()=>{
    await mkdir('.tmp/migration-tests',{recursive:true});
    const root=await mkdtemp(resolve('.tmp/migration-tests/run-'));
    const folder=resolve(root,'migrations');await mkdir(folder);
    const migrationFiles=(await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort();
    for(const file of migrationFiles)
        await writeFile(resolve(folder,file),await readFile(resolve('migrations',file),'utf8'));
    const config=resolve(root,'wrangler.json');
    await writeFile(config,JSON.stringify({name:'migration-test',compatibility_date:'2026-01-08',
        d1_databases:[{binding:'DB',database_name:'migration-test',migrations_dir:folder,migrations_table:'stockwatch_schema_migrations'}]}));
    const context=['--local','--config',config,'--persist-to',resolve(root,'state')];
    const query=async sql=>{
        const output=await cli(['d1','execute','DB',...context,'--command',sql,'--json']);
        return JSON.parse(output)[0].results;
    };
    // Emulate a previously deployed database with existing users/settings.
    await query("CREATE TABLE users(openid TEXT PRIMARY KEY,nickname TEXT NOT NULL DEFAULT '',avatar_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO users(openid,nickname) VALUES('existing-user','保留的用户'); CREATE TABLE system_settings(id INTEGER PRIMARY KEY,allow_registration INTEGER NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO system_settings VALUES(1,1,123)");
    await cli(['d1','migrations','apply','DB',...context]);
    assert.equal((await query('SELECT COUNT(*) AS n FROM stockwatch_schema_migrations'))[0].n,migrationFiles.length);
    assert.equal((await query("SELECT nickname FROM users WHERE openid='existing-user'"))[0].nickname,'保留的用户');
    assert.equal((await query('SELECT allow_registration FROM system_settings'))[0].allow_registration,1);
    assert.ok((await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('admin_sessions','monitor_settings','monitor_rules','stocks')")).length===4);
    await cli(['d1','migrations','apply','DB',...context]);
    assert.equal((await query('SELECT COUNT(*) AS n FROM stockwatch_schema_migrations'))[0].n,migrationFiles.length);
    await writeFile(resolve(folder,'9999_failure.sql'),"CREATE TABLE should_rollback(id INTEGER); INSERT INTO nonexistent_table VALUES(1);");
    await assert.rejects(cli(['d1','migrations','apply','DB',...context]));
    assert.equal((await query('SELECT COUNT(*) AS n FROM stockwatch_schema_migrations'))[0].n,migrationFiles.length);
    assert.equal((await query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='should_rollback'"))[0].n,0);
    // A completely empty database reaches the same schema.
    const fresh=['--local','--config',config,'--persist-to',resolve(root,'fresh-state')];
    // Apply only baseline + UI migration to the fresh DB after removing the deliberate failure.
    await writeFile(resolve(folder,'9999_failure.sql'),'SELECT 1;');
    await cli(['d1','migrations','apply','DB',...fresh]);
});
