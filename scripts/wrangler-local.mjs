import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const runtime = resolve('.tmp/runtime');
mkdirSync(runtime, { recursive: true });
// Local secrets come from the launching shell, without writing credentials to files.
const localEnvironment = process.argv[2] === 'dev' ? {
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
} : {};
const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ...localEnvironment, TMPDIR: runtime, TMP: runtime, TEMP: runtime,
        WRANGLER_LOG_PATH: resolve('.tmp/wrangler.log'), npm_config_cache: resolve('.tmp/npm-cache') },
});
child.on('error', () => { console.error('无法启动 Wrangler，请先运行 npm install'); process.exitCode = 1; });
child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
});
