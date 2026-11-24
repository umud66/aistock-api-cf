import {getStockIdentity} from '../utils/stock';
import {eastmoneyThrottler} from '../utils/throttlers';
import type {FundFlow,FlowDay} from './types';

export function numeric(value:unknown):number|null {
    if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()===''||value==='-')return null;
    const n=Number(value);return Number.isFinite(n)?n:null;
}
const headers={'Referer':'https://quote.eastmoney.com/','User-Agent':'Mozilla/5.0','Accept':'application/json'};
async function read(url:URL):Promise<any> {
    await eastmoneyThrottler.throttle();
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw new Error('资金数据源暂不可用');
    const body:any=await response.json();if(body.rc!==0||!body.data)throw new Error('数据源未提供此证券的资金数据');
    return body.data;
}
export function parseFlowRows(rows:unknown):FlowDay[] {
    if(!Array.isArray(rows))return [];
    const days=new Map<string,FlowDay>();
    for(const line of rows){
        if(typeof line!=='string')continue;
        const p=line.split(',');if(!/^\d{4}-\d{2}-\d{2}$/.test(p[0])||p.length<6)continue;
        const row={date:p[0],main:numeric(p[1]),small:numeric(p[2]),medium:numeric(p[3]),large:numeric(p[4]),superLarge:numeric(p[5])};
        if(Object.values(row).slice(1).some(value=>value!==null))days.set(row.date,row);
    }
    return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-20);
}
export async function fetchFundFlow(symbol:string):Promise<FundFlow> {
    const secid=`${getStockIdentity(symbol).eastmoneyId}.${symbol}`;
    const current=new URL('https://push2.eastmoney.com/api/qt/stock/get');
    current.search=new URLSearchParams({secid,invt:'2',fltt:'2',fields:'f57,f86,f135,f136,f137,f138,f139,f140,f141,f142,f143,f144,f145,f146,f147,f148,f149'}).toString();
    const daily=new URL('https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get');
    daily.search=new URLSearchParams({secid,lmt:'20',klt:'101',fields1:'f1,f2,f3,f7',fields2:'f51,f52,f53,f54,f55,f56'}).toString();
    const [live,history]=await Promise.allSettled([read(current),read(daily).catch(()=>{
        const fallback=new URL(daily);fallback.hostname='push2.eastmoney.com';fallback.pathname='/api/qt/stock/fflow/kline/get';return read(fallback);
    })]);
    const warnings:string[]=[];
    const data=live.status==='fulfilled'?live.value:null;
    if(data?.f57 && String(data.f57)!==symbol)throw new Error('资金数据证券代码不匹配');
    if(history.status==='fulfilled'&&history.value.code&&String(history.value.code)!==symbol)throw new Error('资金历史证券代码不匹配');
    const categories=[['主力',135],['超大单',138],['大单',141],['中单',144],['小单',147]].map(([name,field])=>{
        const f=Number(field);return {name:String(name),inflow:numeric(data?.['f'+f]),outflow:numeric(data?.['f'+(f+1)]),net:numeric(data?.['f'+(f+2)])};
    });
    const days=history.status==='fulfilled'?parseFlowRows(history.value.klines):[];
    if(!categories.some(c=>c.net!==null))warnings.push('暂无当日资金拆分；部分 ETF 或证券不提供此数据。');
    if(!days.length)warnings.push('暂无资金历史数据。');
    const timestamp=numeric(data?.f86);
    return {asOf:timestamp&&timestamp>0?new Date(timestamp*1000).toISOString():null,categories,history:days,warnings};
}
