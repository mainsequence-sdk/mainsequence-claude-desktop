const test = require('node:test');
const assert = require('node:assert/strict');
const { createNodeHost } = require('@dev-mainsequence/devtools');
const { createClaudeAgentIcons, nativeAgentIcon, agentIconStill } = require('../dist/hosts/claudeAgentIcons');
const { animatedIcon } = require('./agent-icon-fixture.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = 'icons@example.test', backend = 'https://platform.example', base = `/api/v1/command-center/agents/${id(1)}/icon/`;
const input = { action: 'agent-icons', backend, environmentUid: id(2), expectedAccount: account, agentUids: [id(1)] };
const icon = { rendering: 'color', imageRendering: 'pixelated', url: base, poses: { thinking: `${base}thinking/`, crm: `${base}crm/` }, toolPoses: { crm: 'crm' } };

function fixture(overrides = {}) {
  const calls = [];
  const client = createClaudeAgentIcons({ host: createNodeHost(), env: { MAINSEQUENCE_ENDPOINT: backend, MAINSEQUENCE_ACCESS_TOKEN: 'synthetic-icon-token' },
    fetch: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.headers.Authorization, 'Bearer synthetic-icon-token');
      assert.equal(init.redirect, 'error');
      const path = new URL(url).pathname;
      if (path === '/api/v1/users/me/') return Response.json({ username: overrides.account || account });
      if (path === '/api/v1/command-center/agents/') return Response.json(overrides.projection || [{ agentUid: id(1), commandCenterIcon: icon }]);
      assert.ok(path.startsWith(base));
      return new Response(overrides.bytes || animatedIcon(), { status: overrides.status || 200, headers: { 'Content-Type': overrides.mime || 'image/png' } });
    } });
  return { client, calls };
}

test('native APNG preserves its frames and supplies exact frame zero for history and reduced motion', () => {
  const bytes = animatedIcon(), still = agentIconStill(bytes), image = nativeAgentIcon(bytes, 'image/png', icon);
  assert.ok(bytes.includes(Buffer.from('acTL'))); assert.ok(!still.includes(Buffer.from('acTL')));
  assert.ok(!still.includes(Buffer.from('fdAT'))); assert.ok(still.includes(Buffer.from('IDAT')));
  assert.equal(image.animated, true); assert.match(image.source, /prefers-reduced-motion:reduce/);
  assert.match(image.source, /image-rendering:pixelated/); assert.ok(image.source.includes(bytes.toString('base64')));
  assert.ok(image.stillSource.includes(still.toString('base64'))); assert.ok(!image.stillSource.includes(bytes.toString('base64')));
  assert.throws(() => agentIconStill(bytes.subarray(0, 65)));
});

test('native size limits gracefully retain a still and oversized static icons fall back', () => {
  const image = nativeAgentIcon(animatedIcon(110000), 'image/png', icon);
  assert.equal(image.animated, false); assert.equal(image.source, image.stillSource);
  assert.equal(nativeAgentIcon(Buffer.alloc(110000, 32), 'image/svg+xml', icon), null);
});

test('media uses the existing authenticated session, exact environment and canonical pose routes', async () => {
  const f = fixture(), result = await f.client.dispatch({ ...input, includePoses: true });
  assert.equal(result.status, 'success'); assert.equal(result.data.account, account);
  assert.ok(result.data.icons[id(1)].images.crm.animated);
  assert.equal(result.data.icons[id(1)].toolPoses.crm, 'crm');
  assert.ok(f.calls.some(c => c.url.endsWith(`?organization_environment_uid=${id(2)}`)));
  assert.ok(f.calls.some(c => c.url === backend + base + 'crm/'));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-icon-token|Authorization|https:\/\/platform/);
});

test('foreign URLs, malformed selections and changed accounts never deliver icon bytes', async () => {
  for (const url of ['https://other.example/icon', base + '?token=private', base + '../other/', '//other.example/icon']) {
    const f = fixture({ projection: [{ agentUid: id(1), commandCenterIcon: { ...icon, url } }] });
    const result = await f.client.dispatch(input); assert.deepEqual(Object.keys(result.data.icons), []);
    assert.equal(f.calls.length, 2);
  }
  const f = fixture({ account: 'someone-else@example.test' });
  assert.equal((await f.client.dispatch(input)).error.code, 'AUTH_REJECTED'); assert.equal(f.calls.length, 1);
  for (const change of [{ agentUids: [id(1),id(2)], includePoses: true }, { environmentUid: '../escape' }, { agentUids: Array(5).fill(id(1)) }]) {
    assert.equal((await f.client.dispatch({ ...input, ...change })).error.code, 'INVALID_REQUEST');
  }
});

test('missing, unsupported and oversized media are optional presentation failures', async () => {
  for (const override of [{ status: 404 }, { mime: 'text/html' }, { bytes: Buffer.alloc(524289) }]) {
    const result = await fixture(override).client.dispatch(input);
    assert.equal(result.status, 'success'); assert.equal(result.data.icons[id(1)].images.idle, null);
  }
});

test('pose priority matches Command Center and missing poses retain idle', async () => {
  const { resolveAgentIconPose } = await import('../manifests/claude/hooks/agentIcon.mjs');
  const projected = { images: { idle: {}, thinking: {}, working: {}, error: {}, crm: {} }, toolPoses: { crm: 'crm' } };
  assert.equal(resolveAgentIconPose(projected, { thinking: true, tool: { application: 'crm', phase: 'running' } }), 'crm');
  assert.equal(resolveAgentIconPose(projected, { tool: { application: 'unknown', phase: 'running' } }), 'working');
  assert.equal(resolveAgentIconPose(projected, { thinking: true, tool: { phase: 'failed' } }), 'error');
  assert.equal(resolveAgentIconPose(projected, { thinking: true }), 'thinking');
  assert.equal(resolveAgentIconPose(projected, null), 'idle');
  assert.equal(resolveAgentIconPose({ images: { idle: {} } }, { thinking: true }), 'idle');
});


test('agents without a custom icon render no image or placeholder', async () => {
  const { renderAgentIcon } = await import('../manifests/claude/hooks/agentIcon.mjs');
  const ui = new Proxy({}, { get: () => () => assert.fail('A missing icon must draw nothing') });
  assert.equal(renderAgentIcon(ui, { agentIcons: {} }, id(1)), null);
  assert.equal(renderAgentIcon(ui, { agentIcons: { [id(1)]: { images: { idle: null } } } }, id(1)), null);
});
