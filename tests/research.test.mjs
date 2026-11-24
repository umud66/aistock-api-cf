import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`
export * from './src/research/MarketService';
export * from './src/research/FundFlowService';
export * from './src/research/AnalysisService';
export * from './src/research/ResearchRepository';
export * from './src/controllers/ResearchController';
export * from './src/services/WorkersAiService';
export * from './src/auth/security';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser'});
const api=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const report={summary:'量价观察',trend:'位于短期均线上方。',volume:'成交量较前五日均值放大。',fundFlow:'主力资金存在净流入，不能据此判断机构意图。',risks:['历史走势不能说明未来收益。'],watchPoints:['留意后续成交量能否持续。']};
const candle=(n)=>({time:`2026-10-${String(n).padStart(2,'0')}`,open:n,close:n,high:n+1,low:n-.5,volume:n*100,amount:n*1000,changePercent:1,turnover:2});
const snapshot={symbol:'600519',market:'SH',name:'隔离测试证券',period:101,adjust:1,fetchedAt:Date.now(),quote:{'股票代码':'600519','最新价':25},candles:Array.from({length:25},(_,i)=>candle(i+1)),fundFlow:{asOf:null,categories:[],history:[],warnings:['暂无资金数据']},indicators:{ma5:23,ma10:20.5,ma20:15.5,volumeRatio5:1.2,change5:25,change20:400},warnings:['暂无资金数据']};
function database(){
    const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of readdirSync('migrations').filter(v=>v.endsWith('.sql')).sort())sqlite.exec(readFileSync('migrations/'+file,'utf8'));
    sqlite.exec("INSERT INTO users(openid) VALUES('a'),('b'); INSERT INTO account_credentials(user_id,username,password_hash,created_at) VALUES('a','first','fixture',0),('b','second','fixture',0)");
    const db={prepare(sql){let values=[];const statement={bind(...args){values=args;return statement;},async first(){return sqlite.prepare(sql).all(...values)[0]??null;},async all(){return {success:true,results:sqlite.prepare(sql).all(...values)};},async run(){return statement.all();}};return statement;}};
    return {db,sqlite};
}
test('missing numbers stay null and valid K lines normalize shares and reject invalid OHLC',()=>{
    for(const value of [null,undefined,'',' ','-',NaN,Infinity])assert.equal(api.numeric(value),null);
    assert.equal(api.numeric('0'),0);
    const row={'时间':'2026-10-01','开盘价':10,'收盘价':11,'最高价':12,'最低价':9,'成交量':123,'成交额':123000};
    const rows=api.normalizeCandles([row,{...row,'时间':'2026-10-02','最高价':5},{...row,'时间':'2026-10-03','成交量':null}]);
    assert.equal(rows.length,2);assert.equal(rows[0].volume,12300);assert.equal(rows[1].volume,null);
});
test('moving averages and volume comparison use the prior five bars without inventing missing values',()=>{
    const rows=Array.from({length:6},(_,i)=>candle(i+1));
    const result=api.marketIndicators(rows);assert.equal(result.ma5,4);assert.equal(result.ma10,null);assert.equal(result.volumeRatio5,2);assert.equal(result.change5,500);
    assert.equal(api.marketIndicators(rows.map((c,i)=>i===0?{...c,volume:null}:c)).volumeRatio5,null);
});
test('fund flow separates small, medium, large and super-large orders and preserves missing fields',()=>{
    const rows=api.parseFlowRows(['2026-10-02,100,-10,-90,40,60','2026-10-01,-,-,-,-,-','invalid,1,2,3,4,5']);
    assert.deepEqual(rows,[{date:'2026-10-02',main:100,small:-10,medium:-90,large:40,superLarge:60}]);
});
test('Workers AI receives server evidence with explicit missing-data constraints and validates the report',async()=>{
    let call;
    const env={AI:{run:async(model,input)=>{call={model,input};return {response:JSON.stringify(report)};}}};
    const analysis=await api.analyzeMarket(env,snapshot);
    assert.equal(call.model,api.DEFAULT_AI_MODEL);assert.equal(call.input.response_format.type,'json_object');assert.ok(call.input.messages[1].content.includes('暂无资金数据'));
    assert.deepEqual(analysis.report,report);assert.equal(analysis.symbol,'600519');assert.equal(analysis.evidence.period,101);
    assert.throws(()=>api.parseResearchReport('{}'),/不完整/);
    assert.throws(()=>api.parseResearchReport(JSON.stringify({...report,risks:[]})),/不完整/);
    await assert.rejects(api.analyzeMarket(env,{...snapshot,candles:[]}),/不足/);
    await assert.rejects(api.generateAiText({},'system','prompt'),/AI.*绑定/);
});
test('analysis records and generation locks are isolated by account',async()=>{
    const {db,sqlite}=database();
    try{
        const a=new api.ResearchRepository(db,'a'),b=new api.ResearchRepository(db,'b');
        assert.equal(await a.acquire('600519','first'),true);assert.equal(await a.acquire('600519','second'),false);assert.equal(await b.acquire('600519','other'),true);
        const analysis={symbol:'600519',model:api.DEFAULT_AI_MODEL,createdAt:Date.now(),report,evidence:snapshot};
        await assert.rejects(a.save(analysis,'wrong'),/租约/);await a.save(analysis,'first');
        assert.deepEqual((await a.latest('600519')).report,report);assert.equal(await b.latest('600519'),null);
        await a.release('600519','wrong');assert.equal(await a.acquire('600519','third'),false);
        await a.release('600519','first');assert.equal(await a.acquire('600519','third'),true);
    }finally{sqlite.close();}
});
test('research API requires user auth, uses server snapshots, caches per account and handles missing AI',async()=>{
    const {db,sqlite}=database();let calls=0;
    const tokens={a:'a'.repeat(64),b:'b'.repeat(64)};
    for(const [user,token]of Object.entries(tokens))sqlite.prepare('INSERT INTO account_sessions VALUES(?,?,?)').run(await api.digest(token),user,Date.now()+3600000);
    const env={DB:db,KV:{get:async key=>key.startsWith('stockwatch:research:')?snapshot:null},AI:{run:async()=>{calls++;return {response:JSON.stringify(report)};}}};
    const request=(user,path='analysis',method='GET',environment=env,headers={})=>api.ResearchController.handle(new Request('https://worker.test/api/research/600519/'+path,{method,headers:{Cookie:user?'__Host-stockwatch_session='+tokens[user]:'','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify({user_id:'b',evidence:'forged',symbol:'000001'})}:{})}),environment);
    try{
        assert.equal((await request(null)).status,401);
        assert.equal((await request(null,'analysis','POST',env,{Cookie:'__Host-stockwatch_admin='+'c'.repeat(64)})).status,401);
        assert.equal((await request('a','analysis','POST',{...env,AI:undefined})).status,503);
        assert.equal((await request('a','snapshot?period=999')).status,400);
        const first=await request('a','analysis','POST');assert.equal(first.status,200);assert.equal(first.headers.get('Cache-Control'),'no-store');
        assert.equal((await first.json()).data.analysis.symbol,'600519');
        assert.equal((await (await request('a','analysis','POST')).json()).data.cached,true);assert.equal(calls,1);
        assert.equal((await (await request('b')).json()).data.analysis,null);
        assert.equal((await request('b','analysis','POST')).status,200);assert.equal(calls,2);
        assert.equal((await request('a','analysis','POST',env,{Origin:'https://evil.test'})).status,401);
        assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM user_analysis_locks').get().n,0);
    }finally{sqlite.close();}
});
test('market aggregation requests genuine upstream shapes and preserves units and source timestamps',async()=>{
    const original=globalThis.fetch;const paths=[];
    globalThis.fetch=async address=>{
        const url=new URL(address);paths.push(url.pathname);
        if(url.pathname.includes('/fflow/'))return Response.json({rc:0,data:{code:'600519',klines:['2026-10-25,100,-10,-90,40,60']}});
        if(url.pathname.includes('/kline/'))return Response.json({rc:0,data:{klines:['2026-10-25,10,11,12,9,123,123000,3,2,1,5']}});
        return Response.json({rc:0,data:{f57:'600519',f58:'隔离测试证券',f43:11,f47:123,f48:123000,f86:Math.floor(Date.now()/1000),f135:1000,f136:900,f137:100}});
    };
    try{
        const result=await api.marketSnapshot('600519',101,1);
        assert.equal(result.candles[0].volume,12300);assert.equal(result.quote['成交量'],12300);
        assert.equal(result.fundFlow.categories[0].inflow,1000);assert.equal(result.fundFlow.categories[0].net,100);
        assert.equal(result.fundFlow.categories[1].net,null);assert.equal(result.fundFlow.history[0].main,100);
        assert.ok(paths.some(path=>path.includes('fflow/daykline')));
    }finally{globalThis.fetch=original;}
});
