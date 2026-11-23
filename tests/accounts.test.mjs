import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const admin='test-admin-'.repeat(5), pepper='test-pepper-'.repeat(5);
const password='test-only-password-123';
let mf, worker, db, AccountRepository;
before(async()=>{
    const built=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
import {AccountController} from './src/controllers/AccountController';
import {UserController} from './src/controllers/UserController';
import {MonitorController} from './src/controllers/MonitorController';
export default {async fetch(request,env) {
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/auth/')||path.startsWith('/api/admin/')) return AccountController.handle(request,env);
 if(path==='/api/users/me') return UserController.me(request,env);
 if(path==='/api/monitor/status') return MonitorController.handle(request,env);
 return new Response('Not Found',{status:404});
}};`},bundle:true,write:false,format:'esm',platform:'browser'});
    mf=new Miniflare({modules:true,script:built.outputFiles[0].text,d1Databases:['DB'],
        bindings:{MONITOR_ADMIN_TOKEN:admin,AUTH_PASSWORD_PEPPER:pepper},compatibilityDate:'2026-01-08'});
    db=await mf.getD1Database('DB');worker=await mf.getWorker();
    for(const file of ['users-schema.sql','user_settings.sql','accounts.sql','monitoring.sql']) {
        const sql=readFileSync('scripts/'+file,'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
        for(let i=0;i<2;i++) await db.batch(sql.map(s=>db.prepare(s)));
    }
    await db.prepare('CREATE TABLE stocks(symbol TEXT PRIMARY KEY,name TEXT,market TEXT)').run();
    const repo=await build({entryPoints:['src/auth/AccountRepository.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
    ({AccountRepository}=await import(`data:text/javascript;base64,${Buffer.from(repo.outputFiles[0].text).toString('base64')}`));
});
beforeEach(async()=>{
    await db.batch(['DELETE FROM users','DELETE FROM auth_rate_limits',"UPDATE system_settings SET allow_registration=0,updated_at=0"].map(s=>db.prepare(s)));
});
after(async()=>{await mf?.dispose();});
function request(path,method='GET',body,options={}) {
    const headers={'Content-Type':'application/json',...options.headers};
    if(options.admin) headers.Authorization='Bearer '+admin;
    if(options.cookie) headers.Cookie=options.cookie;
    return worker.fetch('https://app.stockwatch.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function allow(value=true) {
    const response=await request('/api/admin/settings','PUT',{allow_registration:value},{admin:true});
    assert.equal(response.status,200);
}
async function create(username='tester') {
    const response=await request('/api/admin/users','POST',{username,password},{admin:true});
    assert.equal(response.status,201);return (await response.json()).data;
}
async function login(username='tester',pass=password) {
    const response=await request('/api/auth/login','POST',{username,password:pass});
    return {response,cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
}

test('registration starts closed; only admin can persist a strictly boolean switch',async()=>{
    const config=await request('/api/auth/config');
    assert.equal(config.headers.get('Cache-Control'),'no-store');
    assert.equal((await config.json()).data.allow_registration,false);
    assert.equal((await request('/api/auth/register','POST',{username:'tester',password})).status,403);
    assert.equal((await request('/api/admin/settings')).status,401);
    assert.equal((await request('/api/admin/settings','PUT',{allow_registration:true})).status,401);
    for(const value of ['true',1,null]) assert.equal((await request('/api/admin/settings','PUT',{allow_registration:value},{admin:true})).status,400);
    await allow();
    assert.equal((await db.prepare('SELECT allow_registration FROM system_settings').first()).allow_registration,1);
    assert.equal((await (await request('/api/auth/config')).json()).data.allow_registration,true);
    assert.equal((await request('/api/admin/settings','POST',{}, {admin:true})).status,405);
});
test('admin can provision while closed; public account can login but never administer',async()=>{
    const user=await create();
    const {response,cookie}=await login();assert.equal(response.status,200);assert.ok(cookie);
    const setCookie=response.headers.get('Set-Cookie');
    for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/']) assert.ok(setCookie.includes(flag));
    const me=await (await request('/api/auth/me','GET',undefined,{cookie})).json();
    assert.equal(me.data.id,user.id);assert.equal(me.data.username,'tester');
    const legacy=await request('/api/users/me','GET',undefined,{cookie});
    assert.equal(legacy.status,200);assert.equal((await legacy.json()).data.id,user.id);
    assert.equal((await request('/api/admin/settings','PUT',{allow_registration:true},{cookie})).status,401);
    assert.equal((await request('/api/monitor/status','GET',undefined,{cookie})).status,401);
    assert.equal((await request('/api/auth/register','POST',{username:'other',password})).status,403);
});
test('password hashes have unique salts and no plaintext; session storage holds only digests',async()=>{
    await create('first');await create('second');
    const rows=(await db.prepare('SELECT password_hash FROM account_credentials ORDER BY username').all()).results;
    assert.notEqual(rows[0].password_hash,rows[1].password_hash);
    assert.ok(rows.every(row=>row.password_hash.startsWith('pbkdf2-sha256:100000:')&&!row.password_hash.includes(password)));
    const {cookie}=await login('first');
    const token=cookie.split('=')[1];
    const session=await db.prepare('SELECT token_hash FROM account_sessions').first();
    assert.notEqual(session.token_hash,token);assert.equal(session.token_hash.length,64);
    assert.equal((await login('first','wrong-password-123')).response.status,401);
    assert.equal((await login('missing','wrong-password-123')).response.status,401);
});
test('registration cannot assign admin or choose an existing identity; duplicate names conflict',async()=>{
    await allow();
    const response=await request('/api/auth/register','POST',{username:'NewUser',password,id:'existing-id',role:'admin',openid:'old-wechat'});
    assert.equal(response.status,201);const user=(await response.json()).data;
    assert.equal(user.username,'newuser');assert.match(user.id,/^[a-f0-9-]{36}$/);
    assert.equal((await request('/api/auth/register','POST',{username:'NEWUSER',password})).status,409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n,1);
    await allow(false);
    assert.equal((await login('newuser')).response.status,200);
});
test('closing registration during hashing is checked again inside the write transaction',async()=>{
    const repository=new AccountRepository(db);
    await repository.setRegistration(true);
    assert.equal((await repository.settings()).allow_registration,true);
    await repository.setRegistration(false);
    assert.equal(await repository.create('raced','test-hash','race',false),null);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM account_credentials').first()).n,0);
});
test('duplicate username rolls back its new user row atomically',async()=>{
    await create();const repository=new AccountRepository(db);
    await assert.rejects(repository.create('tester','test-hash','duplicate',true));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n,1);
});
test('logout revokes the session; expired, forged and legacy JWT cookies fail',async()=>{
    await create();const {cookie}=await login();
    assert.equal((await request('/api/auth/logout','GET',undefined,{cookie})).status,405);
    assert.equal((await request('/api/auth/logout','POST',{}, {cookie})).status,200);
    assert.equal((await request('/api/auth/me','GET',undefined,{cookie})).status,401);
    const active=await login();
    await db.prepare('UPDATE account_sessions SET expires_at=0').run();
    assert.equal((await request('/api/auth/me','GET',undefined,{cookie:active.cookie})).status,401);
    assert.equal((await request('/api/users/me','GET',undefined,{cookie:'token=old.jwt.value'})).status,401);
    assert.equal((await request('/api/auth/me','GET',undefined,{cookie:'__Host-stockwatch_session='+'a'.repeat(64)})).status,401);
});
test('cross-origin writes, malformed JSON and wrong HTTP methods are rejected',async()=>{
    assert.equal((await request('/api/admin/settings','PUT',{allow_registration:true},{admin:true,headers:{Origin:'https://evil.test'}})).status,403);
    assert.equal((await request('/api/auth/login','GET')).status,405);
    await allow();
    for(const input of [{username:'a',password},{username:'tester',password:'short'},{username:'tester',password:'x'.repeat(129)}])
        assert.equal((await request('/api/auth/register','POST',input)).status,400);
    assert.equal((await worker.fetch('https://app.stockwatch.test/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'})).status,400);
    assert.equal((await worker.fetch('https://app.stockwatch.test/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(9000)})).status,413);
    for(const suffix of ['login','callback','push','login/scan','login/scan/poll']) assert.equal((await request('/api/auth/wechat/'+suffix)).status,404);
});
test('login throttles atomically by account even when source IP changes',async()=>{
    await create();
    for(let i=0;i<10;i++) assert.equal((await request('/api/auth/login','POST',{username:'tester',password:'wrong-password-123'},{headers:{'CF-Connecting-IP':`192.0.2.${i}`}})).status,401);
    assert.equal((await request('/api/auth/login','POST',{username:'tester',password},{headers:{'CF-Connecting-IP':'192.0.2.99'}})).status,429);
    await db.prepare('UPDATE auth_rate_limits SET window_start=0').run();
    assert.equal((await login()).response.status,200);
});
