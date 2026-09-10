const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { app } = require('../server');

const publicDir = path.join(__dirname, '..', 'public');
const appSource = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

let server;
let baseUrl;
let cookie;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test.beforeEach(async () => {
  cookie = undefined;
  await request('/api/reset', { method: 'POST' });
});

async function request(url, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(baseUrl + url, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';', 1)[0];
  return response;
}

async function jsonRequest(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test('1. status filters are case-insensitive', async () => {
  const response = await request('/api/checks?status=verified');
  const checks = await response.json();
  assert.deepEqual(checks.map((check) => check.id), [1]);
});

test('2. insufficiency badge uses the legend background color', () => {
  assert.match(appSource, /INSUFFICIENCY:\s*"#f1d8d8"/);
});

test('3. type filter defaults to All Types', () => {
  assert.match(htmlSource, /<option value=""[^>]*>All Types<\/option>\s*<option value="EDUCATION"/);
  assert.doesNotMatch(htmlSource, /<option value="IDENTITY"[^>]*>Identity<\/option>\s*<option value="">All Types/);
});

test('4. invalid statuses are rejected by PATCH', async () => {
  const { response } = await jsonRequest('/api/checks/1/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'NOT_A_STATUS' }),
  });
  assert.equal(response.status, 400);
});

test('5. POST rejects unknown candidates and duplicate active checks', async () => {
  const unknown = await jsonRequest('/api/checks', {
    method: 'POST',
    body: JSON.stringify({ candidateId: 999, type: 'IDENTITY' }),
  });
  assert.equal(unknown.response.status, 400);

  const duplicate = await jsonRequest('/api/checks', {
    method: 'POST',
    body: JSON.stringify({ candidateId: 1, type: 'IDENTITY' }),
  });
  assert.equal(duplicate.response.status, 400);
});

test('6. new checks use the PENDING status enum', async () => {
  const { response, body } = await jsonRequest('/api/checks', {
    method: 'POST',
    body: JSON.stringify({ candidateId: 4, type: 'ADDRESS' }),
  });
  assert.equal(response.status, 201);
  assert.equal(body.status, 'PENDING');
});

test('7. Add Check disables itself while the request is pending', () => {
  assert.match(appSource, /addCheckButton\.disabled\s*=\s*true/);
});

test('8. multiple filters use AND logic', async () => {
  const response = await request('/api/checks?status=VERIFIED&type=ADDRESS');
  const checks = await response.json();
  assert.deepEqual(checks, []);
});

test('9. candidate ID filtering is exact', async () => {
  await jsonRequest('/api/checks', {
    method: 'POST',
    body: JSON.stringify({ candidateId: 10, type: 'ADDRESS' }),
  });
  const response = await request('/api/checks?candidateId=1');
  const checks = await response.json();
  assert.deepEqual(checks.map((check) => check.id), [1, 2]);
});

test('10. missing checks return 404', async () => {
  const response = await request('/api/checks/999');
  assert.equal(response.status, 404);
});

test('11. single-check responses exclude internal fields', async () => {
  const response = await request('/api/checks/1');
  const check = await response.json();
  assert.equal('deletedAt' in check, false);
  assert.equal('internalNotes' in check, false);
  assert.equal('rawPayload' in check, false);
});

test('12. row Update buttons disable themselves while saving', () => {
  assert.match(appSource, /row-update[\s\S]*?disabled\s*=\s*true/);
});

test('13. row status dropdown selects the current status', () => {
  assert.match(appSource, /s\s*===\s*c\.status\s*\?\s*" selected"/);
});

test('14. boolean status payloads return 400 instead of 500', async () => {
  const { response } = await jsonRequest('/api/checks/1/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: true }),
  });
  assert.equal(response.status, 400);
});