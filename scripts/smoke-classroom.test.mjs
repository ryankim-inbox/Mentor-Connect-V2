import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSmokeConfig, classifyResponse } from './smoke-classroom.mjs';

test('smoke refuses unsafe origins and credential files before launching a browser', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classroom-smoke-test-'));
  const file = path.join(dir, 'credentials.json');
  const credentials = { accounts: { mentor: { id: 1, email: 'a@example.edu', password: 'synthetic-only' }, mentee: { id: 2, email: 'b@example.edu', password: 'synthetic-only' } }, fixtures: { questionId: 1, globalRoomId: 1, districtIds: [1, 2] } };
  const env = { CLASSROOM_ORIGIN: 'https://classroom.example.edu', SMOKE_ALLOWED_ORIGIN: 'https://classroom.example.edu', CLASSROOM_CREDENTIAL_FILE: file };
  try {
    await writeFile(file, JSON.stringify(credentials), { mode: 0o600 });
    assert.equal((await loadSmokeConfig(env)).origin, env.CLASSROOM_ORIGIN);
    for (const origin of ['http://classroom.example.edu', 'https://other.example.edu', 'https://classroom.example.edu/path', 'https://secret@classroom.example.edu', 'https://classroom.example.edu?x=1']) {
      await assert.rejects(loadSmokeConfig({ ...env, CLASSROOM_ORIGIN: origin }), /smoke_configuration_invalid/);
    }
    await chmod(file, 0o644);
    await assert.rejects(loadSmokeConfig(env), /smoke_configuration_invalid/);
    await chmod(file, 0o600);
    await symlink(file, path.join(dir, 'link'));
    await assert.rejects(loadSmokeConfig({ ...env, CLASSROOM_CREDENTIAL_FILE: path.join(dir, 'link') }), /smoke_configuration_invalid/);
    await writeFile(file, JSON.stringify({ ...credentials, accounts: { mentor: credentials.accounts.mentor, mentee: credentials.accounts.mentor } }));
    await assert.rejects(loadSmokeConfig(env), /smoke_configuration_invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('smoke separates learning envelopes from transport failure without retaining raw errors', () => {
  assert.equal(classifyResponse(200, []).status, 'pass');
  assert.equal(classifyResponse(504, { error: 'upstream_timeout' }).status, 'transport-failure');
  assert.equal(classifyResponse(200, null).status, 'transport-failure');
  assert.equal(classifyResponse(200, { arbitrary: true }).status, 'transport-failure');
  assert.equal(classifyResponse(200, { status: 'todo', mission: 7, message: 'private content' }).status, 'learning-incomplete');
  const failure = classifyResponse(200, { ok: false, success: false, source: 'python', feature: 'analysis', student_module: { module: 'analysis', status: 'runtime error', importable: true, error: 'private secret' }, error: 'private secret', data: null });
  assert.equal(failure.status, 'learning-incomplete');
  assert.equal(failure.envelope.student_module.status, 'runtime error');
  assert.doesNotMatch(JSON.stringify(failure), /private|secret/);
  assert.equal(classifyResponse(200, { success: false, feature: 'matching', status: 'runtime error', matches: [] }).status, 'learning-incomplete');
  assert.equal(classifyResponse(200, { ok: true, success: true, source: 'python', feature: 'analysis', data: [] }).status, 'pass');
});

async function exerciseFixture() {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const child = spawn(process.execPath, ['e2e/fixtures.mjs'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const origin = 'http://127.0.0.1:18181';
  const request = (route, method = 'GET', body, cookie) => fetch(origin + route, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        child.off('error', failed);
        child.off('exit', failed);
        child.off('message', ready);
        error ? reject(error) : resolve();
      };
      const failed = () => finish(new Error('Fixture child exited before acquiring its port'));
      const ready = message => message === 'fixture-ready' ? finish() : failed();
      const timer = setTimeout(failed, 5000);
      child.once('error', failed);
      child.once('exit', failed);
      child.once('message', ready);
    });
    assert.equal((await request('/api/auth/me')).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'mentor@classroom.example.edu', password: 'incorrect' })).status, 401);
    const login = await request('/api/auth/login', 'POST', { email: 'mentor@classroom.example.edu', password: 'classroom-fixture-pass' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('/api/auth/me', 'GET', undefined, cookie)).json()).id, 1);
    assert.equal((await (await request('/api/users/1', 'PATCH', { bio: '' }, cookie)).json()).bio, '');
    const created = await (await request('/api/requests', 'POST', { districtId: 1, role: 'mentor', title: 'Synthetic test request', description: 'Test only' }, cookie)).json();
    assert.equal(created.authorId, 1);
    assert.equal((await request(`/api/requests/${created.id}`, 'DELETE', undefined, cookie)).status, 204);
    assert.equal((await request(`/api/requests/${created.id}`, 'GET', undefined, cookie)).status, 404);
    await request('/api/chat/rooms/1/messages', 'POST', { body: 'Synthetic fixture canary' }, cookie);
    const otherLogin = await request('/api/auth/login', 'POST', { email: 'mentee@classroom.example.edu', password: 'classroom-fixture-pass' });
    const otherCookie = otherLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('/api/chat/rooms/1/messages', 'GET', undefined, otherCookie)).json()).filter(row => row.body === 'Synthetic fixture canary').length, 1);
    await request('/api/auth/logout', 'POST', undefined, cookie);
    assert.equal((await request('/api/auth/me', 'GET', undefined, cookie)).status, 401);
    const collision = spawn(process.execPath, ['e2e/fixtures.mjs'], { stdio: 'ignore' });
    assert.equal((await once(collision, 'exit'))[0], 1);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await once(child, 'exit');
  }
}
test('loopback fixture enforces cookie sessions, persists edits/messages, and refuses an occupied port', exerciseFixture);

test('fixture self-test never sends traffic to an existing listener on its port', async () => {
  const { createServer } = await import('node:http');
  let requests = 0;
  const existing = createServer((req, res) => {
    requests++;
    res.writeHead(req.url === '/api/healthz' ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve, reject) => { existing.once('error', reject); existing.listen(18181, '127.0.0.1', resolve); });
  try {
    await assert.rejects(exerciseFixture);
    assert.equal(requests, 0, 'The pre-existing listener must receive no probes or mutations');
  } finally {
    existing.closeAllConnections();
    await new Promise(resolve => existing.close(resolve));
  }
});
