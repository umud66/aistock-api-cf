import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { deployWithMigrations,deploymentContext,migrateBoundDatabase } from './deployment.mjs';

const runtime = resolve('.tmp/runtime');
mkdirSync(runtime, { recursive: true });
// Local secrets come from the launching shell, without writing credentials to files.
const args = process.argv.slice(2);
const local = args[0] === 'dev' || args[0] === 'd1' && args.includes('--local');
if (local && !args.some(arg => arg === '--config' || arg === '-c' || arg.startsWith('--config='))) {
    args.push('--config', 'wrangler.local.toml');
}
if (local && !args.some(arg => arg === '--persist-to' || arg.startsWith('--persist-to='))) {
    args.push('--persist-to', '.tmp/state');
}
const localEnvironment = args[0] === 'dev' ? {
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
} : {};
function runWrangler(command,options={}) {
    return new Promise((resolveRun,reject)=>{
        const child=spawn(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),...command],{
            stdio:options.capture?['ignore','pipe','pipe']:options.nonInteractive?['ignore','inherit','inherit']:'inherit',
            env:{...process.env,...localEnvironment,TMPDIR:runtime,TMP:runtime,TEMP:runtime,
                WRANGLER_LOG_PATH:resolve('.tmp/wrangler.log'),npm_config_cache:resolve('.tmp/npm-cache'),
                ...(options.capture?{WRANGLER_LOG:'error'}:{}),
                ...(options.nonInteractive?{CI:'true'}:{})},
        });
        let output='';
        if(options.capture){child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;});
            // Metadata may contain plain-text environment values; never echo or save it.
            child.stderr.resume();}
        child.once('error',()=>reject(new Error('无法启动 Wrangler，请先运行 npm install')));
        child.once('exit',(code,signal)=>code===0?resolveRun(output):reject(new Error(`Wrangler ${command.slice(0,2).join(' ')} 失败（${signal??code}），部署已停止。请检查认证、Cloudflare 权限或上一条迁移错误。`)));
    });
}
try {
    if(args[0]==='deploy') await deployWithMigrations(args,runWrangler);
    else if(args[0]==='migrate') await migrateBoundDatabase(['deploy',...args.slice(1)],runWrangler);
    else {
        if(args[0]==='dev'&&!args.includes('--remote')) {
            const persistIndex=args.indexOf('--persist-to');
            const persist=persistIndex>=0?args[persistIndex+1]:args.find(arg=>arg.startsWith('--persist-to='))?.slice('--persist-to='.length)??'.tmp/state';
            await runWrangler(['d1','migrations','apply','DB','--local',...deploymentContext(args).global,'--persist-to',persist],{nonInteractive:true});
        }
        await runWrangler(args);
    }
}catch(error){console.error(error instanceof Error?error.message:'部署失败');process.exitCode=1;}
