// -----------------------------------------------------------------------------
// The Gateway client against a real local HTTP server: the request as the
// documentation describes it, every answer mapped, never a redirect followed,
// the answer bounded, nothing secret in an error.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createThreema, ThreemaError } from '../src/threema.js';
import { parseRecipient } from '../src/recipients.js';

const CFG = { identity: '*GLADYS1', secret: 'S3cr3tTestValue9' };

async function server(t, handler) {
  const requests = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(r);
      handler(r, res);
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    return new Promise((resolve) => srv.close(resolve));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  return {
    requests,
    base,
    client: createThreema({ baseUrl: base, userAgent: 'gladys-threema/test' }),
  };
}

const reply =
  (status, body = '', headers = {}) =>
  (r, res) => {
    res.writeHead(status, { 'content-type': 'text/plain', ...headers });
    res.end(body);
  };

test('send_simple: form fields of the documentation, our User-Agent, the message ID', async (t) => {
  const s = await server(t, reply(200, '0A1B2C3D4E5F6789\n'));
  for (const [raw, field, value] of [
    ['ALICE123', 'to', 'ALICE123'],
    ['+41 79 123 45 67', 'phone', '41791234567'],
    ['Jo@Example.org', 'email', 'jo@example.org'],
  ]) {
    const result = await s.client.send(CFG, parseRecipient(raw), 'Bonjour & à+ = ok', undefined);
    assert.deepEqual(result, { messageId: '0a1b2c3d4e5f6789' });
    const r = s.requests.at(-1);
    assert.equal(r.method, 'POST');
    assert.equal(r.url, '/send_simple');
    assert.equal(r.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(r.headers['user-agent'], 'gladys-threema/test');
    const form = new URLSearchParams(r.body);
    assert.deepEqual([...form.keys()], ['from', field, 'text', 'secret']);
    assert.equal(form.get('from'), '*GLADYS1');
    assert.equal(form.get(field), value);
    assert.equal(form.get('text'), 'Bonjour & à+ = ok');
    assert.equal(form.get('secret'), CFG.secret);
  }
});

test('a 200 without a readable ID is still a sent message', async (t) => {
  const s = await server(t, reply(200, 'something else'));
  assert.deepEqual(await s.client.send(CFG, parseRecipient('ALICE123'), 'x'), { messageId: null });
  // Over 1 KB: not read further (the ID at its start is not trusted).
  const padded = await server(t, reply(200, `0A1B2C3D4E5F6789${' '.repeat(5000)}`));
  assert.deepEqual(await padded.client.send(CFG, parseRecipient('ALICE123'), 'x'), {
    messageId: null,
  });
  const big = await server(t, reply(200, 'x'.repeat(10_000)));
  assert.deepEqual(await big.client.send(CFG, parseRecipient('ALICE123'), 'x'), {
    messageId: null,
  });
});

test('every answer of the documentation mapped; 4xx = not sent, 5xx = may have left', async (t) => {
  const cases = [
    [400, 'bad_recipient', false],
    [401, 'refused', false],
    [402, 'no_credits', false],
    [404, 'not_found', false],
    [413, 'too_long', false],
    [429, 'throttled', false],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
    [418, 'unexpected', false],
    [302, 'unexpected', false],
  ];
  for (const [status, kind, sent] of cases) {
    const s = await server(
      t,
      reply(status, `error ${CFG.secret}`, { location: 'http://127.0.0.1:1/' }),
    );
    const err = await s.client.send(CFG, parseRecipient('ALICE123'), 'x').catch((e) => e);
    assert.ok(err instanceof ThreemaError, String(status));
    assert.equal(err.kind, kind, String(status));
    assert.equal(err.sent, sent, String(status));
    assert.equal(err.status, status);
    assert.ok(!err.message.includes(CFG.secret));
    assert.equal(s.requests.length, 1, 'no redirect followed, no retry');
  }
});

test('Retry-After read (seconds only)', async (t) => {
  const s = await server(t, reply(429, '', { 'retry-after': '120' }));
  const err = await s.client.send(CFG, parseRecipient('ALICE123'), 'x').catch((e) => e);
  assert.equal(err.retryAfterMs, 120_000);
  const d = await server(t, reply(429, '', { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' }));
  const err2 = await d.client.send(CFG, parseRecipient('ALICE123'), 'x').catch((e) => e);
  assert.equal(err2.retryAfterMs, undefined);
});

test('credits: GET with from and secret, a number; 401 refused; garbage refused', async (t) => {
  const s = await server(t, reply(200, '1234\n'));
  assert.equal(await s.client.credits(CFG), 1234);
  const r = s.requests[0];
  assert.equal(r.method, 'GET');
  const url = new URL(r.url, 'http://x');
  assert.equal(url.pathname, '/credits');
  assert.equal(url.searchParams.get('from'), '*GLADYS1');
  assert.equal(url.searchParams.get('secret'), CFG.secret);
  const refused = await server(t, reply(401));
  assert.equal((await refused.client.credits(CFG).catch((e) => e)).kind, 'refused');
  // 400 and 404 on the credits path are not about a recipient.
  const other = await server(t, reply(404));
  assert.equal((await other.client.credits(CFG).catch((e) => e)).kind, 'unexpected');
  for (const body of ['', 'abc', '-1', '1.5', 'x'.repeat(5000), `7${' '.repeat(5000)}`]) {
    const g = await server(t, reply(200, body));
    assert.equal(
      (await g.client.credits(CFG).catch((e) => e)).kind,
      'bad_answer',
      body.slice(0, 5),
    );
  }
});

test('a refused connection is "not sent"; an abort after sending is "may have left"', async (t) => {
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const client = createThreema({ baseUrl: `http://127.0.0.1:${port}` });
  const err = await client.send(CFG, parseRecipient('ALICE123'), 'x').catch((e) => e);
  assert.equal(err.kind, 'network');
  assert.equal(err.sent, false);

  const s = await server(t, () => {}); // never answers
  const controller = new AbortController();
  const pending = s.client.send(CFG, parseRecipient('ALICE123'), 'x', controller.signal);
  const deadline = Date.now() + 5000;
  while (!s.requests.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  const err2 = await pending.catch((e) => e);
  assert.equal(err2.kind, 'timeout');
  assert.equal(err2.sent, true);
  assert.equal(s.requests.length, 1);
});
