<script setup lang="ts">
import { computed,onMounted,onBeforeUnmount,ref } from 'vue';
import Icon from './components/Icon.vue';
import Sheet from './components/Sheet.vue';
import { api,ApiError } from './api';
import type { Account,Instrument,Notice,Rule,Runtime,Status } from './types';

type View='overview'|'instruments'|'rules'|'notifications'|'settings'|'accounts'|'favorites'|'profile';
const ready=ref(false),role=ref<'admin'|'user'|null>(null),view=ref<View>('overview');
const navOpen=ref(false),clock=ref(Date.now()),dark=ref(document.documentElement.dataset.theme==='dark');
const authTab=ref<'login'|'register'|'admin'>('login'),authBusy=ref(false),authError=ref(''),authMessage=ref('');
const registration=ref(false),configError=ref(false),username=ref(''),password=ref(''),passwordAgain=ref(''),nickname=ref(''),adminPassword=ref('');
const me=ref<Account|null>(null),instruments=ref<Instrument[]>([]),rules=ref<Rule[]>([]),events=ref<Notice[]>([]),accounts=ref<Account[]>([]);
const status=ref<Status|null>(null),runtime=ref<Runtime|null>(null),loading=ref(false),loaded=ref(false),pageError=ref(''),pending=ref('');
const search=ref(''),kindFilter=ref('all'),sort=ref('symbol'),ruleFilter=ref('all'),noticeFilter=ref('all'),eventPage=ref(1),hasNextEvents=ref(false);
const toast=ref(''),toastError=ref(false),sheet=ref(''),formError=ref(''),importText=ref(''),importProgress=ref('');
const eventDetail=ref<Notice|null>(null),selected=ref<Instrument|null>(null);
const instrumentForm=ref({symbol:'',market:'SH',kind:'stock',name:'',enabled:true});
const ruleForm=ref({id:'',symbol:'',market:'SH',metric:'price',operator:'cross_above',threshold:1,cooldown_seconds:300,daily_limit:3,auto_disable:false,enabled:true});
const ruleCopy=ref(false),userForm=ref({username:'',nickname:'',password:'',confirm:''});
const allowDraft=ref(false),monitorDraft=ref(false),webhookUrl=ref(''),webhookToken=ref(''),clearWebhookToken=ref(false);
const favoriteText=ref(''),favorites=ref<Instrument[]>([]),favoriteErrors=ref(0);
const confirm=ref<{title:string;description:string;action:()=>Promise<void>}|null>(null);
let toastTimer:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined;
const labels:Record<View,string>={overview:'行情总览',instruments:'标的管理',rules:'预警规则',notifications:'通知中心',settings:'系统设置',accounts:'账号管理',favorites:'我的自选',profile:'账号信息'};
const descriptions:Record<View,string>={overview:'先看行情变化，再处理需要关注的预警。',instruments:'添加股票与 ETF，统一维护监控范围。',rules:'把关注条件设成规则，触发后自动通知。',notifications:'配置通知渠道，查看每一次发送结果。',settings:'管理全站监控服务与新用户注册权限。',accounts:'查看账号，并为指定用户创建登录凭据。',favorites:'维护自己的关注列表，查看最新行情。',profile:'查看当前登录账号与会话信息。'};
const navigation=computed(()=>role.value==='admin' ? [
    {id:'settings',icon:'settings'},{id:'accounts',icon:'users'},
] : [
    {id:'overview',icon:'overview'},{id:'instruments',icon:'stocks'},{id:'rules',icon:'rules'},
    {id:'notifications',icon:'bell'},{id:'favorites',icon:'stocks'},{id:'profile',icon:'users'},
]);
const filtered=computed(()=>instruments.value.filter(i=>(kindFilter.value==='all'||i.kind===kindFilter.value)&&`${i.symbol} ${i.name} ${i.quote?.name||''}`.toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>{
    if(sort.value==='change')return (b.quote?.changePercent??-Infinity)-(a.quote?.changePercent??-Infinity);
    if(sort.value==='price')return (b.quote?.price??-Infinity)-(a.quote?.price??-Infinity);
    return a.symbol.localeCompare(b.symbol);
}));
const filteredRules=computed(()=>rules.value.filter(r=>(ruleFilter.value==='all'||Boolean(r.enabled)===(ruleFilter.value==='enabled'))&&`${r.symbol} ${stockName(r)}`.toLowerCase().includes(search.value.toLowerCase())));
const filteredEvents=computed(()=>events.value.filter(e=>noticeFilter.value==='all'||e.status===noticeFilter.value));
const activeRules=computed(()=>rules.value.filter(r=>r.enabled).length),activeInstruments=computed(()=>instruments.value.filter(i=>i.enabled).length);
const settingsDirty=computed(()=>role.value==='admin' && (allowDraft.value!==registration.value || monitorDraft.value!==(runtime.value?.monitor_enabled??false)));
const operatorNames:Record<string,string>={above:'高于',below:'低于',cross_above:'向上突破',cross_below:'向下跌破'};
const eventNames:Record<string,string>={pending:'等待发送',sending:'发送中',sent:'发送成功',failed:'发送失败'};
const timeLabel=computed(()=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hour12:false}).format(clock.value));
const imported=computed(()=>{
    const seen=new Set<string>();const rows:{symbol:string;market:string;kind:string;name:string;valid:boolean}[]=[];
    for(const line of importText.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)){
        const parts=line.split(/[,，\t\s]+/);const code=parts.find(v=>/^\d{6}$/.test(v))||'';
        const market=parts.find(v=>/^(SH|SZ)$/i.test(v))?.toUpperCase()||(/^(5|6)/.test(code)?'SH':'SZ');
        const kind=parts.find(v=>/^(stock|etf)$/i.test(v))?.toLowerCase()||(/^(51|56|58|15)/.test(code)?'etf':'stock');
        const name=parts.filter(v=>v!==code&&!/^(SH|SZ|stock|etf)$/i.test(v)).join(' ');
        const key=`${market}:${code}`;if(seen.has(key))continue;seen.add(key);
        const valid=code.length===6 && (kind==='etf'?(market==='SH'?/^(51|56|58)/:/^15/):(market==='SH'?/^(60|68)/:/^(00|30)/)).test(code);
        rows.push({symbol:code,market,kind,name,valid});
    }return rows;
});
function notify(message:string,error=false){toast.value=message;toastError.value=error;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',6000);}
function errorText(error:unknown){return error instanceof Error?error.message:'操作失败，请稍后重试。';}
function date(value:number|string|null|undefined,full=false){if(!value)return '—';const d=new Date(typeof value==='string'&&!/[TZ+]/.test(value)?value.replace(' ','T')+'Z':value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...(full?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);}
function number(value:number|undefined|null,digits=2){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';}
function compact(value:number|undefined|null){if(value===null||value===undefined)return '—';return value>=1e8?number(value/1e8)+' 亿':value>=1e4?number(value/1e4)+' 万':number(value,0);}
function change(value:number|undefined|null){return value===null||value===undefined?'—':`${value>0?'+':''}${number(value)}%`;}
function color(value:number|undefined|null){return value===undefined||value===null?'':value>0?'rise':value<0?'fall':'';}
function stockName(item:{symbol:string;market:string}){const stock=instruments.value.find(i=>i.market===item.market&&i.symbol===item.symbol);return stock?.name||stock?.quote?.name||item.symbol;}
function payload(item:Notice):Record<string,any>{try{return JSON.parse(item.payload);}catch{return {};}}
function eventTitle(item:Notice){const data=payload(item);return data.event==='stockwatch.test'?'测试通知':`${data.name||data.symbol||'规则'}触发预警`;}
function navigate(value:View){if(!navigation.value.some(item=>item.id===value))return;location.hash='/'+value;view.value=value;search.value='';navOpen.value=false;}
function syncRoute(){const value=location.hash.replace(/^#\/?/,'') as View;const allowed=navigation.value.some(v=>v.id===value);view.value=allowed?value:role.value==='admin'?'settings':'overview';navOpen.value=false;search.value='';if(role.value==='user'&&loaded.value&&['favorites','profile'].includes(view.value))void loadFavorites().catch(error=>pageError.value=errorText(error));}
function theme(){dark.value=!dark.value;document.documentElement.dataset.theme=dark.value?'dark':'light';try{localStorage.setItem('stockwatch-theme',dark.value?'dark':'light');}catch{/* Theme preferences are optional. */}}
function resetWorkspace(){loaded.value=false;instruments.value=[];rules.value=[];events.value=[];accounts.value=[];favorites.value=[];status.value=null;runtime.value=null;sheet.value='';confirm.value=null;eventDetail.value=null;eventPage.value=1;pageError.value='';webhookUrl.value='';webhookToken.value='';clearWebhookToken.value=false;}
async function loadConfig(){try{registration.value=(await api<{allow_registration:boolean}>('/api/auth/config')).allow_registration;configError.value=false;}catch{configError.value=true;}}
async function boot(){
    const [admin,user]=await Promise.allSettled([api('/api/admin/me'),api<Account>('/api/auth/me'),loadConfig()]);
    if(admin.status==='fulfilled')role.value='admin';else if(user.status==='fulfilled'){role.value='user';me.value=user.value;}
    else role.value=null;
    ready.value=true;syncRoute();if(role.value)await reload();
}
async function auth(){
    authBusy.value=true;authError.value='';authMessage.value='';
    try{
        if(authTab.value==='admin'){await api('/api/admin/login','POST',{password:adminPassword.value});role.value='admin';}
        else if(authTab.value==='register'){
            if(password.value!==passwordAgain.value)throw new Error('两次输入的密码不一致，请重新确认。');
            await api('/api/auth/register','POST',{username:username.value,password:password.value,nickname:nickname.value||undefined});
            authTab.value='login';authMessage.value='账号已创建，请使用刚设置的密码登录。';return;
        }else{me.value=await api<Account>('/api/auth/login','POST',{username:username.value,password:password.value});role.value='user';}
        password.value='';passwordAgain.value='';resetWorkspace();syncRoute();await reload();
    }catch(error){authError.value=errorText(error);if(error instanceof ApiError&&error.status===403)await loadConfig();}
    finally{authBusy.value=false;adminPassword.value='';}
}
async function logout(){
    pending.value='logout';try{await api(role.value==='admin'?'/api/admin/logout':'/api/auth/logout','POST',{});role.value=null;resetWorkspace();me.value=null;instruments.value=[];rules.value=[];events.value=[];password.value='';adminPassword.value='';webhookToken.value='';webhookUrl.value='';userForm.value.password='';userForm.value.confirm='';await loadConfig();}catch(error){notify(errorText(error),true);}finally{pending.value='';}
}
async function reload(background=false){
    if(!role.value)return;
    if(!background)loading.value=true;
    pageError.value='';
    try{
        if(role.value==='admin'){
            if(!background){
                const [system,settings,users]=await Promise.all([
                    api<Runtime>('/api/admin/runtime'),api<{allow_registration:boolean}>('/api/admin/settings'),api<Account[]>('/api/admin/users'),
                ]);
                runtime.value=system;monitorDraft.value=system.monitor_enabled;
                registration.value=settings.allow_registration;allowDraft.value=settings.allow_registration;accounts.value=users;
            }
        }else{
            const results=await Promise.allSettled([
                api<Instrument[]>('/api/monitor/instruments').then(v=>instruments.value=v),
                api<Rule[]>('/api/monitor/rules').then(v=>rules.value=v),
                api<Status>('/api/monitor/status').then(v=>status.value=v),
                api<{events:Notice[]}>('/api/monitor/events?page='+eventPage.value).then(v=>{events.value=v.events;hasNextEvents.value=v.events.length===50;}),
                api<Runtime>('/api/monitor/runtime').then(v=>runtime.value=v),
                ...(['favorites','profile'].includes(view.value)?[loadFavorites()]:[]),
            ]);
            const failed=results.find(v=>v.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
        }
    }catch(error){
        if(error instanceof ApiError&&error.status===401){role.value=null;resetWorkspace();authError.value='登录已过期，请重新登录。';}
        else pageError.value=errorText(error);
    }finally{loading.value=false;loaded.value=true;}
}
async function loadFavorites(){
    const data=await api<any>('/api/users/me');me.value={...me.value!,id:data.id,nickname:data.nickname,created_at:data.created_at};
    const rows:Instrument[]=data['自选股'].map((s:any)=>({symbol:s['股票代码'],market:s['市场代码']||(/^[56]/.test(s['股票代码'])?'SH':'SZ'),name:s['股票简称']||'',kind:/^(51|56|58|15)/.test(s['股票代码'])?'etf':'stock',enabled:1}));
    favoriteErrors.value=0;
    for(let offset=0;offset<rows.length;offset+=20){
        try{const result=await api<any>('/api/cn/stock/quotes/core?symbols='+rows.slice(offset,offset+20).map(s=>s.symbol).join(','));
            for(const q of result['行情']||[]){const row=rows.find(s=>s.symbol===q['股票代码']);if(row){if(q['错误'])favoriteErrors.value++;else {row.name ||= q['股票简称'];row.quote={price:q['最新价'],changePercent:q['涨跌幅'],sourceTime:Date.parse(String(q['更新时间']).replace(' ','T')+'+08:00'),previousClose:0,volume:0,amount:0,name:q['股票简称'],source:'eastmoney'};}}}
        }catch{favoriteErrors.value+=Math.min(20,rows.length-offset);}
    }favorites.value=rows;
}
async function action(name:string,work:()=>Promise<void>,success?:string,refresh=true){pending.value=name;formError.value='';try{await work();if(success)notify(success);if(refresh)await reload();return true;}catch(error){formError.value=errorText(error);notify(errorText(error),true);return false;}finally{pending.value='';}}
function openInstrument(item?:Instrument){selected.value=item||null;instrumentForm.value=item?{symbol:item.symbol,market:item.market,kind:item.kind,name:item.name,enabled:!!item.enabled}:{symbol:'',market:'SH',kind:'stock',name:'',enabled:true};formError.value='';sheet.value='instrument';}
function inferInstrument(){if(selected.value)return;const code=instrumentForm.value.symbol;if(code.length===6){instrumentForm.value.market=/^[56]/.test(code)?'SH':'SZ';instrumentForm.value.kind=/^(51|56|58|15)/.test(code)?'etf':'stock';}}
async function saveInstrument(){const editing=selected.value;const ok=await action('instrument',async()=>{await api(editing?`/api/monitor/instruments/${editing.market}/${editing.symbol}`:'/api/monitor/instruments',editing?'PUT':'POST',instrumentForm.value);},editing?'标的已更新':'已添加监控标的');if(ok)sheet.value='';}
async function toggleInstrument(item:Instrument){await action('instrument:'+item.symbol,async()=>{await api(`/api/monitor/instruments/${item.market}/${item.symbol}`,'PUT',{enabled:!item.enabled});},item.enabled?'已暂停该标的':'已开启该标的');}
function ask(title:string,description:string,work:()=>Promise<void>){confirm.value={title,description,action:work};}
async function acceptConfirm(){if(confirm.value){const work=confirm.value.action;const ok=await action('confirm',work,'操作已完成');if(ok){confirm.value=null;sheet.value='';}}}
function deleteInstrument(item:Instrument){ask(`删除 ${item.name||item.symbol}？`,'该标的关联的规则也将删除，已产生的通知日志会保留。',async()=>{await api(`/api/monitor/instruments/${item.market}/${item.symbol}`,'DELETE');});}
async function importInstruments(){
    if(!imported.value.length||imported.value.some(r=>!r.valid))return;
    const rows=imported.value.filter(row=>!instruments.value.some(i=>i.market===row.market&&i.symbol===row.symbol));
    if(rows.length+instruments.value.length>100){formError.value='导入后将超过 100 只标的，请减少数量。';return;}
    const ok=await action('import',async()=>{let count=0;for(const row of rows){importProgress.value=`正在导入 ${++count} / ${rows.length}`;await api('/api/monitor/instruments','POST',{...row,enabled:true});}},`已导入 ${rows.length} 只标的`);
    importProgress.value='';if(ok){sheet.value='';importText.value='';}else await reload();
}
function openRule(item?:Rule,copy=false){
    if(!instruments.value.length){navigate('instruments');openInstrument();return;}
    ruleCopy.value=copy;const first=instruments.value[0];
    ruleForm.value=item?{...item,id:copy?'':item.id,enabled:!!item.enabled,auto_disable:!!item.auto_disable}:{id:'',symbol:first.symbol,market:first.market,metric:'price',operator:'cross_above',threshold:first.quote?.price||1,cooldown_seconds:300,daily_limit:3,auto_disable:false,enabled:true};
    formError.value='';sheet.value='rule';
}
function ruleSymbol(event:Event){const [market,symbol]=(event.target as HTMLSelectElement).value.split(':');ruleForm.value.market=market;ruleForm.value.symbol=symbol;}
async function saveRule(){const {id,...input}=ruleForm.value;const ok=await action('rule',async()=>{await api('/api/monitor/rules'+(id?'/'+id:''),id?'PUT':'POST',{...input,threshold:Number(input.threshold),cooldown_seconds:Number(input.cooldown_seconds),daily_limit:Number(input.daily_limit)});},'预警规则已保存');if(ok)sheet.value='';}
async function toggleRule(rule:Rule){await action('rule:'+rule.id,async()=>{await api('/api/monitor/rules/'+rule.id,'PUT',{enabled:!rule.enabled});},rule.enabled?'规则已暂停':'规则已启用');}
function deleteRule(rule:Rule){ask('删除这条规则？',`${stockName(rule)} · ${operatorNames[rule.operator]} ${rule.threshold}。删除后将停止检测此条件。`,async()=>{await api('/api/monitor/rules/'+rule.id,'DELETE');});}
async function probe(){await action('probe',async()=>{const data=await api<any>('/api/monitor/probe','POST',{});notify(data.valid?`获取到 ${data.valid}/${data.requested} 只标的的有效行情`:'当前没有有效的新行情，可能处于休市时段。');},undefined,false);}
async function saveSettings(){
    pending.value='settings';formError.value='';
    try{
        if(allowDraft.value!==registration.value){const saved=await api<{allow_registration:boolean}>('/api/admin/settings','PUT',{allow_registration:allowDraft.value});registration.value=saved.allow_registration;}
        if(monitorDraft.value!==runtime.value?.monitor_enabled)runtime.value=await api<Runtime>('/api/admin/runtime','PUT',{monitor_enabled:monitorDraft.value});
        notify('系统设置已保存');await reload();
    }catch(error){formError.value=errorText(error);notify(errorText(error),true);}finally{pending.value='';}
}
async function toggleMonitoring(){await action('monitoring',async()=>{runtime.value=await api<Runtime>('/api/monitor/runtime','PUT',{monitor_enabled:!runtime.value?.monitor_enabled});},runtime.value?.monitor_enabled?'个人监控已暂停':'个人监控已开启');}
async function saveWebhook(){const ok=await action('webhook',async()=>{runtime.value=await api<Runtime>('/api/monitor/runtime','PUT',{webhook_url:webhookUrl.value||undefined,webhook_token:webhookToken.value||undefined,clear_webhook_token:clearWebhookToken.value});},'通知配置已保存');if(ok){webhookUrl.value='';webhookToken.value='';clearWebhookToken.value=false;}}
async function testWebhook(){await action('test',async()=>{await api('/api/monitor/webhook/test','POST',{});},'测试通知已排队，将在下一轮监控任务中发送');}
async function nextEvents(direction:number){eventPage.value=Math.max(1,eventPage.value+direction);await reload();}
async function retryEvent(item:Notice){await action('retry:'+item.id,async()=>{await api('/api/monitor/events/'+encodeURIComponent(item.id)+'/retry','POST',{});},'通知已重新加入发送队列');}
async function createUser(){if(userForm.value.password!==userForm.value.confirm){formError.value='两次输入的密码不一致。';return;}const ok=await action('user',async()=>{await api('/api/admin/users','POST',{username:userForm.value.username,password:userForm.value.password,nickname:userForm.value.nickname||undefined});},'账号已创建，可以使用设置的密码登录');if(ok){sheet.value='';userForm.value={username:'',nickname:'',password:'',confirm:''};}}
async function addFavorite(){const symbols=[...new Set(favoriteText.value.split(/[,，\s]+/).filter(Boolean))];if(!symbols.length||symbols.some(s=>!/^\d{6}$/.test(s))){formError.value='请填写六位代码，多只标的用逗号或换行分隔。';return;}const ok=await action('favorite',async()=>{await api('/api/users/me/favorites','POST',{symbols});},'已添加到个人自选');if(ok){sheet.value='';favoriteText.value='';}}
function removeFavorite(item:Instrument){ask(`移除 ${item.name||item.symbol}？`,'将从你的个人自选列表移除。',async()=>{await api('/api/users/me/favorites','DELETE',{symbols:[item.symbol]});});}
function beforeUnload(event:BeforeUnloadEvent){if(settingsDirty.value&&role.value==='admin'){event.preventDefault();}}
onMounted(()=>{void boot();window.addEventListener('hashchange',syncRoute);window.addEventListener('beforeunload',beforeUnload);poll=setInterval(()=>{clock.value=Date.now();if(role.value==='user'&&document.visibilityState==='visible'&&!pending.value&&sheet.value===''&&!settingsDirty.value)void reload(true);},30000);});
onBeforeUnmount(()=>{clearTimeout(toastTimer);clearInterval(poll);window.removeEventListener('hashchange',syncRoute);window.removeEventListener('beforeunload',beforeUnload);});
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div v-if="!ready" class="boot-screen"><img src="/mark.svg" width="48" height="48" alt=""/><p>正在连接工作台…</p></div>
  <div v-else-if="!role" class="auth-layout">
    <section class="auth-story" aria-label="StockWatch 产品介绍">
      <a class="brand" href="/" aria-label="StockWatch 首页"><img src="/mark.svg" alt="" width="38" height="38"/><span>StockWatch<small>股票与 ETF 盯盘工作台</small></span></a>
      <div class="auth-copy"><h1>行情在变，<br/>关注不必一直在线。</h1><p>把价格条件交给规则。<br/>你关心的变化，及时送达。</p><div class="story-flow"><span><Icon name="stocks"/>关注标的</span><i></i><span><Icon name="rules"/>设置规则</span><i></i><span><Icon name="bell"/>接收通知</span></div></div>
      <div class="auth-foot"><span class="live-dot"></span>股票与场内 ETF · 分钟监控 · 中文工作台</div>
    </section>
    <main class="auth-panel" id="main-content">
      <button class="icon-button auth-theme" @click="theme" :aria-label="dark?'切换浅色主题':'切换深色主题'"><Icon :name="dark?'sun':'moon'"/></button>
      <div class="auth-box"><div class="auth-mobile-brand"><img src="/mark.svg" width="36" height="36" alt=""/>StockWatch</div>
        <h2>{{authTab==='admin'?'登录管理工作台':authTab==='register'?'创建你的账号':'欢迎回来'}}</h2>
        <p class="muted">{{authTab==='admin'?'管理系统设置与用户账号。':authTab==='register'?'创建账号后，即可设置个人监控、规则与通知。':'登录后管理自己的监控、规则、通知与自选。'}}</p>
        <div class="auth-tabs" aria-label="登录方式"><button :class="{active:authTab!=='admin'}" @click="authTab='login';authError=''">账号登录</button><button :class="{active:authTab==='admin'}" @click="authTab='admin';authError=''">管理员入口</button></div>
        <div v-if="configError" class="notice warning" role="status">暂时无法读取注册状态。<button class="text-button" @click="loadConfig">重新连接</button></div>
        <div v-if="authMessage" class="notice success" role="status">{{authMessage}}</div>
        <form @submit.prevent="auth" class="form-stack">
          <template v-if="authTab!=='admin'"><label>用户名<input v-model="username" name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}" placeholder="输入你的用户名"/></label>
            <label v-if="authTab==='register'">昵称 <span class="optional">选填</span><input v-model="nickname" maxlength="80" autocomplete="nickname" placeholder="你希望显示的名字"/></label>
            <label>密码<input v-model="password" type="password" :autocomplete="authTab==='register'?'new-password':'current-password'" required minlength="4" maxlength="128" placeholder="至少 4 个字符"/></label>
            <label v-if="authTab==='register'">确认密码<input v-model="passwordAgain" type="password" autocomplete="new-password" required minlength="4" maxlength="128" placeholder="再次输入密码"/></label></template>
          <template v-else><label>管理员密码<input v-model="adminPassword" name="admin-password" type="password" autocomplete="current-password" required maxlength="128" placeholder="输入管理员密码"/></label><p class="field-help">登录会话有效期为 8 小时，密码不会保存到浏览器本地存储。</p></template>
          <p v-if="authError" class="form-error" role="alert"><Icon name="alert" :size="16"/>{{authError}}</p>
          <button class="button primary auth-submit" type="submit" :disabled="authBusy">{{authBusy?'正在验证…':authTab==='register'?'创建账号':'登录工作台'}}<Icon name="arrow" :size="18"/></button>
        </form>
        <p class="auth-register" v-if="authTab==='register'">已有账号？<button class="text-button" @click="authTab='login';authError=''">返回登录</button></p>
        <p class="auth-register" v-else-if="authTab==='login'&&registration">还没有账号？<button class="text-button" @click="authTab='register';authError='';authMessage=''">立即注册</button></p>
        <p class="auth-register muted" v-else-if="authTab==='login'&&!configError">当前暂未开放注册，请联系管理员创建账号。</p>
      </div><footer class="auth-bottom">StockWatch · 让关注更从容</footer>
    </main>
  </div>

  <div v-else class="app-shell">
    <button v-if="navOpen" class="nav-scrim" aria-label="关闭导航" @click="navOpen=false"></button>
    <aside :class="['sidebar',{open:navOpen}]" aria-label="主导航">
      <a class="brand" href="#/overview" @click.prevent="navigate(role==='admin'?'settings':'overview')"><img src="/mark.svg" alt="" width="36" height="36"/><span>StockWatch<small>盯盘工作台</small></span></a>
      <div class="workspace-label">{{role==='admin'?'管理工作区':'个人工作区'}}<span>{{role==='admin'?'ADMIN':'PERSONAL'}}</span></div>
      <nav><a v-for="item in navigation" :key="item.id" :href="'#/'+item.id" :aria-current="view===item.id?'page':undefined" :class="{active:view===item.id}" @click.prevent="navigate(item.id as View)"><Icon :name="item.icon"/><span>{{labels[item.id as View]}}</span><span v-if="item.id==='rules'&&activeRules" class="nav-count">{{activeRules}}</span></a></nav>
      <div class="sidebar-note"><Icon name="shield" :size="18"/><p>按你设定的条件监控<br/><span>不连接券商，不执行交易</span></p></div>
      <div class="account-bar"><span class="avatar">{{role==='admin'?'管':(me?.nickname||me?.username||'我').slice(0,1)}}</span><div><strong>{{role==='admin'?'系统管理员':me?.nickname||me?.username}}</strong><small>{{role==='admin'?'系统设置与用户创建':'个人监控与自选管理'}}</small></div><button class="icon-button" aria-label="退出登录" :disabled="!!pending" @click="logout"><Icon name="logout" :size="18"/></button></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="topbar-title"><button class="icon-button mobile-menu" aria-label="打开导航" @click="navOpen=true"><Icon name="menu"/></button><span>工作台</span><span class="breadcrumb-separator">/</span><strong>{{labels[view]}}</strong></div><div class="topbar-actions"><time>{{timeLabel}} <span>北京时间</span></time><button class="icon-button" @click="theme" :aria-label="dark?'切换浅色主题':'切换深色主题'"><Icon :name="dark?'sun':'moon'"/></button></div></header>
      <main id="main-content" class="main-content">
        <div class="page-heading"><div><h1>{{labels[view]}}</h1><p>{{descriptions[view]}}</p></div><button class="button quiet" :disabled="loading||!!pending" @click="reload()"><Icon name="refresh" :class="{spinning:loading}" :size="17"/>刷新</button></div>
        <div v-if="pageError" class="notice danger" role="alert"><Icon name="alert"/><span>{{pageError}}</span><button class="text-button" @click="reload()">重试</button></div>
        <div v-if="loading&&!loaded" class="loading-state" aria-busy="true" aria-label="正在读取数据"><div v-for="n in 5" :key="n" class="skeleton-line"></div></div>

        <template v-else>
          <template v-if="role==='user'&&view==='overview'">
            <div v-if="runtime?.system_enabled===false" class="notice warning"><Icon name="alert"/><span>管理员已暂停全站监控服务。你的个人配置会保留，服务恢复后继续生效。</span></div><section class="monitor-strip" aria-label="监控状态"><div class="monitor-state"><span :class="['live-dot',{paused:!status?.enabled}]"></span><div><strong>{{status===null?'状态未读取':status.enabled?'自动监控进行中':'自动监控已暂停'}}</strong><p>{{status?.enabled?'交易时段每分钟检查，触发条件后通知你。':'开启后，后台会按规则持续检查行情。'}}</p></div></div><button class="button" :disabled="!!pending||!status" @click="toggleMonitoring"><Icon :name="runtime?.monitor_enabled?'pause':'play'" :size="16"/>{{pending==='monitoring'?'正在保存…':runtime?.monitor_enabled?'暂停个人监控':'开启个人监控'}}</button></section>
            <div class="summary-row"><div><span>监控标的</span><strong>{{activeInstruments}}<small> / {{instruments.length}} 只</small></strong></div><div><span>运行规则</span><strong>{{activeRules}}<small> / {{rules.length}} 条</small></strong></div><div><span>待发送通知</span><strong>{{status?.notifications.filter(s=>['pending','sending'].includes(s.status)).reduce((n,s)=>n+s.count,0)??'—'}}<small> 条</small></strong></div><div><span>最近检查</span><strong class="summary-time">{{date(status?.runs[0]?.finished_at)}}<small>{{status?.runs[0]?.status==='partial'?'部分行情缺失':status?.runs[0]?.status==='failed'?'本轮检查失败':status?.runs.length?'已完成':'等待首轮运行'}}</small></strong></div></div>
            <div class="overview-grid"><section class="panel"><div class="panel-heading"><div><h2>关注行情</h2><p>东方财富 · 最新采集快照</p></div><button class="text-button" @click="navigate('instruments')">管理标的<Icon name="arrow" :size="15"/></button></div>
                <div v-if="!instruments.length" class="empty-state"><span class="empty-icon"><Icon name="stocks" :size="28"/></span><h3>先添加你关心的标的</h3><p>输入股票或 ETF 代码，开始建立监控列表。</p><button class="button primary" @click="openInstrument()"><Icon name="plus" :size="17"/>添加第一个标的</button></div>
                <div v-else class="table-wrap"><table><thead><tr><th>证券</th><th class="numeric">最新价</th><th class="numeric">涨跌幅</th><th>行情时间</th></tr></thead><tbody><tr v-for="item in instruments.slice(0,10)" :key="item.market+item.symbol"><td><strong>{{item.name||item.quote?.name||item.symbol}}</strong><small>{{item.market}} {{item.symbol}} <span class="tiny-tag">{{item.kind==='etf'?'ETF':'股票'}}</span></small></td><td class="numeric data-value">{{number(item.quote?.price,3)}}</td><td :class="['numeric',color(item.quote?.changePercent)]">{{change(item.quote?.changePercent)}}</td><td><span :class="{'muted':!item.quote||item.quote.stale}">{{item.quote?date(item.quote.sourceTime):'等待采集'}}</span><small v-if="item.quote?.stale">行情待更新</small></td></tr></tbody></table></div>
                <footer v-if="instruments.length>10" class="panel-footer"><button class="text-button" @click="navigate('instruments')">查看全部 {{instruments.length}} 只标的</button></footer>
              </section><aside class="overview-side"><section class="panel"><div class="panel-heading"><h2>最近通知</h2><button class="text-button" @click="navigate('notifications')">全部</button></div><div v-if="!events.length" class="quiet-empty"><Icon name="bell"/><p>暂无通知<br/><span>规则触发后的发送结果会显示在这里。</span></p></div><button v-for="item in events.slice(0,4)" :key="item.id" class="event-preview" @click="eventDetail=item;sheet='event'"><span :class="['event-dot',item.status]"></span><div><strong>{{eventTitle(item)}}</strong><span>{{eventNames[item.status]}} · {{date(item.created_at)}}</span></div><Icon name="arrow" :size="15"/></button></section><section class="panel"><div class="panel-heading"><h2>运行记录</h2><span class="muted small">最近 3 次</span></div><p v-if="!status?.runs.length" class="quiet-empty-text">开启监控后，交易时段的检查结果会显示在这里。</p><div v-for="run in status?.runs.slice(0,3)" :key="run.id" class="run-item"><div><span>{{date(run.started_at)}}</span><span :class="['status-badge',run.status==='success'?'sent':run.status==='failed'?'failed':'pending']">{{run.status==='success'?'检查完成':run.status==='failed'?'检查失败':run.status==='partial'?'部分缺失':'检查中'}}</span></div><p>{{run.error||`有效行情 ${run.quote_count} 只 · 触发通知 ${run.event_count} 条`}}</p></div></section></aside></div>
          </template>

          <template v-if="role==='user'&&view==='instruments'">
            <div class="toolbar"><div class="search-box"><Icon name="search" :size="18"/><input v-model="search" aria-label="搜索标的" placeholder="搜索名称或证券代码"/></div><select v-model="kindFilter" aria-label="标的类型"><option value="all">全部类型</option><option value="stock">股票</option><option value="etf">ETF</option></select><select v-model="sort" aria-label="标的排序"><option value="symbol">按代码排序</option><option value="change">按涨跌幅排序</option><option value="price">按价格排序</option></select><span class="toolbar-spacer"></span><button class="button" :disabled="!!pending||!instruments.length" @click="probe"><Icon name="refresh" :size="17"/>{{pending==='probe'?'验证中…':'验证行情'}}</button><button class="button" @click="sheet='import';formError='' "><Icon name="upload" :size="17"/>批量导入</button><button class="button primary" @click="openInstrument()"><Icon name="plus" :size="17"/>添加标的</button></div>
            <section class="panel"><div class="panel-heading"><h2>监控列表 <span class="heading-count">{{instruments.length}} / 100</span></h2><span class="muted small">启用 {{activeInstruments}} 只</span></div><div v-if="!instruments.length" class="empty-state"><span class="empty-icon"><Icon name="stocks" :size="28"/></span><h3>你的监控列表还是空的</h3><p>添加一只股票或 ETF，再为它设置预警条件。</p><button class="button primary" @click="openInstrument()">添加标的</button></div><div v-else-if="!filtered.length" class="empty-state compact"><h3>没有匹配的标的</h3><button class="text-button" @click="search='';kindFilter='all'">清除筛选</button></div><div v-else class="table-wrap"><table><thead><tr><th>证券</th><th class="numeric">最新价</th><th class="numeric">涨跌幅</th><th class="numeric">成交量 / 股</th><th>状态</th><th>规则</th><th class="actions-cell">操作</th></tr></thead><tbody><tr v-for="item in filtered" :key="item.market+item.symbol"><td><strong>{{item.name||item.quote?.name||item.symbol}}</strong><small>{{item.market}} {{item.symbol}} <span class="tiny-tag">{{item.kind==='etf'?'ETF':'股票'}}</span></small></td><td class="numeric"><strong class="data-value">{{number(item.quote?.price,3)}}</strong><small>{{item.quote?date(item.quote.sourceTime):'等待行情'}}{{item.quote?.stale?' · 已过期':''}}</small></td><td :class="['numeric',color(item.quote?.changePercent)]">{{change(item.quote?.changePercent)}}</td><td class="numeric">{{compact(item.quote?.volume)}}</td><td><button class="switch" role="switch" :aria-checked="!!item.enabled" :aria-label="(item.enabled?'暂停':'启用')+(item.name||item.symbol)" :disabled="!!pending" @click="toggleInstrument(item)"><span></span></button><span class="switch-caption">{{item.enabled?'监控中':'已暂停'}}</span></td><td>{{rules.filter(r=>r.symbol===item.symbol&&r.market===item.market).length}} 条</td><td><div class="row-actions"><button class="icon-button" :aria-label="'编辑'+item.symbol" @click="openInstrument(item)"><Icon name="edit" :size="17"/></button><button class="icon-button danger-text" :aria-label="'删除'+item.symbol" :disabled="!!pending" @click="deleteInstrument(item)"><Icon name="trash" :size="17"/></button></div></td></tr></tbody></table></div><footer v-if="instruments.length" class="panel-footer muted small">每分钟采集 · 行情缺失或过期时不触发规则 · {{filtered.length}} 条结果</footer></section>
          </template>

          <template v-if="role==='user'&&view==='rules'">
            <div class="toolbar"><div class="search-box"><Icon name="search" :size="18"/><input v-model="search" aria-label="搜索规则标的" placeholder="搜索规则关联的证券"/></div><select v-model="ruleFilter" aria-label="规则状态"><option value="all">全部规则</option><option value="enabled">已启用</option><option value="disabled">已暂停</option></select><span class="toolbar-spacer"></span><button class="button primary" @click="openRule()"><Icon name="plus" :size="17"/>创建规则</button></div>
            <section class="panel"><div class="panel-heading"><h2>预警规则 <span class="heading-count">{{rules.length}} / 200</span></h2><span class="muted small">{{activeRules}} 条正在检测</span></div><div v-if="!rules.length" class="empty-state"><span class="empty-icon"><Icon name="rules" :size="28"/></span><h3>让规则替你留意变化</h3><p>例如：价格向上突破目标价，或当日涨幅超过 3%。</p><button class="button primary" @click="openRule()">创建第一条规则</button></div><div v-else-if="!filteredRules.length" class="empty-state compact"><h3>没有符合条件的规则</h3><button class="text-button" @click="search='';ruleFilter='all'">清除筛选</button></div><div v-else class="rule-list"><article v-for="rule in filteredRules" :key="rule.id" class="rule-row"><div class="rule-summary"><div><strong>{{stockName(rule)}}</strong><span class="muted small">{{rule.market}} {{rule.symbol}}</span></div><h3>{{rule.metric==='price'?'最新价':'当日涨跌幅'}} <span>{{operatorNames[rule.operator]}}</span> {{number(rule.threshold,rule.metric==='price'?3:2)}}{{rule.metric==='change_percent'?'%':'元'}}</h3><p>冷却 {{rule.cooldown_seconds/60}} 分钟 · 每日最多 {{rule.daily_limit}} 次{{rule.auto_disable?' · 触发后停用':''}}</p></div><div class="rule-history"><span>最近触发</span><strong>{{date(rule.last_triggered_at,true)}}</strong></div><div class="rule-controls"><button class="switch" role="switch" :aria-checked="!!rule.enabled" :aria-label="(rule.enabled?'暂停':'启用')+stockName(rule)+'规则'" :disabled="!!pending" @click="toggleRule(rule)"><span></span></button><span class="small muted">{{rule.enabled?'已启用':'已暂停'}}</span><div class="row-actions"><button class="icon-button" aria-label="编辑规则" @click="openRule(rule)"><Icon name="edit" :size="17"/></button><button class="icon-button" aria-label="复制规则" @click="openRule(rule,true)"><Icon name="copy" :size="17"/></button><button class="icon-button danger-text" aria-label="删除规则" @click="deleteRule(rule)"><Icon name="trash" :size="17"/></button></div></div></article></div></section>
          </template>

          <template v-if="role==='user'&&view==='notifications'">
            <section class="panel webhook-panel"><div class="panel-heading"><div><h2>Webhook 通知渠道</h2><p>{{runtime?.webhook_configured?'已连接 '+runtime.webhook_host:'连接接收地址，把预警送到你常用的工具。'}}</p></div><span :class="['status-badge',runtime?.webhook_configured?'sent':'pending']">{{runtime?.webhook_configured?'已配置':'待配置'}}</span></div><form class="webhook-form" @submit.prevent="saveWebhook"><div class="field-group"><label>接收地址<input v-model="webhookUrl" type="url" maxlength="2048" autocomplete="off" placeholder="https://你的通知服务/接收路径" aria-describedby="webhook-url-help"/></label><p id="webhook-url-help" class="field-help">{{runtime?.webhook_configured?'留空保留现有地址，填写新地址后保存即可替换。':'使用可信通知服务提供的 HTTPS 接收地址。'}}</p></div><div class="field-group"><label>鉴权密钥 <span class="optional">选填</span><input v-model="webhookToken" type="password" maxlength="2048" autocomplete="new-password" :placeholder="runtime?.webhook_token_configured?'已设置，留空保留现有密钥':'接收方要求的 Bearer Token'" aria-describedby="webhook-token-help"/></label><p id="webhook-token-help" class="field-help">凭据加密保存，之后不会回显。</p></div><div class="webhook-actions"><label v-if="runtime?.webhook_token_configured" class="checkbox-label"><input v-model="clearWebhookToken" type="checkbox"/>清除原鉴权密钥</label><span class="toolbar-spacer"></span><button class="button" type="button" :disabled="!!pending||!runtime?.webhook_configured" @click="testWebhook"><Icon name="bell" :size="17"/>{{pending==='test'?'正在排队…':'发送测试通知'}}</button><button class="button primary" type="submit" :disabled="!!pending||(!webhookUrl&&!webhookToken&&!clearWebhookToken)">{{pending==='webhook'?'正在保存…':'保存通知配置'}}</button></div></form></section>
            <div class="toolbar notification-toolbar"><h2>发送历史</h2><span class="toolbar-spacer"></span><select v-model="noticeFilter" aria-label="筛选通知状态"><option value="all">本页全部状态</option><option value="sent">发送成功</option><option value="pending">等待发送</option><option value="sending">发送中</option><option value="failed">发送失败</option></select></div>
            <section class="panel"><div v-if="!events.length" class="empty-state"><span class="empty-icon"><Icon name="bell" :size="28"/></span><h3>通知会在这里留下记录</h3><p>配置渠道并发送一次测试，或等待规则首次触发。</p><button class="button" :disabled="!!pending||!runtime?.webhook_configured" @click="testWebhook">发送测试通知</button></div><div v-else-if="!filteredEvents.length" class="empty-state compact"><h3>本页没有此状态的通知</h3><button class="text-button" @click="noticeFilter='all'">查看本页全部通知</button></div><div v-else class="table-wrap"><table><thead><tr><th>通知内容</th><th>状态</th><th>触发时间</th><th>尝试次数</th><th>结果</th><th>操作</th></tr></thead><tbody><tr v-for="item in filteredEvents" :key="item.id"><td><strong>{{eventTitle(item)}}</strong><small>{{payload(item).symbol||'渠道连通测试'}}</small></td><td><span :class="['status-badge',item.status]">{{eventNames[item.status]}}</span></td><td>{{date(item.created_at,true)}}</td><td>{{item.attempts}} / 5</td><td><span v-if="item.last_error" class="danger-text">{{item.last_error}}</span><span v-else-if="item.http_status">HTTP {{item.http_status}}</span><span v-else class="muted">等待下一轮发送</span></td><td><div class="row-actions"><button class="text-button" @click="eventDetail=item;sheet='event'">详情</button><button v-if="item.status==='failed'" class="text-button" :disabled="!!pending" @click="retryEvent(item)">重新发送</button></div></td></tr></tbody></table></div><footer class="panel-footer pagination"><span class="muted small">第 {{eventPage}} 页 · 每页最多 50 条</span><div><button class="button quiet small-button" :disabled="eventPage===1||loading" @click="nextEvents(-1)">上一页</button><button class="button quiet small-button" :disabled="!hasNextEvents||loading" @click="nextEvents(1)">下一页</button></div></footer></section>
          </template>

          <template v-if="role==='admin'&&view==='settings'">
            <form class="settings-layout" @submit.prevent="saveSettings"><section class="panel settings-panel"><div class="panel-heading"><div><h2>账号与访问</h2><p>由你决定谁可以创建新账号。</p></div><Icon name="shield"/></div><div class="setting-row"><div><label for="allow-registration">允许新用户注册</label><p>关闭后，已有账号仍可登录；管理员仍可手动创建账号。</p></div><button id="allow-registration" class="switch large-switch" type="button" role="switch" :aria-checked="allowDraft" :disabled="!!pending" @click="allowDraft=!allowDraft"><span></span></button></div><div class="setting-row"><div><strong>管理员创建账号</strong><p>无需开放公开注册，也可以为指定用户创建账号。</p></div><button class="button quiet" type="button" @click="navigate('accounts');userForm={username:'',nickname:'',password:'',confirm:''};formError='';sheet='user'">创建账号<Icon name="arrow" :size="16"/></button></div></section>
              <section class="panel settings-panel"><div class="panel-heading"><div><h2>全站监控服务</h2><p>控制全站后台任务，不修改任何用户的个人监控开关。</p></div><Icon name="rules"/></div><div class="setting-row"><div><label for="monitor-enabled">启用全站监控服务</label><p>关闭后暂停所有用户的监控与通知投递，用户仍可维护个人配置。</p></div><button id="monitor-enabled" class="switch large-switch" type="button" role="switch" :aria-checked="monitorDraft" :disabled="!!pending" @click="monitorDraft=!monitorDraft"><span></span></button></div><dl class="settings-facts"><div><dt>行情来源</dt><dd>东方财富</dd></div><div><dt>检查间隔</dt><dd>每 60 秒</dd></div><div><dt>监控容量</dt><dd>每用户 100 只标的 / 200 条规则</dd></div><div><dt>时区</dt><dd>北京时间 · Asia/Shanghai</dd></div><div><dt>日志保留</dt><dd>运行 7 天 / 通知 30 天</dd></div></dl></section>
              <div class="settings-save"><p :class="settingsDirty?'unsaved':'muted'"><span v-if="settingsDirty" class="live-dot paused"></span>{{settingsDirty?'有尚未保存的设置':'所有设置已保存'}}</p><button class="button primary" type="submit" :disabled="!!pending||!settingsDirty"><Icon name="check" :size="17"/>{{pending==='settings'?'正在保存…':'保存系统设置'}}</button></div><p v-if="formError" class="form-error" role="alert">{{formError}}</p>
            </form>
          </template>

          <template v-if="role==='admin'&&view==='accounts'">
            <div class="notice" :class="registration?'success':'subtle'"><Icon name="shield"/><span>{{registration?'当前已开放公开注册，新用户可在登录页面创建账号。':'当前已关闭公开注册，你仍可在此手动创建账号。'}}</span><button class="text-button" @click="navigate('settings')">修改设置</button></div>
            <section class="panel"><div class="panel-heading"><h2>用户账号 <span class="heading-count">{{accounts.length}}</span></h2><button class="button primary" @click="userForm={username:'',nickname:'',password:'',confirm:''};formError='';sheet='user'"><Icon name="plus" :size="17"/>创建账号</button></div><div v-if="!accounts.length" class="empty-state"><span class="empty-icon"><Icon name="users" :size="28"/></span><h3>还没有用户账号</h3><p>创建第一个账号，或在系统设置中开放注册。</p><button class="button primary" @click="sheet='user';formError=''">创建第一个账号</button></div><div v-else class="table-wrap"><table><thead><tr><th>用户名</th><th>昵称</th><th>身份</th><th>创建时间</th></tr></thead><tbody><tr v-for="account in accounts" :key="account.id"><td><strong>{{account.username}}</strong></td><td>{{account.nickname}}</td><td><span class="tiny-tag">普通用户</span></td><td>{{date(account.created_at,true)}}</td></tr></tbody></table></div><footer class="panel-footer muted small">普通账号独立管理自己的标的、规则、通知渠道和自选，不能修改系统设置。最多展示最近 200 个账号。</footer></section>
          </template>

          <template v-if="role==='user'&&view==='favorites'">
            <div v-if="favoriteErrors" class="notice warning"><Icon name="alert"/>{{favoriteErrors}} 只标的暂未取得有效行情，可稍后刷新。</div><div class="toolbar"><span class="muted">已关注 {{favorites.length}} 只标的</span><span class="toolbar-spacer"></span><button class="button primary" @click="favoriteText='';formError='';sheet='favorite'"><Icon name="plus" :size="17"/>添加自选</button></div><section class="panel"><div v-if="!favorites.length" class="empty-state"><span class="empty-icon"><Icon name="stocks" :size="28"/></span><h3>从第一只关注的证券开始</h3><p>添加六位股票或 ETF 代码，维护自己的关注列表。</p><button class="button primary" @click="sheet='favorite';formError=''">添加自选</button></div><div v-else class="table-wrap"><table><thead><tr><th>证券</th><th class="numeric">最新价</th><th class="numeric">涨跌幅</th><th>更新时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in favorites" :key="item.symbol"><td><strong>{{item.name||item.symbol}}</strong><small>{{item.market}} {{item.symbol}}</small></td><td class="numeric data-value">{{number(item.quote?.price,3)}}</td><td :class="['numeric',color(item.quote?.changePercent)]">{{change(item.quote?.changePercent)}}</td><td>{{date(item.quote?.sourceTime)}}</td><td><button class="text-button danger-text" :disabled="!!pending" @click="removeFavorite(item)">移除</button></td></tr></tbody></table></div></section>
          </template>
          <template v-if="role==='user'&&view==='profile'"><section class="panel profile-panel"><div class="profile-header"><span class="avatar large-avatar">{{(me?.nickname||me?.username||'我').slice(0,1)}}</span><div><h2>{{me?.nickname||me?.username}}</h2><p class="muted">个人账号</p></div></div><dl class="settings-facts"><div><dt>用户名</dt><dd>{{me?.username}}</dd></div><div><dt>创建时间</dt><dd>{{date(me?.created_at,true)}}</dd></div><div><dt>登录状态</dt><dd><span class="status-badge sent">已登录</span></dd></div></dl><footer class="panel-footer"><button class="button" :disabled="!!pending" @click="logout"><Icon name="logout" :size="17"/>退出当前账号</button></footer></section></template>
        </template>
        <footer class="workspace-footer"><span>StockWatch</span><p>行情可能存在延迟，请以交易所数据为准。</p><span>北京时间</span></footer>
      </main>
    </div>
  </div>

  <Sheet :open="sheet==='instrument'" :title="selected?'编辑标的':'添加监控标的'" :busy="!!pending" @close="sheet=''">
    <form class="form-stack" @submit.prevent="saveInstrument"><label>证券代码<input v-model="instrumentForm.symbol" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" required :disabled="!!selected" placeholder="例如 510300" aria-describedby="symbol-help" @input="inferInstrument"/></label><p id="symbol-help" class="field-help">输入六位代码，自动识别市场与类型。</p><div class="form-grid"><label>市场<select v-model="instrumentForm.market" :disabled="!!selected"><option value="SH">上海证券交易所</option><option value="SZ">深圳证券交易所</option></select></label><label>类型<select v-model="instrumentForm.kind"><option value="stock">股票</option><option value="etf">场内 ETF</option></select></label></div><label>名称 / 备注 <span class="optional">选填</span><input v-model="instrumentForm.name" maxlength="80" placeholder="例如 沪深300ETF"/></label><label class="checkbox-label"><input v-model="instrumentForm.enabled" type="checkbox"/>添加后启用监控</label><p v-if="formError" class="form-error" role="alert">{{formError}}</p><footer class="form-actions"><button class="button" type="button" :disabled="!!pending" @click="sheet=''">取消</button><button class="button primary" type="submit" :disabled="!!pending">{{pending==='instrument'?'正在保存…':'保存标的'}}</button></footer></form>
  </Sheet>
  <Sheet :open="sheet==='import'" title="批量导入标的" :busy="!!pending" :wide="true" @close="sheet=''">
    <form class="form-stack" @submit.prevent="importInstruments"><p class="muted">每行填写一只证券代码，也支持“市场,代码,类型,名称”。重复代码会自动去重，已添加标的会跳过。</p><label>导入内容<textarea v-model="importText" rows="6" required maxlength="12000" placeholder="510300&#10;159915&#10;SH,600519,stock,贵州茅台"></textarea></label><div v-if="imported.length" class="import-preview"><strong>预览 {{imported.length}} 只标的</strong><div v-for="(item,index) in imported.slice(0,8)" :key="index"><span>{{item.market}} {{item.symbol||'代码缺失'}}</span><span>{{item.name|| (item.kind==='etf'?'ETF':'股票')}}</span><span :class="item.valid?'fall':'danger-text'">{{item.valid?'可导入':'请检查格式'}}</span></div><p v-if="imported.length>8" class="muted small">其余 {{imported.length-8}} 只将一并导入。</p></div><p v-if="formError" class="form-error" role="alert">{{formError}}</p><p v-if="importProgress" role="status">{{importProgress}}</p><footer class="form-actions"><button class="button" type="button" :disabled="!!pending" @click="sheet=''">取消</button><button class="button primary" type="submit" :disabled="!!pending||!imported.length||imported.some(i=>!i.valid)">{{pending==='import'?'正在导入…':'确认导入'}}</button></footer></form>
  </Sheet>
  <Sheet :open="sheet==='rule'" :title="ruleCopy?'复制预警规则':ruleForm.id?'编辑预警规则':'创建预警规则'" :busy="!!pending" @close="sheet=''">
    <form class="form-stack" @submit.prevent="saveRule"><label>关联标的<select :value="ruleForm.market+':'+ruleForm.symbol" required @change="ruleSymbol"><option v-for="item in instruments" :key="item.market+item.symbol" :value="item.market+':'+item.symbol">{{item.name||item.quote?.name||item.symbol}} · {{item.market}} {{item.symbol}}</option></select></label><div class="form-grid"><label>监控指标<select v-model="ruleForm.metric"><option value="price">最新价</option><option value="change_percent">当日涨跌幅</option></select></label><label>触发条件<select v-model="ruleForm.operator"><option value="cross_above">向上突破</option><option value="cross_below">向下跌破</option><option value="above">持续高于</option><option value="below">持续低于</option></select></label></div><label>目标{{ruleForm.metric==='price'?'价格 / 元':'涨跌幅 / %'}}<input v-model.number="ruleForm.threshold" type="number" step="any" :min="ruleForm.metric==='price'?0.0001:-1000000000" max="1000000000" required/></label><p class="field-help">{{ruleForm.operator.startsWith('cross')?'穿越规则先记录一轮基线，之后跨过目标值时通知。':'持续满足条件时，按冷却时间与每日上限控制通知。'}}</p><div class="form-grid"><label>冷却时间 / 秒<input v-model.number="ruleForm.cooldown_seconds" type="number" min="60" max="86400" step="1" required/></label><label>每日通知上限<input v-model.number="ruleForm.daily_limit" type="number" min="1" max="100" step="1" required/></label></div><label class="checkbox-label"><input v-model="ruleForm.auto_disable" type="checkbox"/>首次触发后自动停用规则</label><label class="checkbox-label"><input v-model="ruleForm.enabled" type="checkbox"/>保存后启用规则</label><p v-if="formError" class="form-error" role="alert">{{formError}}</p><footer class="form-actions"><button class="button" type="button" :disabled="!!pending" @click="sheet=''">取消</button><button class="button primary" type="submit" :disabled="!!pending">{{pending==='rule'?'正在保存…':'保存规则'}}</button></footer></form>
  </Sheet>
  <Sheet :open="sheet==='event'" title="通知详情" :wide="true" @close="sheet=''">
    <template v-if="eventDetail"><div class="detail-heading"><h3>{{eventTitle(eventDetail)}}</h3><span :class="['status-badge',eventDetail.status]">{{eventNames[eventDetail.status]}}</span></div><dl class="settings-facts"><div><dt>触发时间</dt><dd>{{date(eventDetail.created_at,true)}}</dd></div><div><dt>发送次数</dt><dd>{{eventDetail.attempts}} 次</dd></div><div><dt>发送结果</dt><dd>{{eventDetail.last_error|| (eventDetail.http_status?'HTTP '+eventDetail.http_status:'等待发送')}}</dd></div></dl><label class="detail-payload">事件内容<pre>{{JSON.stringify(payload(eventDetail),null,2)}}</pre></label><footer class="form-actions"><button class="button" @click="sheet=''">关闭</button></footer></template>
  </Sheet>
  <Sheet :open="sheet==='user'" title="创建用户账号" :busy="!!pending" @close="sheet='';userForm.password='';userForm.confirm=''">
    <form class="form-stack" @submit.prevent="createUser"><p class="muted">创建普通账号，不会赋予管理员权限。</p><label>用户名<input v-model="userForm.username" autocomplete="off" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}" placeholder="3–32 位字母或数字"/></label><label>昵称 <span class="optional">选填</span><input v-model="userForm.nickname" maxlength="80" placeholder="用户显示名称"/></label><label>初始密码<input v-model="userForm.password" type="password" autocomplete="new-password" required minlength="4" maxlength="128" placeholder="至少 4 个字符"/></label><label>确认密码<input v-model="userForm.confirm" type="password" autocomplete="new-password" required minlength="4" maxlength="128" placeholder="再次输入初始密码"/></label><p v-if="formError" class="form-error" role="alert">{{formError}}</p><footer class="form-actions"><button class="button" type="button" :disabled="!!pending" @click="sheet='';userForm.password='';userForm.confirm=''">取消</button><button class="button primary" type="submit" :disabled="!!pending">{{pending==='user'?'正在创建…':'创建账号'}}</button></footer></form>
  </Sheet>
  <Sheet :open="sheet==='favorite'" title="添加个人自选" :busy="!!pending" @close="sheet=''">
    <form class="form-stack" @submit.prevent="addFavorite"><label>证券代码<textarea v-model="favoriteText" rows="4" required placeholder="例如 000001,510300&#10;多只证券用逗号或换行分隔"></textarea></label><p v-if="formError" class="form-error" role="alert">{{formError}}</p><footer class="form-actions"><button class="button" type="button" :disabled="!!pending" @click="sheet=''">取消</button><button class="button primary" type="submit" :disabled="!!pending">{{pending==='favorite'?'正在添加…':'添加到自选'}}</button></footer></form>
  </Sheet>
  <Sheet :open="!!confirm" :title="confirm?.title||'确认操作'" :busy="!!pending" @close="confirm=null"><p class="confirm-copy">{{confirm?.description}}</p><p v-if="formError" class="form-error" role="alert">{{formError}}</p><footer class="form-actions"><button class="button" :disabled="!!pending" @click="confirm=null">取消</button><button class="button destructive" :disabled="!!pending" @click="acceptConfirm">{{pending==='confirm'?'正在处理…':'确认删除'}}</button></footer></Sheet>
  <Transition name="toast"><div v-if="toast" :class="['toast-message',{error:toastError}]" role="status" aria-live="polite"><Icon :name="toastError?'alert':'check'" :size="19"/><span>{{toast}}</span><button class="icon-button" aria-label="关闭提示" @click="toast='' "><Icon name="close" :size="16"/></button></div></Transition>
</template>
