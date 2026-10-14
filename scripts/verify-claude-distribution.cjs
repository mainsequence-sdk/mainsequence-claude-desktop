const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function safeArchiveName(name) {
  assert.ok(name && !/[\x00-\x1f\x7f\\]/.test(name), 'Archive contains an invalid filename');
  assert.ok(!name.startsWith('/') && !/^[a-z]:/i.test(name), `Absolute archive path: ${name}`);
  const parts = name.replace(/\/$/, '').split('/');
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), `Unsafe archive path: ${name}`);
  assert.equal(path.posix.normalize(name), name, `Noncanonical archive path: ${name}`);
}

/** Read and validate ZIP metadata before extracting any entry. No external ZIP library is required. */
function inspectZip(bytes) {
  assert.ok(bytes.length >= 22, 'ZIP is truncated');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  assert.ok(end >= 0, 'ZIP end record is missing or has trailing bytes');
  assert.equal(bytes.readUInt16LE(end + 4), 0, 'Multi-disk archives are unsupported');
  assert.equal(bytes.readUInt16LE(end + 6), 0, 'Multi-disk archives are unsupported');
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count, 'ZIP entry count differs between disks');
  assert.ok(count > 0 && count < 5000, 'Unexpected ZIP entry count');
  const centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  assert.ok(centralStart + centralSize === end, 'Invalid central directory bounds or unsupported ZIP64 archive');
  let offset = centralStart, total = 0;
  const entries = [], names = new Set(), intervals = [];
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50, 'Invalid ZIP central directory entry');
    const flags = bytes.readUInt16LE(offset + 8), compression = bytes.readUInt16LE(offset + 10);
    const expectedCrc = bytes.readUInt32LE(offset + 16), packed = bytes.readUInt32LE(offset + 20), unpacked = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    const attributes = bytes.readUInt32LE(offset + 38), local = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    assert.ok(next <= end, 'ZIP central directory entry overruns its bounds');
    assert.equal(bytes.readUInt16LE(offset + 34), 0, 'Multi-disk ZIP entry is unsupported');
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = rawName.toString('utf8');
    assert.ok(Buffer.from(name, 'utf8').equals(rawName), 'ZIP filenames must be valid UTF-8');
    safeArchiveName(name);
    const identity = name.replace(/\/$/, '').normalize('NFC').toLocaleLowerCase('en-US');
    assert.ok(!names.has(identity), `Duplicate or case-colliding archive path: ${name}`); names.add(identity);
    const mode = attributes >>> 16, kind = mode & 0o170000;
    assert.ok(kind === 0 || kind === 0o100000 || kind === 0o040000, `Symlink or special file in archive: ${name}`);
    const directory = name.endsWith('/');
    assert.ok(kind !== 0o040000 || directory, `Directory entry lacks a trailing slash: ${name}`);
    assert.ok(kind !== 0o100000 || !directory, `File entry is marked as a directory: ${name}`);
    assert.equal(flags & 1, 0, `Encrypted archive entry: ${name}`);
    assert.ok(compression === 0 || compression === 8, `Unsupported ZIP compression: ${name}`);
    assert.ok(unpacked <= MAX_ENTRY_BYTES && (total += unpacked) <= MAX_TOTAL_BYTES, 'ZIP exceeds distribution size limits');
    assert.ok(local + 30 <= centralStart && bytes.readUInt32LE(local) === 0x04034b50, `Invalid local ZIP header: ${name}`);
    assert.equal(bytes.readUInt16LE(local + 6), flags, `ZIP header flag mismatch: ${name}`);
    assert.equal(bytes.readUInt16LE(local + 8), compression, `ZIP compression mismatch: ${name}`);
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    assert.ok(bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName), `ZIP header filename mismatch: ${name}`);
    assert.ok(start <= centralStart && start + packed <= centralStart, `ZIP payload overruns its bounds: ${name}`);
    if (!(flags & 8)) {
      assert.equal(bytes.readUInt32LE(local + 14), expectedCrc, `ZIP header checksum mismatch: ${name}`);
      assert.equal(bytes.readUInt32LE(local + 18), packed, `ZIP compressed-size mismatch: ${name}`);
      assert.equal(bytes.readUInt32LE(local + 22), unpacked, `ZIP uncompressed-size mismatch: ${name}`);
    }
    const compressed = bytes.subarray(start, start + packed);
    const content = compression === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    assert.equal(content.length, unpacked, `ZIP payload size mismatch: ${name}`);
    assert.equal(crc32(content), expectedCrc, `ZIP payload checksum mismatch: ${name}`);
    if (directory) assert.equal(content.length, 0, `Directory contains data: ${name}`);
    entries.push({ name, directory, mode: mode & 0o777, content }); intervals.push([local, start + packed, name]); offset = next;
  }
  assert.equal(offset, end, 'Unexpected trailing central directory entries');
  intervals.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i - 1][1] <= intervals[i][0], 'Overlapping ZIP file entries');
  return entries;
}

function isText(name) {
  return /\.(?:[cm]?[jt]sx?|json|md|txt|ya?ml|toml|sh|html|css|map)$/i.test(name) || /(?:^|\/)(?:LICENSE|NOTICE)$/i.test(name);
}

function verifyPortableFiles(entries) {
  for (const entry of entries) {
    const name = entry.name, parts = name.split('/'), basename = path.posix.basename(name);
    assert.ok(!parts.includes('.git') && !parts.includes('node_modules'), `Checkout dependency or Git data in distribution: ${name}`);
    assert.ok(!['.credentials.json', 'auth.json', 'accounts.json', '.npmrc', '.netrc', 'id_rsa', 'id_ed25519', '.DS_Store'].includes(basename), `Private/local file in distribution: ${name}`);
    assert.ok(!/^\.env(?:\.|$)/.test(basename) || /^\.env\.(?:example|sample|template)$/.test(basename), `Environment credentials file in distribution: ${name}`);
    assert.ok(!/\.(?:key|p12|pfx|keychain|keychain-db)$/i.test(basename), `Private credential container in distribution: ${name}`);
    if (entry.directory || !isText(name)) continue;
    const text = entry.content.toString('utf8');
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text), `Private key material in ${name}`);
    assert.ok(!/\bsk-(?:(?:ant-(?:api\d+|oat\d+|ort\d+)|proj)-)?[A-Za-z0-9_-]{24,}\b/.test(text), `API credential material in ${name}`);
    assert.ok(!/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/.test(text), `GitHub credential material in ${name}`);
    assert.ok(!/file:\/\//i.test(text), `Machine-local file URL in ${name}`);
    for (const match of text.matchAll(/(?:\/Users\/[^\s/"'`<>]+|\/home\/[^\s/"'`<>]+|[A-Za-z]:\\Users\\[^\s\\"'`<>]+)/g)) {
      assert.ok(name.endsWith('.md') && match[0] === '/Users/example', `Machine-specific home path in ${name}`);
    }
    assert.ok(!text.includes(root) && !text.includes(os.homedir() + path.sep), `Build-machine path in ${name}`);
  }
}

function verifyMarkdownLinks(entries) {
  const files = new Set(entries.filter(entry => !entry.directory).map(entry => entry.name));
  const directories = new Set(entries.filter(entry => entry.directory).map(entry => entry.name.replace(/\/$/, '')));
  for (const entry of entries.filter(item => !item.directory && item.name.endsWith('.md'))) {
    const text = entry.content.toString('utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g)) {
      const raw = match[1].replace(/^<|>$/g, '').split('#')[0].split('?')[0];
      if (!raw || /^[a-z][a-z\d+.-]*:/i.test(raw)) continue;
      assert.ok(!raw.startsWith('/') && !raw.startsWith('\\'), `Absolute documentation link in ${entry.name}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry.name), decodeURIComponent(raw)));
      assert.ok(target !== '..' && !target.startsWith('../'), `Documentation link escapes archive: ${entry.name} -> ${raw}`);
      assert.ok(files.has(target) || directories.has(target.replace(/\/$/, '')), `Broken packaged documentation link: ${entry.name} -> ${raw}`);
    }
  }
}

function verifyPublicCatalog(distribution, entries) {
  // The generated catalog accompanies the release. Its docs and attribution
  // must match the validated archive; publication only commits the marketplace
  // and release metadata, preserving the maintained source in this repository.
  const expected = new Map(entries.filter(entry => !entry.directory &&
    (['README.md', 'LICENSE', 'NOTICE'].includes(entry.name) || entry.name.startsWith('docs/') || entry.name.startsWith('third_party/')))
    .map(entry => [entry.name, entry.content]));
  const catalogName = '.claude-plugin/marketplace.json';
  const allowed = [...expected.keys(), catalogName], seen = new Set();
  function walk(directory, prefix = '') {
    for (const name of fs.readdirSync(directory)) {
      const relative = prefix + name, absolute = path.join(directory, name), stat = fs.lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink(), `Symlink in public catalog: ${relative}`);
      if (stat.isDirectory()) {
        assert.ok(allowed.some(item => item.startsWith(relative + '/')), `Unexpected public catalog directory: ${relative}`);
        walk(absolute, relative + '/');
      } else {
        assert.ok(stat.isFile() && allowed.includes(relative), `Unexpected public catalog file: ${relative}`);
        seen.add(relative);
        if (relative !== catalogName) assert.ok(fs.readFileSync(absolute).equals(expected.get(relative)), `Public catalog file differs from validated ZIP: ${relative}`);
      }
    }
  }
  assert.ok(!fs.lstatSync(distribution).isSymbolicLink(), 'Public catalog root must not be a symlink');
  walk(distribution);
  for (const name of allowed) assert.ok(seen.has(name), `Missing public catalog file: ${name}`);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const artifacts = path.resolve(process.env.MS_CLAUDE_ARTIFACTS_DIR || path.join(root, 'artifacts'));
  const repository = 'mainsequence-sdk/mainsequence-claude-desktop';
  assert.ok(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Invalid distribution repository');
  const filename = `mainsequence-claude-desktop-${pkg.version}.zip`;
  const archive = path.join(artifacts, filename);
  const bytes = fs.readFileSync(archive);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const checksum = fs.readFileSync(`${archive}.sha256`, 'utf8').trim();
  const checksumLine = checksum.match(/^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/);
  assert.ok(checksumLine, 'Checksum file must contain one SHA-256 and the archive basename');
  assert.equal(checksumLine[1].toLowerCase(), sha256, 'Published checksum differs from ZIP SHA-256');
  assert.equal(checksumLine[2], filename, 'Published checksum names the wrong archive');
  const marketplaceFile = path.join(artifacts, 'claude-distribution', '.claude-plugin', 'marketplace.json');
  const marketplaceBytes = fs.readFileSync(marketplaceFile);
  verifyPortableFiles([{ name: '.claude-plugin/marketplace.json', directory: false, content: marketplaceBytes }]);
  const marketplace = JSON.parse(marketplaceBytes.toString('utf8'));
  assert.equal(marketplace.name, 'mainsequence-desktop');
  assert.equal(marketplace.plugins?.length, 1, 'Distribution marketplace must advertise exactly one plugin');
  const plugin = marketplace.plugins[0];
  assert.equal(plugin.name, 'mainsequence'); assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.source?.source, 'archive', 'Desktop marketplace must use an archive source');
  assert.equal(plugin.source.url, `https://github.com/${repository}/releases/download/v${pkg.version}/${filename}`);
  assert.equal(plugin.source.sha256, sha256, 'Marketplace must pin the exact archive SHA-256');
  assert.deepEqual(Object.keys(plugin.source).sort(), ['sha256', 'source', 'url'], 'Public archive source must not include local paths or credential headers');
  const entries = inspectZip(bytes);
  verifyPortableFiles(entries); verifyMarkdownLinks(entries);
  verifyPublicCatalog(path.join(artifacts, 'claude-distribution'), entries);
  const manifestEntry = entries.find(entry => entry.name === '.claude-plugin/plugin.json');
  const infoEntry = entries.find(entry => entry.name === 'build-info.json');
  assert.ok(manifestEntry && infoEntry, 'Archive must contain its plugin manifest and build info at the root');
  const manifest = JSON.parse(manifestEntry.content.toString('utf8'));
  const info = JSON.parse(infoEntry.content.toString('utf8'));
  assert.equal(manifest.name, 'mainsequence'); assert.equal(manifest.version, pkg.version);
  assert.equal(info.version, pkg.version); assert.equal(info.host, 'claude-desktop-code'); assert.equal(info.workerProtocol, 1);
  for (const name of ['README.md', 'LICENSE', 'NOTICE', 'hooks/hooks.json', 'hooks/register.mjs', 'hooks/view.mjs',
    'dist/claudeRunner.js', 'docs/claude-desktop.md', 'docs/claude-desktop-verification.md', 'docs/claude-desktop-distribution.md',
    'third_party/claude-account-rotator/LICENSE', 'third_party/claude-account-rotator/NOTICE']) {
    assert.ok(entries.some(entry => entry.name === name && !entry.directory), `Missing distribution file: ${name}`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'MainSequence Claude distribution '));
  const extracted = path.join(temporary, 'plugin with spaces');
  try {
    fs.mkdirSync(extracted, { mode: 0o700 });
    for (const entry of entries) {
      const destination = path.join(extracted, entry.name);
      if (entry.directory) fs.mkdirSync(destination, { recursive: true });
      else { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, entry.content, { flag: 'wx', mode: entry.mode || 0o644 }); }
    }
    const env = { ...process.env, MS_CLAUDE_PACKAGE: extracted, NODE_PATH: '', NODE_OPTIONS: '' };
    // The extracted worker must resolve its own runtime without the checkout's
    // node_modules, ambient NODE_PATH, preload hooks or artifact symlinks.
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-claude-host.cjs')], {
      cwd: extracted, env, encoding: 'utf8', timeout: process.env.MS_CLAUDE_DESKTOP_BINARY ? 150_000 : 30_000,
    });
    process.stdout.write(result.stdout || '');
    assert.equal(result.status, 0, result.stderr || result.error?.message || 'Standalone Desktop artifact verification failed');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  console.log(`Claude Desktop distribution ${pkg.version}: SHA-256, public marketplace, safe ZIP inventory, portable sources, docs and standalone worker verified (${entries.filter(entry => !entry.directory).length} files).`);
}

if (require.main === module) main();
module.exports = { inspectZip, verifyPortableFiles, verifyMarkdownLinks };
