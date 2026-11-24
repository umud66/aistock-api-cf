import {authenticatedUser} from '../auth/security';
import {AccountRepository} from '../auth/AccountRepository';
import {createResponse} from '../utils/response';
import {getStockIdentity} from '../utils/stock';
import {marketSnapshot} from '../research/MarketService';
import {ResearchRepository} from '../research/ResearchRepository';
import {analyzeMarket} from '../research/AnalysisService';
import {AiUnavailableError,aiModel} from '../services/WorkersAiService';
import type {Env} from '../index';
import type {KLinePeriod,KLineFqt} from '../services/EmKlineService';

export class ResearchController {
    static async handle(request:Request,env:Env):Promise<Response> {
        const response=await this.dispatch(request,env);
        const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
        return new Response(response.body,{status:response.status,headers});
    }
    private static async dispatch(request:Request,env:Env):Promise<Response> {
        const userId=await authenticatedUser(request,env);
        if(!userId)return createResponse(401,'请先登录用户账号');
        const url=new URL(request.url),match=url.pathname.match(/^\/api\/research\/(\d{6})\/(snapshot|analysis)\/?$/);
        if(!match)return createResponse(404,'研究接口不存在');
        const [,symbol,operation]=match;
        if(getStockIdentity(symbol).market==='unknown')return createResponse(400,'暂不支持此证券代码，请填写沪深股票或场内 ETF 代码');
        const repository=new ResearchRepository(env.DB,userId);let owner:string|undefined;
        try{
            if(operation==='snapshot'){
                if(request.method!=='GET')return createResponse(405,'仅支持 GET');
                const period=Number(url.searchParams.get('period')??101),adjust=Number(url.searchParams.get('adjust')??(period<100?0:1));
                if(![1,5,15,30,60,101,102,103].includes(period)||![0,1,2].includes(adjust))return createResponse(400,'不支持的 K 线周期或复权方式');
                const snapshot=await marketSnapshot(symbol,period as KLinePeriod,adjust as KLineFqt,env.KV);
                return createResponse(200,'success',{snapshot,aiAvailable:!!env.AI,model:aiModel(env)});
            }
            if(request.method==='GET')return createResponse(200,'success',{analysis:await repository.latest(symbol)});
            if(request.method!=='POST')return createResponse(405,'仅支持 GET/POST');
            if(!env.AI)throw new AiUnavailableError('请在 Cloudflare 的 Bindings 中添加名为 AI 的 Workers AI 绑定');
            const previous=await repository.latest(symbol);
            if(previous&&Date.now()-previous.createdAt<300_000)return createResponse(200,'返回 5 分钟内的分析，避免重复生成',{analysis:previous,cached:true});
            owner=crypto.randomUUID();
            if(!await repository.acquire(symbol,owner)){owner=undefined;return createResponse(409,'该证券的分析正在生成，请稍后刷新');}
            if(!await new AccountRepository(env.DB).consumeLimit(`research:${userId}`,12))return createResponse(429,'每 15 分钟最多生成 12 次分析，请稍后再试');
            const evidence=await marketSnapshot(symbol,101,1,env.KV);
            const analysis=await analyzeMarket(env,evidence);
            await repository.save(analysis,owner);
            return createResponse(200,'分析已生成',{analysis,cached:false});
        }catch(error){
            if(error instanceof AiUnavailableError)return createResponse(503,error.message);
            console.error('[Research]',operation,symbol,error instanceof Error?error.name:'UnknownError');
            return createResponse(502,operation==='analysis'?'分析暂未完成，请稍后重试；数据不足或 AI 服务繁忙时不会生成报告':'行情数据源暂不可用，请稍后刷新');
        }finally{if(owner)await repository.release(symbol,owner).catch(()=>console.error('[Research] 分析租约释放失败，将自动过期'));}
    }
}
