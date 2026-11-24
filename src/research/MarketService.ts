import {EmKlineService,type KLinePeriod,type KLineFqt} from '../services/EmKlineService';
import {EmQuoteService} from '../services/EmQuoteService';
import {fetchFundFlow,numeric} from './FundFlowService';
import {getStockIdentity} from '../utils/stock';
import type {Candle,MarketSnapshot} from './types';

export function normalizeCandles(rows:Record<string,unknown>[]):Candle[] {
    const sorted=new Map<string,Candle>();
    for(const row of rows){
        const time=String(row['时间']??''),open=numeric(row['开盘价']),close=numeric(row['收盘价']),high=numeric(row['最高价']),low=numeric(row['最低价']);
        if(!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(time)||open===null||close===null||high===null||low===null||low<=0||high<Math.max(open,close)||low>Math.min(open,close))continue;
        const volume=numeric(row['成交量']),amount=numeric(row['成交额']);
        sorted.set(time,{time,open,close,high,low,volume:volume!==null&&volume>=0?volume*100:null,amount:amount!==null&&amount>=0?amount:null,changePercent:numeric(row['涨跌幅']),turnover:numeric(row['换手率'])});
    }
    return [...sorted.values()].sort((a,b)=>a.time.localeCompare(b.time)).slice(-240);
}
export function marketIndicators(candles:Candle[]):MarketSnapshot['indicators'] {
    const average=(count:number)=>candles.length<count?null:candles.slice(-count).reduce((sum,c)=>sum+c.close,0)/count;
    const change=(count:number)=>candles.length<=count?null:(candles.at(-1)!.close/candles.at(-count-1)!.close-1)*100;
    const previous=candles.slice(-6,-1),volume=candles.at(-1)?.volume;
    const sum=previous.reduce((total,c)=>total+(c.volume??0),0);
    return {ma5:average(5),ma10:average(10),ma20:average(20),volumeRatio5:previous.length===5&&previous.every(c=>c.volume!==null)&&sum>0&&volume!=null?volume/(sum/5):null,change5:change(5),change20:change(20)};
}

export async function marketSnapshot(symbol:string,period:KLinePeriod=101,adjust:KLineFqt=1,kv?:KVNamespace):Promise<MarketSnapshot> {
    const cacheKey=`stockwatch:research:v1:${symbol}:${period}:${adjust}`;
    if(kv){try{const cached=await kv.get<MarketSnapshot>(cacheKey,'json');if(cached&&Date.now()-cached.fetchedAt<60_000)return cached;}catch{/* Public cache is optional. */}}
    const [bars,quote,flow]=await Promise.allSettled([
        EmKlineService.getKLine({symbol,klt:period,fqt:adjust,limit:240}),
        EmQuoteService.getQuote(symbol,'activity'),fetchFundFlow(symbol),
    ]);
    const warnings:string[]=[];
    const candles=bars.status==='fulfilled'?normalizeCandles(bars.value):[];
    if(!candles.length)warnings.push('暂未取得有效 K 线，请更换周期或稍后刷新。');
    const current=quote.status==='fulfilled'?quote.value:null;
    if(current?.['股票代码']&&current['股票代码']!==symbol)throw new Error('行情数据证券代码不匹配');
    if(!current)warnings.push('实时行情暂不可用，图表仅展示历史数据。');
    const fundFlow=flow.status==='fulfilled'?flow.value:{asOf:null,categories:[],history:[],warnings:['资金数据源暂不可用。']};
    warnings.push(...fundFlow.warnings);
    if(!candles.length&&!current&&!fundFlow.history.length)throw new Error('行情数据源暂不可用，请稍后刷新');
    const result:MarketSnapshot={symbol,market:getStockIdentity(symbol).market.toUpperCase(),name:String(current?.['股票简称']||symbol),period,adjust,fetchedAt:Date.now(),quote:current,candles,fundFlow,indicators:marketIndicators(candles),warnings};
    if(kv&&candles.length&&current){try{await kv.put(cacheKey,JSON.stringify(result),{expirationTtl:60});}catch{/* Public cache is optional. */}}
    return result;
}
