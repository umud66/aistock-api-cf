export interface AiEnvironment {AI?:Ai;AI_MODEL?:string}
export const DEFAULT_AI_MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export class AiUnavailableError extends Error {}
export function aiModel(env:AiEnvironment):string {return env.AI_MODEL || DEFAULT_AI_MODEL;}

/** Shared Workers AI adapter. No external API keys or OpenAI endpoint fallback. */
export async function generateAiText(env:AiEnvironment,system:string,prompt:string,onDelta?:(text:string)=>void):Promise<string> {
    if(!env.AI)throw new AiUnavailableError('请在 Cloudflare 的 Bindings 中添加名为 AI 的 Workers AI 绑定');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
        return await Promise.race([
            invokeAi(env,system,prompt,onDelta),
            new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Workers AI 推理超时，请稍后重试')),65_000);}),
        ]);
    }finally{if(timer)clearTimeout(timer);}
}
async function invokeAi(env:AiEnvironment,system:string,prompt:string,onDelta?:(text:string)=>void):Promise<string> {
    const ai=env.AI!;
    const result=await ai.run(aiModel(env) as keyof AiModels,{
        messages:[{role:'system',content:system},{role:'user',content:prompt}],
        temperature:0.2,max_tokens:2200,
        ...(onDelta?{stream:true}:{response_format:{type:'json_object'}}),
    });
    if(result instanceof ReadableStream){
        const reader=result.getReader(),decoder=new TextDecoder();let pending='',text='';
        const consume=(line:string)=>{
            if(!line.startsWith('data:'))return;
            const value=line.slice(5).trim();if(!value||value==='[DONE]')return;
            const item=JSON.parse(value);
            if(item.error)throw new Error('Workers AI 推理未完成，请稍后重试');
            const delta=item.response ?? item.choices?.[0]?.delta?.content ?? '';
            if(typeof delta==='string'){text+=delta;onDelta?.(delta);}
        };
        try{
            while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});
                const lines=pending.split('\n');pending=lines.pop()!;for(const line of lines)consume(line.trim());}
            pending+=decoder.decode();if(pending.trim())consume(pending.trim());
        }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
        if(!text.trim())throw new Error('Workers AI 未返回有效分析，请重试');
        return text.trim();
    }
    const value=result as {response?:unknown;choices?:{message?:{content?:string}}[]};
    const content=value.response ?? value.choices?.[0]?.message?.content;
    const text=typeof content==='string'?content:content&&typeof content==='object'?JSON.stringify(content):'';
    if(!text.trim())throw new Error('Workers AI 未返回有效分析，请重试');
    return text.trim();
}
