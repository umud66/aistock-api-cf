<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import CandleChart from './CandleChart.vue';
import Icon from './Icon.vue';
import {api} from '../api';
import type {Instrument} from '../types';
import type {MarketSnapshot,ResearchAnalysis} from '../../src/research/types';
const props=defineProps<{initialSymbol?:string;choices:Instrument[]}>();
const emit=defineEmits<{selected:[symbol:string]}>();
const input=ref(''),symbol=ref(''),period=ref(101),adjust=ref(1);
const snapshot=ref<MarketSnapshot|null>(null),analysis=ref<ResearchAnalysis|null>(null);
const loading=ref(false),analyzing=ref(false),error=ref(''),aiError=ref(''),message=ref(''),aiAvailable=ref(false);
let sequence=0,alive=true;
const periods=[{value:101,name:'日线'},{value:102,name:'周线'},{value:103,name:'月线'},{value:5,name:'5 分钟'},{value:15,name:'15 分钟'},{value:30,name:'30 分钟'},{value:60,name:'60 分钟'}];
const latestFlow=computed(()=>snapshot.value?.fundFlow.history.at(-1));
const mainFlow=computed(()=>snapshot.value?.fundFlow.categories.find(c=>c.name==='主力'));
const flowScale=computed(()=>Math.max(1,...(snapshot.value?.fundFlow.history.map(d=>Math.abs(d.main??0))||[])));
const staleReport=computed(()=>!!analysis.value&&Date.now()-analysis.value.createdAt>300_000);
function format(value:unknown,digits=2){if(typeof value!=='number'||!Number.isFinite(value))return '—';return value.toLocaleString('zh-CN',{maximumFractionDigits:digits});}
function compact(value:unknown){if(typeof value!=='number'||!Number.isFinite(value))return '—';const abs=Math.abs(value);return abs>=1e8?format(value/1e8)+' 亿':abs>=1e4?format(value/1e4)+' 万':format(value);}
function changeColor(value:unknown){return typeof value==='number'?(value>0?'rise':value<0?'fall':''):'';}
function date(value:number|string|null|undefined){if(!value)return '—';return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}
function select(value:string){if(!/^\d{6}$/.test(value)){error.value='请输入六位股票或场内 ETF 代码。';return;}input.value=value;if(symbol.value===value){void refresh();return;}symbol.value=value;emit('selected',value);void load(true);}
async function load(changed=false){
    if(!symbol.value)return;
    const request=++sequence;loading.value=true;error.value='';aiError.value='';message.value='';snapshot.value=null;if(changed)analysis.value=null;
    const [market,report]=await Promise.allSettled([
        api<{snapshot:MarketSnapshot;aiAvailable:boolean}>(`/api/research/${symbol.value}/snapshot?period=${period.value}&adjust=${period.value<100?0:adjust.value}`),
        api<{analysis:ResearchAnalysis|null}>(`/api/research/${symbol.value}/analysis`),
    ]);
    if(!alive||sequence!==request)return;
    if(market.status==='fulfilled'){snapshot.value=market.value.snapshot;aiAvailable.value=market.value.aiAvailable;}else error.value=market.reason instanceof Error?market.reason.message:'行情加载失败，请重试。';
    if(report.status==='fulfilled')analysis.value=report.value.analysis;else aiError.value='暂未能读取历史分析，可以稍后刷新。';
    loading.value=false;
}
async function refresh(){await load();}
async function generate(){
    analyzing.value=true;aiError.value='';message.value='';const target=symbol.value;
    try{const data=await api<{analysis:ResearchAnalysis;cached:boolean}>(`/api/research/${target}/analysis`,'POST',{},100_000);
        if(alive&&target===symbol.value){analysis.value=data.analysis;message.value=data.cached?'已显示 5 分钟内生成的报告。':'分析已生成并保存到你的账号。';}
    }catch(e){if(alive)aiError.value=e instanceof Error?e.message:'分析生成失败，请重试。';}finally{if(alive)analyzing.value=false;}
}
watch(()=>props.initialSymbol,value=>{if(value&&value!==symbol.value)select(value);},{immediate:true});
watch([period,adjust],()=>void load());
onBeforeUnmount(()=>{alive=false;sequence++;});
defineExpose({refresh});
</script>
<template>
  <div class="research-workspace">
    <form class="toolbar research-search" @submit.prevent="select(input.trim())"><label class="search-box"><Icon name="search" :size="18"/><input v-model="input" aria-label="研究证券代码" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="输入六位代码，例如 600519" :disabled="analyzing"/></label><button class="button primary" type="submit" :disabled="loading||analyzing">查看行情</button><select v-if="choices.length" aria-label="从监控标的选择" :disabled="analyzing" :value="symbol" @change="select(($event.target as HTMLSelectElement).value)"><option value="" disabled>从我的监控选择</option><option v-for="item in choices" :key="item.market+item.symbol" :value="item.symbol">{{item.name||item.symbol}} · {{item.symbol}}</option></select></form>
    <div v-if="error" class="notice danger" role="alert"><Icon name="alert"/><span>{{error}}</span><button v-if="symbol" class="text-button" :disabled="loading" @click="refresh">重新加载</button></div>
    <div v-if="loading" class="loading-state" aria-busy="true"><p>正在读取 K 线、成交量与资金数据…</p><div v-for="n in 3" :key="n" class="skeleton-line"></div></div>
    <section v-else-if="!symbol" class="panel empty-state"><span class="empty-icon"><Icon name="chart" :size="28"/></span><h2>从一只证券开始研究</h2><p>输入股票或场内 ETF 代码，查看价格、成交量、资金流向，再生成 AI 分析。</p></section>
    <template v-if="snapshot&&!loading">
      <section class="panel research-quote"><div class="research-security"><div><h2>{{snapshot.name}} <span class="muted">{{snapshot.market}} {{snapshot.symbol}}</span></h2><p class="muted small">东方财富 · 行情时间 {{snapshot.quote?.['更新时间']||'暂无实时快照'}} · 读取于 {{date(snapshot.fetchedAt)}}</p></div><div :class="['research-price',changeColor(snapshot.quote?.['涨跌幅'])]"><strong>{{format(snapshot.quote?.['最新价'],3)}}</strong><span>{{format(snapshot.quote?.['涨跌幅'])}}%</span></div></div><dl class="research-facts"><div><dt>今开</dt><dd>{{format(snapshot.quote?.['今开价'],3)}}</dd></div><div><dt>最高 / 最低</dt><dd>{{format(snapshot.quote?.['最高价'],3)}} / {{format(snapshot.quote?.['最低价'],3)}}</dd></div><div><dt>成交量 / 股</dt><dd>{{compact(snapshot.quote?.['成交量'])}}</dd></div><div><dt>成交额 / 元</dt><dd>{{compact(snapshot.quote?.['成交额'])}}</dd></div><div><dt>换手率</dt><dd>{{format(snapshot.quote?.['换手率'])}}%</dd></div><div><dt>量比</dt><dd>{{format(snapshot.quote?.['量比'])}}</dd></div></dl></section>
      <ul v-if="snapshot.warnings.length" class="research-warnings"><li v-for="warning in snapshot.warnings" :key="warning">{{warning}}</li></ul>
      <section class="panel"><div class="panel-heading research-chart-heading"><div><h2>K 线与成交量</h2><p>价格单位元，成交量单位股；分钟线使用不复权数据。</p></div><div class="research-periods"><label>周期<select v-model.number="period" aria-label="K 线周期" :disabled="analyzing"><option v-for="p in periods" :key="p.value" :value="p.value">{{p.name}}</option></select></label><label v-if="period>=100">复权<select v-model.number="adjust" aria-label="复权方式" :disabled="analyzing"><option :value="1">前复权</option><option :value="0">不复权</option><option :value="2">后复权</option></select></label></div></div><CandleChart v-if="snapshot.candles.length" :candles="snapshot.candles" :period="period"/><div v-else class="empty-state compact"><h3>此周期暂无 K 线</h3><p>可以切换到日线或稍后刷新。</p></div></section>
      <section class="panel research-flow"><div class="panel-heading"><div><h2>资金流向</h2><p>金额单位元 · 正数为净流入，负数为净流出 · 当日数据 {{date(snapshot.fundFlow.asOf)}}</p></div></div><div class="flow-summary"><div><span>主力净流入</span><strong :class="changeColor(mainFlow?.net)">{{compact(mainFlow?.net)}}</strong></div><div><span>主力流入</span><strong>{{compact(mainFlow?.inflow)}}</strong></div><div><span>主力流出</span><strong>{{compact(mainFlow?.outflow)}}</strong></div></div><div class="table-wrap"><table><thead><tr><th>资金类型</th><th class="numeric">流入 / 元</th><th class="numeric">流出 / 元</th><th class="numeric">净流入 / 元</th></tr></thead><tbody><tr v-for="item in snapshot.fundFlow.categories" :key="item.name"><td>{{item.name}}</td><td class="numeric">{{compact(item.inflow)}}</td><td class="numeric">{{compact(item.outflow)}}</td><td :class="['numeric',changeColor(item.net)]">{{compact(item.net)}}</td></tr></tbody></table></div><div v-if="snapshot.fundFlow.history.length" class="flow-history"><h3>近 {{snapshot.fundFlow.history.length}} 个交易日主力净流入</h3><p class="muted small">最新日期 {{latestFlow?.date}}；资金流统计不等同于 ETF 份额申购赎回。</p><svg viewBox="0 0 1000 170" role="img" aria-label="历史主力净流入柱状图"><line x1="35" x2="955" y1="75" y2="75" class="chart-grid"/><g v-for="(day,i) in snapshot.fundFlow.history" :key="day.date"><rect v-if="day.main!==null" :x="40+i*910/snapshot.fundFlow.history.length" :y="day.main>=0?75-day.main/flowScale*55:75" :width="Math.max(3,910/snapshot.fundFlow.history.length-8)" :height="Math.max(1,Math.abs(day.main)/flowScale*55)" :class="day.main>=0?'flow-positive':'flow-negative'"><title>{{day.date}}：{{format(day.main)}} 元</title></rect></g><text x="40" y="157" class="chart-label">{{snapshot.fundFlow.history[0].date}}</text><text x="950" y="157" text-anchor="end" class="chart-label">{{latestFlow?.date}}</text></svg><details class="chart-data"><summary>查看资金历史明细</summary><div class="table-wrap"><table><thead><tr><th>日期</th><th class="numeric">主力 / 元</th><th class="numeric">超大单 / 元</th><th class="numeric">大单 / 元</th><th class="numeric">中单 / 元</th><th class="numeric">小单 / 元</th></tr></thead><tbody><tr v-for="day in [...snapshot.fundFlow.history].reverse()" :key="day.date"><td>{{day.date}}</td><td :class="['numeric',changeColor(day.main)]">{{compact(day.main)}}</td><td class="numeric">{{compact(day.superLarge)}}</td><td class="numeric">{{compact(day.large)}}</td><td class="numeric">{{compact(day.medium)}}</td><td class="numeric">{{compact(day.small)}}</td></tr></tbody></table></div></details></div><p class="panel-footer muted small">主力为超大单与大单合计，请勿与分项重复相加。未发布的字段显示为 —。</p></section>
    </template>
    <section v-if="symbol" class="panel research-ai"><div class="panel-heading"><div><h2>AI 行情分析</h2><p>基于日线、成交量与资金数据；报告仅保存在你的账号。</p></div><button class="button primary" :disabled="loading||analyzing||!snapshot||!aiAvailable" @click="generate"><Icon name="spark" :size="17"/>{{analyzing?'正在分析…':analysis?'更新分析':'生成分析'}}</button></div><p v-if="snapshot&&!aiAvailable" class="notice subtle">AI 分析服务尚未启用，请联系管理员。行情与资金数据仍可查看。</p><p v-if="analyzing" class="ai-progress" role="status">正在读取日线证据并生成中文分析，通常需要 10–60 秒。请保持此页面打开。</p><p v-if="aiError" class="notice danger" role="alert">{{aiError}}</p><p v-if="message" class="notice success" role="status">{{message}}</p><article v-if="analysis" class="analysis-report"><div class="analysis-meta"><span>生成于 {{date(analysis.createdAt)}}（北京时间）</span><span v-if="staleReport">可更新分析</span></div><h3>{{analysis.report.summary}}</h3><dl><div><dt>趋势与均线</dt><dd>{{analysis.report.trend}}</dd></div><div><dt>成交量与成交额</dt><dd>{{analysis.report.volume}}</dd></div><div><dt>资金流向</dt><dd>{{analysis.report.fundFlow}}</dd></div></dl><div class="analysis-lists"><section><h4>需要留意</h4><ul><li v-for="risk in analysis.report.risks" :key="risk">{{risk}}</li></ul></section><section><h4>后续观察</h4><ul><li v-for="point in analysis.report.watchPoints" :key="point">{{point}}</li></ul></section></div><details class="analysis-evidence"><summary>查看分析依据</summary><p>日线截至 {{analysis.evidence.candles.at(-1)?.time}} · {{analysis.evidence.candles.length}} 根 · 前复权 · 资金截至 {{analysis.evidence.fundFlow.history.at(-1)?.date||'暂无历史数据'}}</p><p>MA5 {{format(analysis.evidence.indicators.ma5,3)}} / MA10 {{format(analysis.evidence.indicators.ma10,3)}} / MA20 {{format(analysis.evidence.indicators.ma20,3)}}</p><p>当日成交量 / 前 5 日均量：{{format(analysis.evidence.indicators.volumeRatio5)}} 倍</p><p v-for="warning in analysis.evidence.warnings" :key="warning">{{warning}}</p><p>Cloudflare Workers AI · {{analysis.model}}</p></details><p class="muted small">AI 分析可能出错，数据日期与推理结论应分别核对。</p></article><div v-else-if="!analyzing" class="quiet-empty"><Icon name="spark"/><p>把量价和资金放在一起看。<br/><span>点击生成分析，查看有数据依据的趋势、风险与观察条件。</span></p></div></section>
  </div>
</template>
