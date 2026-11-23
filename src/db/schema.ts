import { migrations } from '../../.tmp/generated/migrations';

export class SchemaMigrationError extends Error {}
const ready=new WeakMap<D1Database,Promise<void>>();

/** Repair a deployment that bypassed the npm deploy/build hooks, using the actual bound DB. */
export async function ensureSchema(db: D1Database|undefined): Promise<void> {
    if(!db)throw new SchemaMigrationError('未绑定数据库，请在 Cloudflare 的 Bindings 中绑定名称为 DB 的 D1 数据库');
    let pending=ready.get(db);
    if(!pending){
        pending=apply(db);
        ready.set(db,pending);
        pending.catch(()=>ready.delete(db));
    }
    return pending;
}

async function apply(db:D1Database) {
    let current='迁移记录表';
    try{
        await db.prepare(`CREATE TABLE IF NOT EXISTS stockwatch_schema_migrations(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )`).run();
        const applied=await db.prepare('SELECT name FROM stockwatch_schema_migrations').all<{name:string}>();
        const known=new Set(applied.results.map(row=>row.name));
        for(const migration of migrations){
            if(known.has(migration.name))continue;
            current=migration.name;
            try{
                await db.batch([
                    ...migration.statements.map(sql=>db.prepare(sql)),
                    db.prepare('INSERT INTO stockwatch_schema_migrations(name) VALUES(?)').bind(migration.name),
                ]);
                console.log('[SchemaMigration] applied',migration.name);
            }catch(error){
                // Another isolate/native deploy may have committed this migration first.
                const completed=await db.prepare('SELECT name FROM stockwatch_schema_migrations WHERE name=?').bind(migration.name).first();
                if(!completed)throw error;
            }
        }
    }catch(error){
        console.error('[SchemaMigration]',current,error instanceof Error?error.message:'D1 operation failed');
        throw new SchemaMigrationError(`数据库自动更新失败（${current}），请查看 Cloudflare 构建或运行日志中的 SchemaMigration 错误`);
    }
}
