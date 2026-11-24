export interface Candle {
    time:string;open:number;close:number;high:number;low:number;
    volume:number|null;amount:number|null;changePercent:number|null;turnover:number|null;
}
export interface FlowDay {date:string;main:number|null;small:number|null;medium:number|null;large:number|null;superLarge:number|null}
export interface FlowCategory {name:string;inflow:number|null;outflow:number|null;net:number|null}
export interface FundFlow {asOf:string|null;categories:FlowCategory[];history:FlowDay[];warnings:string[]}
export interface MarketSnapshot {
    symbol:string;market:string;name:string;period:number;adjust:number;fetchedAt:number;
    quote:Record<string,unknown>|null;candles:Candle[];fundFlow:FundFlow;
    indicators:{ma5:number|null;ma10:number|null;ma20:number|null;volumeRatio5:number|null;change5:number|null;change20:number|null};
    warnings:string[];
}
export interface ResearchReport {summary:string;trend:string;volume:string;fundFlow:string;risks:string[];watchPoints:string[]}
export interface ResearchAnalysis {symbol:string;model:string;createdAt:number;report:ResearchReport;evidence:MarketSnapshot}
