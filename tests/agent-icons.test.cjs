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
      if (overrides.status === 304) return new Response(null, { status: 304, headers: overrides.etag ? { ETag: overrides.etag } : {} });
      return new Response(overrides.bytes || animatedIcon(), { status: overrides.status || 200, headers: { 'Content-Type': overrides.mime || 'image/png', ...(overrides.etag ? { ETag: overrides.etag } : {}) } });
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

test('a large static PNG, like a 512 px Command Center icon, is shrunk to fit instead of dropped', () => {
  const { decodePng, encodePng } = require('../dist/hosts/claudePng');
  // 512x512 RGBA pixel art in 8 px cells with per-pixel noise in the alpha channel: about 1 MB raw, well over the limit once embedded.
  const pixels = Buffer.alloc(512 * 512 * 4);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4, cell = ((x >> 3) * 31 + (y >> 3) * 17) & 255;
    pixels[i] = cell; pixels[i + 1] = 255 - cell; pixels[i + 2] = (cell * 7) & 255; pixels[i + 3] = 200 + ((x * 13 + y * 29) % 56);
  }
  const big = encodePng({ width: 512, height: 512, pixels });
  assert.ok(Buffer.from(big).toString('base64').length > 131072, 'fixture exceeds the native limit');
  const image = nativeAgentIcon(big, 'image/png', { rendering: 'color', imageRendering: 'pixelated' });
  assert.ok(image, 'the icon is kept'); assert.equal(image.animated, false); assert.ok(image.source.length <= 131072);
  const embedded = Buffer.from(/base64,([^"]+)"/.exec(image.source)[1], 'base64'), decoded = decodePng(embedded);
  assert.ok(decoded.width <= 128 && decoded.height <= 128, `shrunk to ${decoded.width}x${decoded.height}`);
  // Nearest-pixel scaling keeps pixel-art colours exact.
  assert.deepEqual([...decoded.pixels.subarray(0, 3)], [...pixels.subarray(0, 3)]);
  // A heavy static PNG that would fit is still shrunk; a small one is not.
  // zlib output differs between Node versions: pick the first square whose PNG is over 32 KiB yet still fits the limit.
  let heavy;
  for (let side = 256; side >= 136 && !heavy; side -= 8) {
    const crop = Buffer.alloc(side * side * 4);
    for (let y = 0; y < side; y++) pixels.copy(crop, y * side * 4, y * 512 * 4, (y * 512 + side) * 4);
    const candidate = encodePng({ width: side, height: side, pixels: crop });
    if (candidate.length > 32768 && Buffer.from(candidate).toString('base64').length < 120000) heavy = candidate;
  }
  assert.ok(heavy, 'a heavy PNG that fits the limit exists');
  const shrunk = nativeAgentIcon(heavy, 'image/png', { rendering: 'color', imageRendering: 'pixelated' });
  assert.ok(decodePng(Buffer.from(/base64,([^"]+)"/.exec(shrunk.source)[1], 'base64')).width <= 128);
  // Small icons are embedded unchanged.
  const small = nativeAgentIcon(animatedIcon(), 'image/png', icon);
  assert.ok(small.source.includes(animatedIcon().toString('base64')));
  // Unsupported or corrupt PNGs still draw nothing.
  const corrupt = Buffer.from(big), idat = corrupt.indexOf('IDAT');
  corrupt.fill(1, idat + 4, idat + 4 + corrupt.readUInt32BE(idat - 4));
  assert.equal(nativeAgentIcon(corrupt, 'image/png', icon), null);
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
  for (const change of [{ agentUids: [id(1),id(2)], includePoses: true }, { environmentUid: '../escape' }, { agentUids: Array(9).fill(id(1)) }, { refresh: 'yes' }]) {
    assert.equal((await f.client.dispatch({ ...input, ...change })).error.code, 'INVALID_REQUEST');
  }
});

test('missing, unsupported and oversized media are optional presentation failures', async () => {
  for (const override of [{ status: 404 }, { mime: 'text/html' }, { bytes: Buffer.alloc(524289) }]) {
    const result = await fixture(override).client.dispatch(input);
    assert.equal(result.status, 'success'); assert.equal(result.data.icons[id(1)].images.idle, null);
  }
});

test('revalidation sends the held ETag only to the canonical icon route and reports an unchanged icon without bytes', async () => {
  const tag = 'W/"' + 'a'.repeat(64) + '"', fresh = '"' + 'b'.repeat(64) + '"';
  // A first read carries the backend's tag with the image.
  const first = fixture({ etag: tag }), loaded = await first.client.dispatch(input);
  assert.equal(loaded.data.icons[id(1)].etag, tag); assert.ok(loaded.data.icons[id(1)].images.idle.animated);
  assert.equal(first.calls.some(c => c.init.headers['If-None-Match']), false, 'no conditional request without a held tag');
  // The held tag is sent as If-None-Match to the icon route only; a 304 keeps the bytes out of the result.
  const same = fixture({ status: 304, etag: tag }), unchanged = await same.client.dispatch({ ...input, known: { [id(1)]: tag } });
  assert.equal(unchanged.status, 'success');
  assert.deepEqual(JSON.parse(JSON.stringify(unchanged.data.icons[id(1)])), { rendering: 'color', imageRendering: 'pixelated', toolPoses: { crm: 'crm' }, images: {}, etag: tag, unchanged: true, posesLoaded: false });
  assert.deepEqual(same.calls.map(c => [new URL(c.url).pathname, c.init.headers['If-None-Match'] ?? null]), [['/api/v1/users/me/', null], ['/api/v1/command-center/agents/', null], [base, tag]]);
  assert.doesNotMatch(JSON.stringify(unchanged), /bytes|data:image/);
  // A route that sends tags but ignores If-None-Match answers 200 with the same tag: still unchanged, bytes dropped unread.
  for (const again of [tag, tag.slice(2)]) {
    const repeated = fixture({ etag: again }), kept = await repeated.client.dispatch({ ...input, known: { [id(1)]: tag } });
    assert.equal(kept.data.icons[id(1)].unchanged, true); assert.deepEqual(Object.keys(kept.data.icons[id(1)].images), []); assert.equal(kept.data.icons[id(1)].etag, tag);
    assert.equal(repeated.calls.at(-1).init.headers['If-None-Match'], tag);
  }
  // A changed icon answers 200 with its new tag and new image.
  const changed = fixture({ etag: fresh }), replaced = await changed.client.dispatch({ ...input, known: { [id(1)]: tag } });
  assert.equal(replaced.data.icons[id(1)].etag, fresh); assert.ok(replaced.data.icons[id(1)].images.idle.source.includes('data:image/png'));
  assert.equal(changed.calls.at(-1).init.headers['If-None-Match'], tag);
  // A tag that is not one, for an agent not requested, or together with poses, is refused before any request.
  for (const known of [{ [id(2)]: tag }, { [id(1)]: 'not-a-tag' }, { [id(1)]: tag + '\n' }, [tag]]) {
    const f = fixture({ etag: tag }); assert.equal((await f.client.dispatch({ ...input, known })).error.code, 'INVALID_REQUEST'); assert.equal(f.calls.length, 0);
  }
  assert.equal((await fixture().client.dispatch({ ...input, includePoses: true, known: { [id(1)]: tag } })).error.code, 'INVALID_REQUEST');
  // A 304 for an agent whose tag was never held is impossible, and an icon without a tag has none to send back.
  const untagged = fixture(), plain = await untagged.client.dispatch(input);
  assert.equal(plain.data.icons[id(1)].etag, null);
  assert.equal((await fixture({ status: 404 }).client.dispatch({ ...input, known: { [id(1)]: tag } })).data.icons[id(1)].etag, null);
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

// The worker's shared cache: one file per backend, environment and account, read by every Claude session's worker.
const os = require('node:os'), fsp = require('node:fs/promises'), nodePath = require('node:path');
function cachedFixture(directory, clock, uids, overrides = {}) {
  const calls = []; let inFlight = 0, peak = 0;
  const projection = overrides.projection || uids.map(uid => ({ agentUid: uid, commandCenterIcon: { ...icon, url: `/api/v1/command-center/agents/${uid}/icon/`, poses: {}, toolPoses: {} } }));
  const client = createClaudeAgentIcons({ host: createNodeHost(), cacheDirectory: directory, now: () => clock.now,
    env: { MAINSEQUENCE_ENDPOINT: backend, MAINSEQUENCE_ACCESS_TOKEN: 'synthetic-icon-token' },
    fetch: async url => {
      const path = new URL(url).pathname; calls.push(path);
      if (path === '/api/v1/users/me/') return Response.json({ username: account });
      if (path === '/api/v1/command-center/agents/') return Response.json(projection);
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5)); inFlight--;
      if (overrides.fail?.(path)) return new Response('missing', { status: 404 });
      return new Response(animatedIcon(), { status: 200, headers: { 'Content-Type': 'image/png', ETag: '"tag"' } });
    } });
  return { client, calls, get peak() { return peak; } };
}
const iconReads = calls => calls.filter(path => path.endsWith('/icon/')).length;

test('eight agents load in parallel, and every session\'s worker answers from one cache for ten minutes', async () => {
  const directory = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'ms-agent-icons-')), clock = { now: 1_000_000 };
  const uids = Array.from({ length: 8 }, (_, i) => id(10 + i)), request = { ...input, agentUids: uids };
  const first = cachedFixture(directory, clock, uids), loaded = await first.client.dispatch(request);
  assert.equal(loaded.status, 'success'); assert.equal(Object.keys(loaded.data.icons).length, 8);
  assert.ok(first.peak > 1 && first.peak <= 4, `icons load four at a time, not one by one (peak ${first.peak})`);
  clock.now += 9 * 60_000;
  const second = cachedFixture(directory, clock, uids), reused = await second.client.dispatch(request);
  assert.equal(second.calls.some(path => path.startsWith('/api/v1/command-center/')), false, 'another session reads no directory or icon');
  assert.deepEqual(JSON.parse(JSON.stringify(reused.data.icons)), JSON.parse(JSON.stringify(loaded.data.icons)));
  const held = await second.client.dispatch({ ...request, known: { [uids[0]]: '"tag"' } });
  assert.equal(held.data.icons[uids[0]].unchanged, true); assert.deepEqual(held.data.icons[uids[0]].images, {});
  const refreshed = cachedFixture(directory, clock, uids); await refreshed.client.dispatch({ ...request, refresh: true });
  assert.equal(iconReads(refreshed.calls), 8, 'Refresh reads every icon again');
  clock.now += 11 * 60_000;
  const later = cachedFixture(directory, clock, uids); await later.client.dispatch(request);
  assert.equal(iconReads(later.calls), 8, 'an entry older than ten minutes is read again');
  const [file] = (await fsp.readdir(directory)).filter(name => name.endsWith('.json'));
  assert.equal((await fsp.stat(nodePath.join(directory, file))).mode & 0o777, 0o600);
  assert.equal((await fsp.stat(directory)).mode & 0o777, 0o700);
  assert.doesNotMatch(await fsp.readFile(nodePath.join(directory, file), 'utf8'), /synthetic-icon-token|Authorization/);
  await fsp.rm(directory, { recursive: true, force: true });
});

test('a failed icon read is never kept, and an agent without an icon is not asked for again', async () => {
  const directory = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'ms-agent-icons-')), clock = { now: 1_000_000 };
  const uids = [id(20), id(21), id(22)], request = { ...input, agentUids: uids };
  // id(20) has an icon whose first read fails; id(21) is listed without one; id(22) is not in the directory.
  const projection = [{ agentUid: id(20), commandCenterIcon: { ...icon, url: `/api/v1/command-center/agents/${id(20)}/icon/`, poses: {}, toolPoses: {} } }, { agentUid: id(21) }];
  const first = cachedFixture(directory, clock, uids, { projection, fail: path => path.includes(id(20)) }), result = await first.client.dispatch(request);
  assert.equal(result.data.icons[id(20)].images.idle, null); assert.equal(result.data.icons[id(20)].failed, true); assert.equal(result.data.icons[id(21)], undefined);
  const second = cachedFixture(directory, clock, uids, { projection }), again = await second.client.dispatch(request);
  assert.ok(again.data.icons[id(20)].images.idle.animated, 'the next request reads the failed icon again');
  assert.deepEqual(second.calls.filter(path => path.startsWith('/api/v1/command-center/')), ['/api/v1/command-center/agents/', `/api/v1/command-center/agents/${id(20)}/icon/`]);
  const third = cachedFixture(directory, clock, uids, { projection }); await third.client.dispatch(request);
  assert.equal(third.calls.some(path => path.startsWith('/api/v1/command-center/')), false);
  await fsp.rm(directory, { recursive: true, force: true });
});
