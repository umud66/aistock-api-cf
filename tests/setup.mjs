import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const runtime = resolve('.tmp/runtime');
mkdirSync(runtime, { recursive: true });
process.env.TMPDIR = runtime;
process.env.TMP = runtime;
process.env.TEMP = runtime;
process.env.WRANGLER_LOG_PATH = resolve('.tmp/wrangler.log');
