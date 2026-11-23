import { mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function generateMigrations(root=process.cwd()) {
    const directory=resolve(root,'.tmp/generated');
    mkdirSync(directory,{recursive:true});
    process.env.WRANGLER_LOG_PATH ??= resolve(root,'.tmp/wrangler.log');
    // Use Wrangler's SQL parser at build time; no SQL parsing or Node dependency in the Worker.
    const {unstable_splitSqlQuery}=await import('wrangler');
    const files=readdirSync(resolve(root,'migrations')).filter(name=>/^\d+_[a-z0-9_]+\.sql$/i.test(name))
        .sort((a,b)=>parseInt(a)-parseInt(b));
    const migrations=files.map(name=>({name,statements:unstable_splitSqlQuery(readFileSync(resolve(root,'migrations',name),'utf8'))}));
    const output='// Generated from migrations/*.sql. Do not edit.\nexport const migrations = '+JSON.stringify(migrations,null,2)+' as const;\n';
    const path=resolve(directory,'migrations.ts');
    let old='';try{old=readFileSync(path,'utf8');}catch{/* First build. */}
    if(old!==output)writeFileSync(path,output);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))await generateMigrations();
