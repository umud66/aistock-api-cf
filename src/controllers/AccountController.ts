import { AccountRepository } from '../auth/AccountRepository';
import { hashPassword, verifyPassword } from '../auth/password';
import { authenticatedUser, digest, adminCredentialHash, isAdmin, ADMIN_COOKIE, SESSION_COOKIE, sessionToken, trustedOrigin } from '../auth/security';
import { applicationSecret } from '../auth/applicationSecret';
import { publicRuntime, saveRuntime } from '../monitoring/RuntimeSettings';
import type { AccountEnv } from '../auth/security';
import { createResponse } from '../utils/response';

class AccountError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new AccountError(400,message);
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
    requireValue(request.headers.get('Content-Type')?.toLowerCase().includes('application/json'),'请求需要 application/json');
    const reader = request.body?.getReader();
    requireValue(reader,'请求体不能为空');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const {value,done} = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > 8192) { await reader.cancel(); throw new AccountError(413,'请求体超过 8 KB'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset=0;
    for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
    let value: unknown;
    try {value=JSON.parse(new TextDecoder().decode(bytes));} catch {throw new AccountError(400,'请求体不是有效 JSON');}
    requireValue(value && typeof value==='object' && !Array.isArray(value),'请求体需要 JSON 对象');
    return value as Record<string,unknown>;
}
function credentials(body: Record<string, unknown>) {
    requireValue(typeof body.username==='string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(body.username),'用户名需要 3–32 位字母、数字、点、横线或下划线');
    requireValue(typeof body.password==='string' && body.password.length>=12 && body.password.length<=128,'密码需要 12–128 个字符');
    requireValue(body.nickname===undefined || typeof body.nickname==='string' && body.nickname.length<=80,'昵称最长 80 字符');
    return {username:body.username.toLowerCase(),password:body.password,nickname:String(body.nickname ?? body.username)};
}
async function pepper(env: AccountEnv): Promise<string> {
    try{return await applicationSecret(env);}
    catch(error){throw new AccountError(503,error instanceof Error?error.message:'内部加密服务暂不可用');}
}
function withCookie(response: Response, token: string, maxAge: number, name = SESSION_COOKIE): Response {
    const headers=new Headers(response.headers);
    headers.set('Set-Cookie',`${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
    return new Response(response.body,{status:response.status,headers});
}

export class AccountController {
    static async handle(request: Request, env: AccountEnv): Promise<Response> {
        const response = await this.dispatch(request, env);
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, headers });
    }
    private static async dispatch(request: Request, env: AccountEnv): Promise<Response> {
        const path=new URL(request.url).pathname.replace(/\/$/,'');
        const repository=new AccountRepository(env.DB);
        try {
            if (!['GET','POST','PUT'].includes(request.method)) return createResponse(405,'Method Not Allowed');
            if (request.method!=='GET' && !trustedOrigin(request,env)) return createResponse(403,'请求来源不受信任');
            if (path.startsWith('/api/admin/') && !['/api/admin/login','/api/admin/logout'].includes(path) && !await isAdmin(request,env)) return createResponse(401,'请先登录管理员账号');
            if (path==='/api/admin/login') {
                if(request.method!=='POST') return createResponse(405,'仅支持 POST');
                const client=await digest(request.headers.get('CF-Connecting-IP') ?? 'local');
                if(!await repository.consumeLimit(`admin:ip:${client}`,10)) return createResponse(429,'尝试次数过多，请在 15 分钟后重试');
                const input=await bodyOf(request);
                if(!env.ADMIN_PASSWORD)return createResponse(503,'请先在 Cloudflare Secrets 中配置管理员密码 ADMIN_PASSWORD');
                if(typeof input.password!=='string'||input.password.length>128)return createResponse(401,'管理员密码不正确');
                const expected=await digest(env.ADMIN_PASSWORD),provided=await digest(input.password);
                let difference=0;
                for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^provided.charCodeAt(i);
                if(difference!==0)return createResponse(401,'管理员密码不正确');
                const raw=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
                await env.DB.batch([
                    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(Date.now()),
                    env.DB.prepare('INSERT INTO admin_sessions(token_hash,credential_hash,expires_at) VALUES(?,?,?)')
                        .bind(await digest(raw),await adminCredentialHash(env.ADMIN_PASSWORD,raw),Date.now()+8*3600_000),
                ]);
                return withCookie(createResponse(200,'管理员登录成功',{role:'admin'}),raw,8*3600,ADMIN_COOKIE);
            }
            if(path==='/api/admin/logout') {
                if(request.method!=='POST') return createResponse(405,'仅支持 POST');
                const raw=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-stockwatch_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
                if(raw) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(raw)).run();
                return withCookie(createResponse(200,'已退出'),'',0,ADMIN_COOKIE);
            }
            if(path==='/api/admin/me' && request.method==='GET') return createResponse(200,'success',{role:'admin'});
            if(path==='/api/admin/runtime') {
                if(request.method==='GET') return createResponse(200,'success',await publicRuntime(env));
                if(request.method==='PUT') {
                    try {return createResponse(200,'运行设置已保存',await saveRuntime(env,await bodyOf(request)));}
                    catch(error) {if(error instanceof AccountError) throw error;return createResponse(400,error instanceof Error?error.message:'设置保存失败');}
                }
                return createResponse(405,'仅支持 GET/PUT');
            }
            if(path==='/api/admin/users' && request.method==='GET') {
                const result=await env.DB.prepare('SELECT c.user_id AS id,c.username,u.nickname,c.created_at FROM account_credentials c JOIN users u ON u.openid=c.user_id ORDER BY c.created_at DESC LIMIT 200').all();
                return createResponse(200,'success',result.results);
            }
            if (path==='/api/auth/config' && request.method==='GET') {
                return createResponse(200,'success',{allow_registration:(await repository.settings()).allow_registration});
            }
            if (path==='/api/admin/settings') {
                if(request.method==='GET') return createResponse(200,'success',await repository.settings());
                if(request.method==='PUT') {
                    const body=await bodyOf(request);
                    requireValue(typeof body.allow_registration==='boolean','allow_registration 必须是 boolean');
                    requireValue(Object.keys(body).every(key=>key==='allow_registration'),'包含不支持的设置项');
                    return createResponse(200,'设置已保存',await repository.setRegistration(body.allow_registration));
                }
                return createResponse(405,'仅支持 GET/PUT');
            }
            const registering=path==='/api/auth/register';
            const creating=path==='/api/admin/users';
            const loggingIn=path==='/api/auth/login';
            if(registering || creating || loggingIn) {
                if(request.method!=='POST') return createResponse(405,'仅支持 POST');
                if(registering && !(await repository.settings()).allow_registration) return createResponse(403,'管理员已关闭注册');
                const secret=await pepper(env);
                const input=credentials(await bodyOf(request));
                if(!creating) {
                    const client=await digest(request.headers.get('CF-Connecting-IP') ?? 'local');
                    const perUser=await digest(input.username);
                    if (!await repository.consumeLimit(`${registering?'register':'login'}:ip:${client}`,registering?5:30) ||
                        !await repository.consumeLimit(`${registering?'register':'login'}:user:${perUser}`,registering?5:10)) {
                        return createResponse(429,'尝试次数过多，请在 15 分钟后重试');
                    }
                }
                const existing=await repository.find(input.username);
                if(registering || creating) {
                    if(existing) return createResponse(409,'用户名已存在');
                    let id: string|null;
                    try {
                        id=await repository.create(input.username,await hashPassword(input.password,secret),input.nickname,creating);
                    } catch(error) {
                        // Race on a unique username is a conflict, never a partial account.
                        if(String(error).includes('UNIQUE constraint failed: account_credentials.username')) return createResponse(409,'用户名已存在');
                        throw error;
                    }
                    if(!id) return createResponse(403,'管理员已关闭注册');
                    await repository.cleanup();
                    return createResponse(201,'账号已创建，请登录',{id,username:input.username});
                }
                if(!await verifyPassword(input.password,secret,existing?.password_hash ?? null) || !existing) return createResponse(401,'用户名或密码错误');
                const raw=crypto.getRandomValues(new Uint8Array(32));
                const token=Array.from(raw,v=>v.toString(16).padStart(2,'0')).join('');
                const lifetime=7*86400;
                await env.DB.prepare('INSERT INTO account_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
                    .bind(await digest(token),existing.user_id,Date.now()+lifetime*1000).run();
                await repository.cleanup();
                return withCookie(createResponse(200,'登录成功',{id:existing.user_id,username:existing.username}),token,lifetime);
            }
            if(path==='/api/auth/logout') {
                if(request.method!=='POST') return createResponse(405,'仅支持 POST');
                const token=sessionToken(request);
                if(token) await env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await digest(token)).run();
                return withCookie(createResponse(200,'已退出'),'',0);
            }
            if(path==='/api/auth/me') {
                if(request.method!=='GET') return createResponse(405,'仅支持 GET');
                const id=await authenticatedUser(request,env);
                if(!id) return createResponse(401,'未登录或会话已过期');
                const user=await env.DB.prepare('SELECT c.user_id AS id,c.username,u.nickname,u.created_at FROM account_credentials c JOIN users u ON u.openid=c.user_id WHERE c.user_id=?').bind(id).first();
                return createResponse(200,'success',user);
            }
            return createResponse(404,'账号接口不存在');
        } catch(error) {
            return createResponse(error instanceof AccountError ? error.status : 500,
                error instanceof AccountError ? error.message : '账号操作失败，请检查数据库迁移和服务配置');
        }
    }
}
