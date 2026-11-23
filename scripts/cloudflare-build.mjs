// compile embeds migrations/*.sql in the Worker before this script runs.
// A Builds deployment token can publish an existing DB binding without being
// allowed to read deployment metadata or query D1 through the management API.
// ensureSchema() uses the actual runtime DB binding, and must finish before
// any API handler or scheduled task runs. Migration errors remain fatal there.
if(process.env.WORKERS_CI==='1') {
    console.log('[BuildMigration] 迁移 SQL 已打包进 Worker；构建阶段无需读取绑定或访问 D1 管理 API。');
    console.log('[BuildMigration] 发布后，首次接口请求或定时任务会通过 DB 绑定自动迁移，成功后再处理业务。');
}
