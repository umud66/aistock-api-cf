import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deployWithMigrations,boundDatabase,deploymentContext,isDryRun,migrationConfig } from '../scripts/deployment.mjs';

const version='10000000-0000-4000-8000-000000000001';
const db='20000000-0000-4000-8000-000000000001';
function runner({failMigration=false,bindings=[{type:'d1',name:'DB',id:db}]}={}) {
    const calls=[];
    const run=async(args,options)=>{
        calls.push({args,options});
        if(args[0]==='whoami')return 'Authenticated';
        if(args[0]==='deployments')return JSON.stringify({versions:[{version_id:version,percentage:100}]});
        if(args[0]==='versions')return JSON.stringify({resources:{bindings}});
        if(args[0]==='d1'&&failMigration)throw new Error('migration failed');
        return '';
    };
    return {run,calls};
}
test('deployment preflight, binding discovery, migration and publication run in order',async()=>{
    const {run,calls}=runner();let written;
    await deployWithMigrations(['deploy','--env','staging','--name','my-worker'],run,{log:()=>{},writeConfig:async id=>{written=id;return '.tmp/config.json';}});
    assert.equal(written,db);
    assert.deepEqual(calls.map(c=>c.args[0]),['deploy','whoami','deployments','versions','d1','deploy']);
    assert.ok(calls[0].args.includes('--dry-run'));
    assert.ok(calls[2].args.includes('staging'));assert.ok(calls[2].args.includes('my-worker'));
    assert.deepEqual(calls[4].args,['d1','migrations','apply','DB','--remote','--config','.tmp/config.json']);
    assert.equal(calls[4].options.nonInteractive,true);
});
test('migration failure aborts without publishing a live Worker',async()=>{
    const {run,calls}=runner({failMigration:true});
    await assert.rejects(deployWithMigrations(['deploy'],run,{log:()=>{},writeConfig:async()=>'.tmp/config.json'}),/migration failed/);
    assert.equal(calls.filter(c=>c.args[0]==='deploy'&&!c.args.includes('--dry-run')).length,0);
});
test('Workers Builds publishes without management API discovery or D1 API access',async()=>{
    const calls=[];
    await deployWithMigrations(['deploy'],async args=>{calls.push(args);}, {
        environment:{WORKERS_CI:'1'},log:()=>{},
        writeConfig:()=>{throw new Error('Builds must not write a remote migration config');},
    });
    assert.deepEqual(calls,[['deploy']]);
});
test('dry run never discovers resources, authenticates, migrates or writes configuration',async()=>{
    for(const flag of ['--dry-run','--dry-run=true']){
        const {run,calls}=runner();
        await deployWithMigrations(['deploy',flag],run,{writeConfig:()=>{throw new Error('must not write');}});
        assert.deepEqual(calls.map(c=>c.args),[['deploy',flag]]);
    }
    assert.equal(isDryRun(['deploy','--dry-run=false']),false);
    assert.equal(isDryRun(['deploy','--dry-run','false']),false);
    assert.equal(isDryRun(['deploy','--dry-run','--dry-run=false']),false);
    assert.equal(isDryRun(['deploy','--dry-run','--no-dry-run']),false);
    assert.equal(isDryRun(['deploy','--dry-run=false','--dry-run']),true);
});
test('missing DB binding fails closed instead of guessing another database',async()=>{
    const {run,calls}=runner({bindings:[{name:'OTHER_DB',type:'d1',id:db}]});
    await assert.rejects(deployWithMigrations(['deploy'],run,{log:()=>{},writeConfig:()=>{throw new Error('must not write');}}),/名为 DB/);
    assert.ok(!calls.some(c=>c.args[0]==='d1'));
});
test('conflicting databases in an active rollout are rejected',async()=>{
    const run=async args=>args[0]==='deployments'
        ? JSON.stringify({versions:[{version_id:version,percentage:50},{version_id:'10000000-0000-4000-8000-000000000002',percentage:50}]})
        : JSON.stringify({resources:{bindings:[{name:'DB',type:'d1',id:args[2]===version?db:'20000000-0000-4000-8000-000000000002'}]}});
    // args[2] is the version id after `versions view`.
    await assert.rejects(boundDatabase(['deploy'],run),/不同数据库/);
});
test('temporary migration config contains no runtime variable values and stays in project',async()=>{
    const path=await migrationConfig(db);
    assert.ok(path.startsWith(process.cwd()+'/.tmp/'));
    const config=JSON.parse(readFileSync(path,'utf8'));
    assert.equal(config.d1_databases[0].database_id,db);
    assert.equal(config.d1_databases[0].migrations_table,'stockwatch_schema_migrations');
    assert.equal(config.vars,undefined);
});
test('target flags retain their values and cross-project deployment is rejected',()=>{
    assert.deepEqual(deploymentContext(['deploy','--config=a=b.toml','-e','staging','--name=worker']),{global:['--config','a=b.toml','-e','staging'],target:['--name','worker']});
    assert.throws(()=>deploymentContext(['deploy','--cwd','../other']),/不支持/);
});
