import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const known = (value, values) => values.includes(value) ? value : undefined;

export async function loadSmokeConfig(env = process.env) {
  let file;
  try {
    const origin = new URL(env.CLASSROOM_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.CLASSROOM_ORIGIN ||
        env.CLASSROOM_ORIGIN !== env.SMOKE_ALLOWED_ORIGIN) throw new Error();
    file = await open(env.CLASSROOM_CREDENTIAL_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 65536) throw new Error();
    const credentials = JSON.parse(await file.readFile('utf8'));
    for (const role of ['mentor', 'mentee']) {
      const account = credentials.accounts?.[role];
      if (!positiveId(account?.id) || typeof account.email !== 'string' || !account.email.endsWith('.edu') ||
          typeof account.password !== 'string' || !account.password) throw new Error();
    }
    if (credentials.accounts.mentor.id === credentials.accounts.mentee.id ||
        credentials.accounts.mentor.email === credentials.accounts.mentee.email ||
        !positiveId(credentials.fixtures?.questionId) || !positiveId(credentials.fixtures?.globalRoomId) ||
        !Array.isArray(credentials.fixtures.districtIds) || !credentials.fixtures.districtIds.length ||
        !credentials.fixtures.districtIds.every(positiveId)) throw new Error();
    return { origin: origin.origin, credentials };
  } catch {
    // Never print parser, filesystem, Playwright, or response errors: they may contain secrets.
    throw new Error('smoke_configuration_invalid');
  } finally { await file?.close(); }
}

export function classifyResponse(httpStatus, body) {
  if (httpStatus < 200 || httpStatus >= 300) return { status: 'transport-failure' };
  if (httpStatus === 204 || Array.isArray(body)) return { status: 'pass' };
  if (!object(body)) return { status: 'transport-failure' };
  if (body.status === 'todo' && Number.isInteger(body.mission)) {
    return { status: 'learning-incomplete', envelope: { status: 'todo', mission: body.mission } };
  }
  const module = object(body.student_module) ? body.student_module : {};
  const envelope = {
    ok: typeof body.ok === 'boolean' ? body.ok : undefined,
    success: typeof body.success === 'boolean' ? body.success : undefined,
    source: known(body.source, ['python', 'student-module', 'adapter-fallback']),
    status: known(body.status, ['connected', 'todo/not implemented', 'runtime error', 'import error', 'syntax error', 'missing function', 'unavailable']),
    student_module: {
      module: known(module.module, ['analysis', 'scheduling', 'reports', 'find_matches', 'locations', 'get_blocks']),
      status: known(module.status, ['connected', 'called', 'import ok', 'runtime error', 'import error', 'syntax error', 'missing function', 'invalid output']),
      importable: typeof module.importable === 'boolean' ? module.importable : undefined,
      called: typeof module.called === 'boolean' ? module.called : undefined,
    },
  };
  const learning = body.ok === false || body.success === false || body.is_todo === true ||
    body.source === 'adapter-fallback' || module.importable === false || Boolean(module.error);
  if ((typeof body.ok === 'boolean' || typeof body.success === 'boolean') &&
      (envelope.source || typeof body.feature === 'string' || typeof body.module_name === 'string')) {
    return { status: learning ? 'learning-incomplete' : 'pass', envelope };
  }
  return { status: positiveId(body.id) || positiveId(body.user?.id) ? 'pass' : 'transport-failure' };
}

// Browser injection is for the disposable TLS harness; the CLI always uses normal certificate verification.
export async function runSmoke({ origin, credentials }, browser, emit = record => console.log(JSON.stringify(record))) {
  const records = [];
  const contexts = [];
  const record = (task, start, result, requestId = null, httpStatus = null) => {
    const entry = { task, ...result, requestId, httpStatus, elapsedMs: Math.round(performance.now() - start) };
    records.push(entry);
    emit(entry);
  };
  const requestId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
  const check = async (page, task, route, { method = 'GET', body, verify = () => true } = {}) => {
    const start = performance.now();
    try {
      const response = await page.evaluate(async ({ route, method, body }) => {
        const result = await fetch(route, { method, credentials: 'include', redirect: 'error',
          signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : {
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          }) });
        return { httpStatus: result.status, requestId: result.headers.get('x-request-id'),
          body: result.status === 204 ? null : await result.json() };
      }, { route, method, body });
      const result = classifyResponse(response.httpStatus, response.body);
      if (result.status === 'pass' && !verify(response.body)) result.status = 'transport-failure';
      record(task, start, result, requestId(response.requestId), response.httpStatus);
      return result.status === 'pass' ? response.body : undefined;
    } catch { record(task, start, { status: 'transport-failure' }); }
  };
  const socketCheck = async (page, task, route, message, mission) => {
    const start = performance.now();
    let handshakeId = null;
    let cdp;
    try {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      cdp.on('Network.webSocketHandshakeResponseReceived', ({ response }) => {
        handshakeId = requestId(Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'x-request-id')?.[1]);
      });
      const result = await page.evaluate(({ route, message, mission }) => new Promise(resolve => {
        const url = new URL(route, location.href);
        url.protocol = 'wss:';
        const socket = new WebSocket(url);
        let todo = false;
        const finish = result => { clearTimeout(timer); socket.close(); resolve(result); };
        const timer = setTimeout(() => finish({ status: 'transport-failure' }), 10000);
        socket.onopen = () => { if (message) socket.send(message); };
        socket.onmessage = event => {
          let value;
          try { value = JSON.parse(event.data); } catch { return finish({ status: 'transport-failure' }); }
          if (mission && value.status === 'todo' && value.mission === mission) todo = true;
          else if (!mission && value.body === message) finish({ status: 'pass' });
          else finish({ status: 'transport-failure' });
        };
        socket.onerror = () => finish({ status: 'transport-failure' });
        socket.onclose = event => finish(todo && event.code === 1000
          ? { status: 'learning-incomplete', envelope: { status: 'todo', mission } }
          : { status: 'transport-failure' });
      }), { route, message, mission });
      record(task, start, result, handshakeId);
    } catch { record(task, start, { status: 'transport-failure' }, handshakeId); }
    finally { await cdp?.detach(); }
  };
  try {
    const pages = {};
    for (const role of ['mentor', 'mentee']) {
      const start = performance.now();
      const context = await browser.newContext({ serviceWorkers: 'block' });
      contexts.push(context);
      // Block redirects and cross-origin subrequests before they can carry login data.
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      let loginResponse;
      try {
        await page.goto(`${origin}/login`);
        await page.getByLabel('School email').fill(credentials.accounts[role].email);
        await page.getByLabel('Password', { exact: true }).fill(credentials.accounts[role].password);
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        loginResponse = await response;
        await page.waitForURL(`${origin}/dashboard`);
        const user = await loginResponse.json();
        if (loginResponse.status() !== 200 || user.user?.id !== credentials.accounts[role].id) throw new Error();
        record(`login.${role}`, start, { status: 'pass' }, requestId(loginResponse.headers()['x-request-id']), 200);
        pages[role] = page;
      } catch { record(`login.${role}`, start, { status: 'transport-failure' }, requestId(loginResponse?.headers()['x-request-id']), loginResponse?.status() ?? null); }
    }
    if (!pages.mentor || !pages.mentee) return records;
    const { mentor, mentee } = pages;
    const mentorId = credentials.accounts.mentor.id;
    const menteeId = credentials.accounts.mentee.id;
    const self = await check(mentor, 'profile.session', '/api/auth/me', { verify: value => value.id === mentorId });
    const summary = value => value && Object.keys(value).sort().join(',') === 'createdAt,id,name,subjects';
    await check(mentor, 'profile.own-summary', `/api/users/${mentorId}`, { verify: summary });
    await check(mentor, 'profile.other-summary', `/api/users/${menteeId}`, { verify: summary });
    if (self) await check(mentor, 'profile.self-patch', `/api/users/${mentorId}`, {
      method: 'PATCH', body: { name: self.name }, verify: value => value.id === mentorId && value.name === self.name,
    });
    await check(mentor, 'districts.list', '/api/districts', { verify: Array.isArray });
    await check(mentor, 'requests.list', '/api/requests', { verify: Array.isArray });
    const canary = `classroom-smoke-${randomUUID()}`;
    let created;
    try {
      created = await check(mentor, 'requests.create', '/api/requests', { method: 'POST', body: {
        districtId: credentials.fixtures.districtIds[0], title: canary, description: 'Synthetic classroom smoke check', role: 'mentor', tagIds: [], preferredTimes: [],
      }, verify: value => positiveId(value.id) && value.authorId === mentorId && value.title === canary });
      if (created) await check(mentor, 'requests.read-created', `/api/requests/${created.id}`, { verify: value => value.id === created.id && value.title === canary });
    } finally {
      if (created) await check(mentor, 'requests.cleanup-created', `/api/requests/${created.id}`, { method: 'DELETE', verify: value => value === null });
    }
    const room = credentials.fixtures.globalRoomId;
    await check(mentor, 'chat.rooms', '/api/chat/rooms', { verify: value => Array.isArray(value) && value.some(row => row.id === room) });
    const restMessage = `${canary}-rest`;
    const sent = await check(mentor, 'chat.room-rest-send', `/api/chat/rooms/${room}/messages`, { method: 'POST', body: { body: restMessage }, verify: value => value.body === restMessage && value.senderId === mentorId });
    if (sent) await check(mentee, 'chat.room-rest-other-read', `/api/chat/rooms/${room}/messages`, { verify: value => Array.isArray(value) && value.filter(row => row.body === restMessage).length === 1 });
    await socketCheck(mentor, 'chat.mission-4-room-ws', `/ws/chat/rooms/${room}`, canary);
    await check(mentee, 'chat.room-ws-other-read-once', `/api/chat/rooms/${room}/messages`, { verify: value => Array.isArray(value) && value.filter(row => row.body === canary && row.senderId === mentorId).length === 1 });
    const dm = await check(mentor, 'chat.dm-start', '/api/dms/start', { method: 'POST', body: { toUserId: menteeId }, verify: value => positiveId(value.id) && value.otherUserId === menteeId });
    if (dm) {
      await check(mentor, 'chat.mission-7-dm-history', `/api/dms/${dm.id}/messages`);
      await socketCheck(mentor, 'chat.mission-8-dm-ws', `/ws/dms/${dm.id}`, undefined, 8);
    }
    for (const [task, route] of [
      ['matching.find_matches', `/api/matches/${credentials.fixtures.questionId}?limit=5`],
      ['analysis.status', '/api/analysis/status'],
      ['analysis.weekly-matches', '/api/analytics/weekly-matches'],
      ['analysis.popular-subjects', '/api/analytics/popular-subjects'],
      ['scheduling.popular-time-slots', '/api/analytics/popular-time-slots'],
      ['analysis.mentor-response-rates', '/api/analytics/mentor-response-rates'],
      ['scheduling.status', '/api/scheduling/status'],
      ['scheduling.overview', '/api/scheduling/overview'],
      ['scheduling.suggest', `/api/scheduling/suggest?user_a=${mentorId}&user_b=${menteeId}`],
      ['reports.summary', '/api/python-reports/summary'],
      ['reports.flagged-users', '/api/admin/flagged-users'],
    ]) await check(mentor, task, route);
    return records;
  } finally { for (const context of contexts) await context.close(); }
}

async function main() {
  let browser;
  const start = performance.now();
  try {
    const config = await loadSmokeConfig();
    browser = await chromium.launch();
    const records = await runSmoke(config, browser);
    process.exitCode = records.some(record => record.status === 'transport-failure') ? 1 : 0;
  } catch {
    console.log(JSON.stringify({ task: 'smoke.setup', status: 'transport-failure', requestId: null, elapsedMs: Math.round(performance.now() - start) }));
    process.exitCode = 1;
  } finally { await browser?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
