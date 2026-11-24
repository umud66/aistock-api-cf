<script setup lang="ts">
import {computed,ref,watch,onMounted,onBeforeUnmount} from 'vue';
import type {Candle} from '../../src/research/types';
const props=defineProps<{candles:Candle[];period:number}>();
const count=ref(window.innerWidth<700?40:80),offset=ref(0),active=ref<number|null>(null);
const container=ref<HTMLElement|null>(null),worldWidth=ref(1000);
const right=computed(()=>worldWidth.value-80);
let observer:ResizeObserver|undefined;
onMounted(()=>{observer=new ResizeObserver(entries=>{worldWidth.value=Math.max(320,Math.round(entries[0].contentRect.width));});if(container.value)observer.observe(container.value);});
onBeforeUnmount(()=>observer?.disconnect());
watch(()=>props.candles,()=>{offset.value=0;active.value=null;});
const end=computed(()=>Math.max(1,props.candles.length-offset.value));
const start=computed(()=>Math.max(0,end.value-count.value));
const rows=computed(()=>props.candles.slice(start.value,end.value));
const selected=computed(()=>rows.value[active.value??rows.value.length-1]);
const bounds=computed(()=>{const lo=Math.min(...rows.value.map(c=>c.low)),hi=Math.max(...rows.value.map(c=>c.high));const pad=Math.max((hi-lo)*.08,hi*.002);return {min:lo-pad,max:hi+pad};});
const publishedVolumeMax=computed(()=>{const values=rows.value.flatMap(c=>c.volume===null?[]:[c.volume]);return values.length?Math.max(...values):null;});
const volumeMax=computed(()=>Math.max(1,publishedVolumeMax.value??0));
const step=computed(()=>(right.value-54)/Math.max(1,rows.value.length));
const x=(i:number)=>54+(i+.5)*step.value;
const y=(price:number)=>24+(bounds.value.max-price)/(bounds.value.max-bounds.value.min)*230;
const width=computed(()=>Math.max(1,Math.min(12,step.value*.65)));
const grids=computed(()=>Array.from({length:5},(_,i)=>({price:bounds.value.max-(bounds.value.max-bounds.value.min)*i/4,y:24+i*57.5})));
function average(period:number){return rows.value.map((_,i)=>{const index=start.value+i;if(index+1<period)return '';const v=props.candles.slice(index-period+1,index+1).reduce((s,c)=>s+c.close,0)/period;return `${x(i)},${y(v)}`;}).filter(Boolean).join(' ');}
function point(event:PointerEvent){const target=event.currentTarget as SVGSVGElement;const rect=target.getBoundingClientRect();active.value=Math.max(0,Math.min(rows.value.length-1,Math.floor(((event.clientX-rect.left)/rect.width*worldWidth.value-54)/step.value)));}
function key(event:KeyboardEvent){if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const i=active.value??rows.value.length-1;active.value=event.key==='Home'?0:event.key==='End'?rows.value.length-1:Math.max(0,Math.min(rows.value.length-1,i+(event.key==='ArrowLeft'?-1:1)));}}
function zoom(event:WheelEvent){count.value=Math.max(20,Math.min(240,count.value+(event.deltaY>0?20:-20)));active.value=null;}
function pan(direction:number){offset.value=Math.max(0,Math.min(Math.max(0,props.candles.length-20),offset.value+direction*Math.floor(count.value/2)));active.value=null;}
function format(value:number|null|undefined,digits=3){return value==null?'—':value.toLocaleString('zh-CN',{maximumFractionDigits:digits});}
function compact(value:number){return value>=1e8?(value/1e8).toFixed(1)+'亿':value>=1e4?(value/1e4).toFixed(1)+'万':String(Math.round(value));}
</script>
<template>
  <div ref="container" class="candle-chart">
    <div class="chart-controls"><span class="ma-legend"><span class="ma5">MA5</span><span class="ma10">MA10</span><span class="ma20">MA20</span></span><label class="chart-range">显示根数<select v-model.number="count" aria-label="显示 K 线根数" @change="active=null"><option :value="40">40 根</option><option :value="80">80 根</option><option :value="120">120 根</option><option :value="240">240 根</option></select></label><button class="button small-button" :disabled="end<=20" @click="pan(1)">较早</button><button class="button small-button" :disabled="offset===0" @click="pan(-1)">较新</button></div>
    <div v-if="selected" class="candle-readout" aria-live="polite"><strong>{{selected.time}}</strong><span>开 {{format(selected.open)}}</span><span>高 {{format(selected.high)}}</span><span>低 {{format(selected.low)}}</span><span>收 {{format(selected.close)}}</span><span>量 {{format(selected.volume,0)}} 股</span><span>额 {{format(selected.amount,0)}} 元</span></div>
    <svg v-if="rows.length" class="price-chart" :viewBox="`0 0 ${worldWidth} 410`" role="img" tabindex="0" aria-label="K 线、均线与成交量图。左右方向键查看各根 K 线，滚轮调整显示范围。" @pointermove="point" @pointerdown="point" @keydown="key" @wheel.prevent="zoom">
      <defs><clipPath id="research-price-clip"><rect x="54" y="24" :width="right-54" height="230"/></clipPath></defs>
      <g v-for="grid in grids" :key="grid.y"><line x1="54" :x2="right" :y1="grid.y" :y2="grid.y" class="chart-grid"/><text :x="right+10" :y="grid.y+4" class="chart-label">{{format(grid.price)}}</text></g>
      <text x="54" y="287" class="chart-label">成交量（股）</text><text :x="right+10" y="310" class="chart-label">{{publishedVolumeMax===null?'—':compact(publishedVolumeMax)}}</text><line x1="54" :x2="right" y1="365" y2="365" class="chart-grid"/>
      <g v-for="(c,i) in rows" :key="c.time" :class="c.close>=c.open?'candle-up':'candle-down'">
        <line :x1="x(i)" :x2="x(i)" :y1="y(c.high)" :y2="y(c.low)"/>
        <rect :x="x(i)-width/2" :y="Math.min(y(c.open),y(c.close))" :width="width" :height="Math.max(1,Math.abs(y(c.close)-y(c.open)))"/>
        <rect v-if="c.volume!==null" :x="x(i)-width/2" :y="365-c.volume/volumeMax*60" :width="width" :height="c.volume/volumeMax*60" class="volume-candle"/>
      </g>
      <g clip-path="url(#research-price-clip)"><polyline :points="average(5)" class="chart-ma ma5"/><polyline :points="average(10)" class="chart-ma ma10"/><polyline :points="average(20)" class="chart-ma ma20"/></g>
      <g v-if="active!==null&&rows[active]" class="chart-crosshair"><line :x1="x(active)" :x2="x(active)" y1="24" y2="365"/><line x1="54" :x2="right" :y1="y(rows[active].close)" :y2="y(rows[active].close)"/></g>
      <text x="54" y="390" class="chart-label">{{rows[0].time.slice(0,10)}}</text><text :x="right" y="390" text-anchor="end" class="chart-label">{{rows.at(-1)?.time.slice(0,10)}}</text>
    </svg>
    <p class="chart-help">红涨绿跌 · 点击或移动查看数据 · 左右方向键逐根查看 · 滚轮缩放</p>
    <details class="chart-data"><summary>查看最近 10 根 K 线数据</summary><div class="table-wrap"><table><thead><tr><th>时间</th><th>开盘</th><th>最高</th><th>最低</th><th>收盘</th><th>成交量 / 股</th><th>成交额 / 元</th></tr></thead><tbody><tr v-for="c in rows.slice(-10).reverse()" :key="c.time"><td>{{c.time}}</td><td>{{format(c.open)}}</td><td>{{format(c.high)}}</td><td>{{format(c.low)}}</td><td>{{format(c.close)}}</td><td>{{format(c.volume,0)}}</td><td>{{format(c.amount,0)}}</td></tr></tbody></table></div></details>
  </div>
</template>
