// Isolated, synthetic upstream for built-gateway browser tests; never an app fallback.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fixtureAccounts, fixturePassword, fixtureRooms, fixtures, request as initialRequest, tag, district } from './fixtures.ts';

let accounts, requests, messages, sessions, failures, nextRequestId;
function reset() {
  accounts = structuredClone(fixtureAccounts);
  requests = [structuredClone(initialRequest)];
  messages = [];
  sessions = new Map();
  failures = new Map();
  nextRequestId = 100;
}
reset();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:18181');
  const path = url.pathname;
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(status === 204 ? undefined : JSON.stringify(body));
  };
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
      if (chunks.reduce((sum, item) => sum + item.length, 0) > 65536) return send(413, { detail: 'Fixture body too large' });
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    // Test controls are available only directly on the fixed loopback fixture port.
    if (path === '/__fixture/reset' && req.method === 'POST') { reset(); return send(200, { reset: true }); }
    if (path === '/__fixture/failure' && req.method === 'POST') {
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(body.method) || typeof body.path !== 'string' ||
          !body.path.startsWith('/api/') || !Number.isInteger(body.status) || body.status < 200 || body.status > 599) return send(400, { detail: 'Invalid scenario' });
      failures.set(`${body.method} ${body.path}`, body);
      return send(200, { configured: true });
    }
    const failure = failures.get(`${req.method} ${path}`);
    if (failure) return send(failure.status, failure.body);
    if (path === '/api/auth/login' && req.method === 'POST') {
      const account = Object.values(accounts).find(account => account.email === body.email && body.password === fixturePassword);
      if (!account) return send(401, { detail: 'Invalid email or password' });
      const session = randomUUID();
      sessions.set(session, account.id);
      res.setHeader('Set-Cookie', `peerbridge_session=${session}; HttpOnly; SameSite=Lax; Path=/`);
      return send(200, { user: account, message: 'Logged in successfully' });
    }
    if (req.method === 'GET' && ['/api/healthz', '/'].includes(path)) return send(200, { status: 'ok' });
    if (req.method === 'GET' && path === '/api/districts') return send(200, [district]);
    if (req.method === 'GET' && path === '/api/stats/overview') return send(200, fixtures[path]);
    const session = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('peerbridge_session='))?.slice('peerbridge_session='.length);
    const user = Object.values(accounts).find(account => account.id === sessions.get(session));
    if (!user) return send(401, { detail: 'Not authenticated' });
    if (path === '/api/auth/me' && req.method === 'GET') return send(200, user);
    if (path === '/api/auth/logout' && req.method === 'POST') {
      sessions.delete(session);
      res.setHeader('Set-Cookie', 'peerbridge_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
      return send(200, { message: 'Logged out successfully' });
    }
    const userMatch = path.match(/^\/api\/users\/(\d+)$/);
    if (userMatch) {
      const target = Object.values(accounts).find(account => account.id === Number(userMatch[1]));
      if (!target) return send(404, { detail: 'User not found' });
      if (req.method === 'PATCH') {
        if (target.id !== user.id) return send(403, { detail: 'Forbidden' });
        for (const key of ['name', 'bio', 'subjects']) if (body[key] !== undefined) target[key] = body[key];
      }
      if (['GET', 'PATCH'].includes(req.method)) return send(200, target);
    }
    if (path === '/api/requests' && req.method === 'GET') return send(200, requests.filter(item =>
      item.status === (url.searchParams.get('status') ?? 'open') &&
      (!url.searchParams.has('districtId') || item.districtId === Number(url.searchParams.get('districtId'))) &&
      (!url.searchParams.has('role') || item.authorRole === url.searchParams.get('role')) &&
      (!url.searchParams.has('tagId') || item.tags.some(tag => tag.id === Number(url.searchParams.get('tagId'))))));
    if (path === '/api/requests' && req.method === 'POST') {
      const item = { ...structuredClone(initialRequest), id: nextRequestId++, authorId: user.id, authorName: user.name,
        authorRole: body.role, districtId: body.districtId, title: body.title, description: body.description,
        tags: body.tagIds?.includes(tag.id) ? [tag] : [], preferredTimes: body.preferredTimes ?? [] };
      requests.push(item);
      return send(201, item);
    }
    const requestMatch = path.match(/^\/api\/requests\/(\d+)(\/match)?$/);
    if (requestMatch) {
      const item = requests.find(item => item.id === Number(requestMatch[1]));
      if (!item) return send(404, { detail: 'Request not found' });
      if (requestMatch[2] && req.method === 'POST') {
        if (item.status !== 'open') return send(409, { detail: 'Request is no longer open' });
        Object.assign(item, { status: 'matched', matchedUserId: user.id, matchedUserName: user.name });
        return send(200, item);
      }
      if (req.method === 'GET') return send(200, item);
      if (item.authorId !== user.id) return send(403, { detail: 'Forbidden' });
      if (req.method === 'PATCH') {
        for (const key of ['title', 'description', 'status']) if (body[key] !== undefined) item[key] = body[key];
        if (body.tagIds) item.tags = body.tagIds.includes(tag.id) ? [tag] : [];
        return send(200, item);
      }
      if (req.method === 'DELETE') { requests = requests.filter(row => row.id !== item.id); return send(204); }
    }
    if (path === '/api/chat/rooms' && req.method === 'GET') return send(200, fixtureRooms);
    if (path === '/api/chat/rooms/1/messages') {
      if (req.method === 'POST') {
        if (typeof body.body !== 'string' || !body.body.trim()) return send(400, { detail: 'Empty message' });
        const message = { id: messages.length + 1, roomId: 1, senderId: user.id, senderName: user.name, body: body.body.trim(), createdAt: new Date().toISOString() };
        messages.push(message);
        return send(201, message);
      }
      if (req.method === 'GET') return send(200, messages);
    }
    if (path === '/api/dms' && req.method === 'GET') return send(200, [{ id: 1, otherUserId: user.id === 1 ? 2 : 1, otherUserName: user.id === 1 ? accounts.mentee.name : accounts.mentor.name, createdAt: '2026-09-09T00:00:00Z' }]);
    if (/^\/api\/dms\/\d+\/messages$/.test(path)) return send(200, { status: 'todo', mission: 7, message: 'Complete Mission 7', guide: 'docs/STUDENT_CHAT_BACKEND_GUIDE.md' });
    if (path === '/api/blocks' && req.method === 'GET') return send(200, []);
    if (path === '/api/matches/1' && req.method === 'GET') return send(200, fixtures['/api/practice/matching/1']);
    if (req.method === 'GET' && Object.hasOwn(fixtures, path)) return send(200, fixtures[path]);
    return send(404, { detail: 'No fixture for this route' });
  } catch { if (!res.headersSent) send(400, { detail: 'Invalid fixture request' }); else res.end(); }
});
server.on('error', () => { console.error('Fixture server failed to bind 127.0.0.1:18181'); process.exitCode = 1; });
server.listen(18181, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
