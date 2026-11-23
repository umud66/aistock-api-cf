import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function isDryRun(args) {
    let dryRun=false;
    for(let index=1;index<args.length;index++) {
        if(args[index]==='--no-dry-run'){dryRun=false;continue;}
        if(args[index]==='--dry-run') {
            const value=args[index+1];
            if(value==='true'||value==='false'){dryRun=value==='true';index++;}
            else dryRun=true;
        }else if(args[index].startsWith('--dry-run=')) {
            const value=args[index].slice('--dry-run='.length);
            if(value!=='true'&&value!=='false')throw new Error('--dry-run 仅支持 true/false');
            dryRun=value==='true';
        }
    }
    return dryRun;
}

export function deploymentContext(args) {
    if(args.some(arg=>['--cwd','--dispatch-namespace','--env-file'].some(key=>arg===key||arg.startsWith(key+'=')))) {
        throw new Error('自动迁移不支持 --cwd、dispatch namespace 或 --env-file，请在当前项目通过进程环境配置部署。');
    }
    const global=[], target=[];
    const names=new Set(['--config','-c','--env','-e','--name']);
    for(let i=1;i<args.length;i++) {
        const separator=args[i].indexOf('=');
        const key=separator<0?args[i]:args[i].slice(0,separator);
        const inline=separator<0?undefined:args[i].slice(separator+1);
        if(!names.has(key))continue;
        const value=inline ?? args[++i];
        if(!value||value.startsWith('--'))throw new Error(`缺少 ${key} 参数`);
        (key==='--name'?target:global).push(key,value);
    }
    return {global,target};
}

function parseJson(text) {
    try{return JSON.parse(text);}catch{throw new Error('无法读取 Cloudflare 绑定元数据，已停止部署；未执行数据库迁移。');}
}

/** Discover the deployed binding rather than guessing a database by name. */
export async function boundDatabase(args,run) {
    const {global,target}=deploymentContext(args);
    const deployment=parseJson(await run(['deployments','status',...global,...target,'--json'],{capture:true}));
    const versions=(deployment.versions??[]).filter(v=>v.percentage===undefined||v.percentage>0);
    if(!versions.length)throw new Error('目标 Worker 尚无已部署版本，请先在控制台建立 Worker 并绑定名为 DB 的 D1 数据库。');
    const ids=new Set();
    for(const version of versions) {
        if(!uuid.test(version.version_id??''))throw new Error('Cloudflare 返回了无效版本编号，已停止部署。');
        const info=parseJson(await run(['versions','view',version.version_id,...global,...target,'--json'],{capture:true}));
        const bindings=(info.resources?.bindings??[]).filter(binding=>binding.name==='DB'&&binding.type==='d1');
        if(bindings.length!==1||!uuid.test(bindings[0].id??''))throw new Error('目标 Worker 必须绑定一个名为 DB 的 D1 数据库，已停止部署。');
        ids.add(bindings[0].id);
    }
    if(ids.size!==1)throw new Error('正在分流的 Worker 版本绑定了不同数据库，无法安全自动迁移，已停止部署。');
    return [...ids][0];
}

export async function migrationConfig(databaseId,root=process.cwd()) {
    if(!uuid.test(databaseId))throw new Error('无效的数据库编号');
    const directory=resolve(root,'.tmp/deploy-migrations');
    await mkdir(directory,{recursive:true});
    const unique=await mkdtemp(resolve(directory,'run-'));
    const file=resolve(unique,'wrangler.json');
    // Only a resource ID is persisted. No token, variable values or Worker metadata.
    await writeFile(file,JSON.stringify({name:'stockwatch-migrations',compatibility_date:'2026-01-08',
        d1_databases:[{binding:'DB',database_name:'dashboard-bound-db',database_id:databaseId,
            migrations_dir:resolve(root,'migrations'),migrations_table:'stockwatch_schema_migrations'}]},null,2)+'\n');
    return file;
}

/** Any failed step rejects; the live Worker is published only after migrations succeed. */
export async function deployWithMigrations(args,run,options={}) {
    if(isDryRun(args))return run(args);
    deploymentContext(args);
    const log=options.log??console.log;
    log('1/4 检查 Worker 构建');
    await run([...args,'--dry-run']);
    log('2/4 检查 Cloudflare 认证并读取现有 DB 绑定');
    await migrateBoundDatabase(args,run,options);
    log('4/4 发布 Worker 和前端页面');
    return run(args);
}

export async function migrateBoundDatabase(args,run,options={}) {
    const auth=await run(['whoami',...deploymentContext(args).global],{capture:true});
    if(/not (?:authenticated|logged in)/i.test(auth))throw new Error('尚未登录 Cloudflare，请先运行 Wrangler login 或设置部署用 API Token。');
    const databaseId=await boundDatabase(args,run);
    const config=await (options.writeConfig??migrationConfig)(databaseId);
    (options.log??console.log)('自动应用未执行的数据库迁移');
    await run(['d1','migrations','apply','DB','--remote','--config',config],{nonInteractive:true});
}
