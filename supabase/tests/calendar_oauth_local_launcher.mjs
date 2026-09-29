// Offline, disposable test launcher. Never deploy or supply real credentials.
// Requires a synthetic Supabase stack named pepper-oauth-local-gate.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [command, rootArgument, archiveArgument, suite = 'calendar', dependencyRoot] = process.argv.slice(2)
assert.ok(['calendar', 'family', 'preview', 'authorization'].includes(suite), 'Only reviewed local test entrypoints are allowed')
const entrypoint = suite === 'authorization' ? 'calendar_oauth_authorization_worker.mjs' : suite === 'preview' ? 'family_preview_local_worker.mjs' : suite === 'family' ? 'family_beta_local_worker.mjs' : 'calendar_oauth_local_worker.mjs'
assert.ok(['start', 'stop'].includes(command), 'Usage: launcher.mjs start|stop HARNESS_DIR [VERIFIED_POSTGRES_TGZ]')
assert.ok(rootArgument && path.isAbsolute(rootArgument), 'Absolute disposable harness directory required')
const root = path.resolve(rootArgument)
assert.ok(!root.startsWith(source + path.sep) && root !== source, 'Harness must be outside source')
const docker = process.env.DOCKER_BIN || '/opt/homebrew/bin/docker'
const host = process.env.DOCKER_HOST || `unix://${process.env.HOME}/.colima/default/docker.sock`
assert.ok(host.startsWith('unix://'), 'Local Docker socket only')
const database = 'supabase_db_pepper-oauth-local-gate'
const slot = process.env.PEPPER_LOCAL_GATE_SLOT || 'default'
assert.ok(['default', 'auth-repair'].includes(slot), 'Only reviewed local gate slots are allowed')
const network = slot === 'default' ? 'pepper-oauth-local-gate-internal' : 'pepper-oauth-auth-repair-internal'
const worker = slot === 'default' ? 'pepper-oauth-local-gate-worker' : 'pepper-oauth-auth-repair-worker'
const port = slot === 'default' ? 54329 : 54339
const image = 'public.ecr.aws/supabase/edge-runtime:v1.74.3'
const marker = path.join(root, 'launcher-state.json')
const run = (...args) => execFileSync(docker, ['--host', host, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
function cleanup() {
  const state = JSON.parse(fs.readFileSync(marker, 'utf8'))
  assert.deepEqual(state, { source, root, database, network, worker })
  const pidFile = path.join(root, 'tunnel.pid')
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    assert.ok(Number.isInteger(pid) && pid > 1)
    const args = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    assert.ok(args.includes(path.join(root, 'tunnel.mjs')), 'Refuse to stop an unrelated process')
    process.kill(pid, 'SIGTERM')
  }
  const failures = []
  const preview = fs.existsSync(path.join(root, 'preview-marker'))
  for (const args of [['rm', '-f', worker], ...(preview ? [['rm', '-f', 'pepper-local-rest']] : []), ['network', 'disconnect', network, database], ['network', 'rm', network]]) {
    try { run(...args) } catch (error) { failures.push(String(error)) }
  }
  if (failures.length) throw new Error(failures.join('\n'))
  fs.rmSync(root, { recursive: true })
  console.log('Local worker, internal network and dummy harness removed; database retained for explicit stack cleanup.')
}
if (command === 'stop') {
  cleanup()
} else {
  assert.ok(archiveArgument && path.isAbsolute(archiveArgument), 'Verified public driver tarball required; no downloads performed')
  const archive = fs.readFileSync(archiveArgument)
  assert.equal(createHash('sha512').update(archive).digest('base64'),
    'Jtc2612XINuBjIl/QTWsV5UvE8UHuNblcO3vVADSrKsrc6RqGX6lOW1cEo3CM2v0XG4Nat8nI+YM7/f26VxXLw==')
  run('image', 'inspect', image)
  const db = JSON.parse(run('inspect', database))[0]
  assert.equal(db.State.Running, true)
  assert.equal(db.Config.Labels['com.supabase.cli.project'], 'pepper-oauth-local-gate')
  assert.equal(fs.existsSync(root), false, 'Refuse to reuse or overwrite an existing harness')
  assert.equal(run('ps', '-aq', '--filter', `name=^/${worker}$`).trim(), '', 'Worker already exists')
  assert.equal(run('network', 'ls', '-q', '--filter', `name=^${network}$`).trim(), '', 'Network already exists')
  fs.mkdirSync(root, { mode: 0o700 })
  fs.writeFileSync(marker, JSON.stringify({ source, root, database, network, worker }))
  execFileSync('tar', ['-xz', '-C', root], { input: archive })
  const copy = path.join(root, 'candidate/supabase')
  fs.mkdirSync(path.join(copy, 'tests'), { recursive: true })
  fs.cpSync(path.join(source, 'supabase/functions'), path.join(copy, 'functions'), { recursive: true })
  fs.copyFileSync(path.join(source, 'supabase/tests', entrypoint), path.join(copy, 'tests', entrypoint))
  const imports = {}
  if (suite === 'preview') {
    assert.ok(dependencyRoot && path.isAbsolute(dependencyRoot), 'Pinned preview dependencies required')
    const packageInfo = JSON.parse(fs.readFileSync(path.join(dependencyRoot, 'node_modules/@supabase/supabase-js/package.json')))
    assert.equal(packageInfo.version, '2.57.4')
    const { buildSync } = await import(path.join(dependencyRoot, 'node_modules/esbuild/lib/main.js'))
    buildSync({ entryPoints: [path.join(dependencyRoot, 'node_modules/@supabase/supabase-js/dist/module/index.js')], bundle: true, format: 'esm', platform: 'browser', outfile: path.join(root, 'supabase-client.mjs') })
    imports['npm:@supabase/supabase-js@2'] = './supabase-client.mjs'
    imports['npm:postgres@3.4.7'] = './local-postgres.mjs'
    fs.writeFileSync(path.join(root, 'local-postgres.mjs'), `import postgres from './package/src/index.js';
export default function localPostgres(url, options) {
  if (new URL(url).hostname !== 'pepper-oauth-db') throw new Error('Local database only');
  return postgres(url, { ...options, ssl: false });
}\n`)
    fs.writeFileSync(path.join(root, 'preview-marker'), 'synthetic local preview')
  }
  fs.writeFileSync(path.join(root, 'deno.json'), JSON.stringify({ imports: {
    'npm:postgres@3.4.7': './package/src/index.js',
    ...Object.fromEntries(['os', 'fs', 'net', 'tls', 'crypto', 'stream', 'perf_hooks'].map(name => [name, `node:${name}`])),
    ...imports,
  } }))
  fs.writeFileSync(path.join(root, 'index.ts'), `import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setImmediate, clearImmediate } from 'node:timers';
globalThis.Buffer = Buffer;
globalThis.process = process;
globalThis.setImmediate = setImmediate;
globalThis.clearImmediate = clearImmediate;
// Main-worker setEnv is unsupported. Assert the injected dummy values instead.
Deno.env.set = (name, value) => {
  if (Deno.env.get(name) !== value) throw new Error('Dummy environment mismatch: ' + name);
};
await import('./candidate/supabase/tests/${entrypoint}');
`)
  const dummy = {
    SUPABASE_DB_URL: 'postgresql://postgres:postgres@pepper-oauth-db:5432/postgres',
    PEPPER_DB_SSL: 'disable', PEPPER_CALENDAR_MODE: 'sandbox',
    PEPPER_GOOGLE_ACCOUNT_EMAIL: 'pepper-test@example.invalid',
    PEPPER_APP_URL: 'http://127.0.0.1:4189/pepper', SUPABASE_URL: 'http://127.0.0.1:54321',
    GOOGLE_CLIENT_ID: 'pepper-local-dummy-client', GOOGLE_CLIENT_SECRET: 'pepper-local-dummy-secret',
    GOOGLE_REDIRECT_URI: 'http://127.0.0.1:54329/functions/v1/pepper-calendar/callback',
    SUPABASE_SERVICE_ROLE_KEY: 'pepper-local-dummy-service',
  }
  const jwtSecret = 'pepper-local-only-synthetic-jwt-secret-not-for-production'
  if (suite === 'preview') {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 86400 * 30 })}`
    dummy.SUPABASE_SERVICE_ROLE_KEY = `${unsigned}.${createHmac('sha256', jwtSecret).update(unsigned).digest('base64url')}`
  }
  fs.writeFileSync(path.join(root, 'dummy.env'), Object.entries(dummy).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 })
  fs.writeFileSync(path.join(root, 'psql-local'), `#!/bin/sh
set -eu
case "$1" in
  postgresql://postgres:postgres@127.0.0.1:54322/postgres) shift;;
  *) exit 64;;
esac
exec '${docker.replaceAll("'", "'\\''")}' --host '${host.replaceAll("'", "'\\''")}' exec -i ${database} psql -U postgres -d postgres "$@"
`, { mode: 0o700 })
  run('run', '--rm', '--network', 'none', '-v', `${root}:/harness`, '-w', '/harness', image,
    'bundle', '--entrypoint', '/harness/index.ts', '--output', '/harness/worker.eszip')
  run('network', 'create', '--internal', network)
  run('network', 'connect', '--alias', 'pepper-oauth-db', network, database)
  assert.equal(JSON.parse(run('network', 'inspect', network))[0].Internal, true)
  if (suite === 'preview') {
    run('run', '-d', '--name', 'pepper-local-rest', '--network', network,
      '-e', `PGRST_DB_URI=${dummy.SUPABASE_DB_URL}`, '-e', `PGRST_JWT_SECRET=${jwtSecret}`,
      '-e', 'PGRST_DB_SCHEMAS=public', 'public.ecr.aws/supabase/postgrest:v16.2')
  }
  run('run', '-d', '--name', worker, '--network', network,
    '--env-file', path.join(root, 'dummy.env'), '-v', `${root}:/harness:ro`, image,
    'start', '--main-service', '/harness/worker.eszip', '--port', '9000')
  // Internal Docker networks may not publish ports. This fixed loopback tunnel
  // uses Docker's local control socket, without adding an egress-capable network.
  fs.writeFileSync(path.join(root, 'tunnel.mjs'), `import net from 'node:net';
import { spawn } from 'node:child_process';
const children = new Set();
const server = net.createServer(socket => {
  const child = spawn(${JSON.stringify(docker)}, ${JSON.stringify(['--host', host, 'exec', '-i', worker, '/bin/bash', '-c', 'exec 3<>/dev/tcp/127.0.0.1/9000; cat <&3 & reader=$!; cat >&3; wait "$reader"'])}, { stdio: ['pipe', 'pipe', 'ignore'] });
  children.add(child);
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
  child.stdin.on('error', () => socket.destroy());
  child.on('error', () => socket.destroy());
  child.on('close', () => { children.delete(child); socket.destroy(); });
  socket.on('error', () => child.kill());
  socket.on('close', () => child.kill());
});
server.listen(${port}, '127.0.0.1');
process.on('SIGTERM', () => { for (const child of children) child.kill(); server.close(); process.exit(0); });
`)
  const tunnel = spawn(process.execPath, [path.join(root, 'tunnel.mjs')], { detached: true, stdio: 'ignore' })
  fs.writeFileSync(path.join(root, 'tunnel.pid'), String(tunnel.pid))
  tunnel.unref()
  let ready = false
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/functions/v1/${suite === 'preview' ? 'pepper-family-api' : 'pepper-calendar/'}`, {
        method: 'OPTIONS', signal: AbortSignal.timeout(1000), redirect: 'manual',
      })
      ready = response.ok
      if (ready) break
    } catch { /* Bounded startup polling, never follow a provider redirect. */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(ready, 'Worker did not respond: inspect local Docker logs and run launcher stop')
  console.log(JSON.stringify({ ready, endpoint: `http://127.0.0.1:${port}/functions/v1/${suite === 'preview' ? 'pepper-family-api' : 'pepper-calendar/'}`,
    database: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', psql: path.join(root, 'psql-local'),
    networkInternal: true, providerFetch: suite === 'preview' ? 'blocked; no provider handlers loaded' : 'blocked, except labeled failure double' }))
}
