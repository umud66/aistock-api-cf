import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Workers Builds defaults to `npm run build` followed by native `wrangler deploy`.
// The migration must run in this entry too, rather than relying only on npm deploy.
const productionBranch=process.env.CF_MIGRATION_BRANCH || 'main';
if(process.env.WORKERS_CI==='1' && (!process.env.WORKERS_CI_BRANCH || process.env.WORKERS_CI_BRANCH===productionBranch)) {
    console.log('[BuildMigration] Cloudflare Build：自动迁移已绑定的 D1 数据库');
    const code=await new Promise((resolveRun,reject)=>{
        const child=spawn(process.execPath,[resolve('scripts/wrangler-local.mjs'),'migrate'],{stdio:'inherit',env:process.env});
        child.once('error',reject);child.once('exit',code=>resolveRun(code??1));
    });
    if(code!==0){console.error('[BuildMigration] 数据库迁移失败，停止本次构建与发布');process.exitCode=code;}
}else if(process.env.WORKERS_CI==='1') {
    console.log('[BuildMigration] 预览分支不更新生产数据库');
}
