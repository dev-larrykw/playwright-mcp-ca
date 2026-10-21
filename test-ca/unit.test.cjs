const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixtures } = require('./fixtures.cjs');
const { parseBundle, validateLocalBrowser, configureCABundle } = require('../ca-bundle');

let directory, certs, bundlePath;
before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ca-tests-'));
  certs = fixtures(directory);
  bundlePath = path.join(directory, 'bundle.pem');
  fs.writeFileSync(bundlePath, certs.bundle);
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('deduplicates PEM bundles and distinguishes roots from intermediates', () => {
  const parsed = parseBundle('# Approved CAs\n' + certs.bundle + certs.read('root.pem'));
  assert.deepEqual(parsed.map(cert => cert.root), [true, false]);
});

test('rejects leaf certificates, private keys, empty and malformed bundles', () => {
  assert.throws(() => parseBundle(certs.read('leaf.pem')), /not a CA/);
  assert.throws(() => parseBundle(certs.bundle + certs.read('root.key')), /private keys/);
  assert.throws(() => parseBundle(''), /No PEM/);
  assert.throws(() => parseBundle(certs.bundle + '\n-----BEGIN CERTIFICATE-----'), /Malformed/);
  assert.throws(() => parseBundle(certs.read('intermediate.pem')), /self-signed root/);
});

test('rejects unsupported browser hosts and validation bypass options', () => {
  for (const options of [{ browser: 'firefox' }, { browser: 'webkit' }, { cdpEndpoint: 'http://localhost:9222' }, { extension: true }, { endpoint: 'ws://localhost' }, { ignoreHttpsErrors: true }])
    assert.throws(() => validateLocalBrowser(options, {}, {}));
  assert.throws(() => validateLocalBrowser({}, { PLAYWRIGHT_MCP_EXTENSION: '1' }, {}));
  assert.throws(() => validateLocalBrowser({}, {}, { browser: { launchOptions: { env: { HOME: '/other' } } } }));
  assert.throws(() => validateLocalBrowser({}, {}, { browser: { contextOptions: { ignoreHTTPSErrors: true } } }));
  assert.throws(() => validateLocalBrowser({}, {}, { browser: { launchOptions: { args: ['--ignore-certificate-errors'] } } }));
  validateLocalBrowser({ browser: 'chromium' }, { PLAYWRIGHT_MCP_EXTENSION: 'false' }, {});
});

test('imports roots and intermediates with different trust; isolates HOME and preserves browser downloads and Node trust', () => {
  const env = { HOME: '/original', NODE_EXTRA_CA_CERTS: '/existing/node.pem', XDG_CACHE_HOME: '/original/cache' };
  const commands = [];
  const cleanup = configureCABundle(bundlePath, {}, env, 'linux', args => commands.push(args));
  try {
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '/original/cache/ms-playwright');
    assert.equal(env.NODE_EXTRA_CA_CERTS, '/existing/node.pem');
    assert.notEqual(env.HOME, '/original');
    assert.equal(fs.statSync(env.HOME).mode & 0o777, 0o700);
    assert.equal(fs.realpathSync(path.join(env.HOME, '.pki/nssdb')), fs.realpathSync(path.join(env.HOME, '.local/share/pki/nssdb')));
    assert.deepEqual(commands.slice(1).map(args => args[args.indexOf('-t') + 1]), ['C,,', ',,']);
  } finally {
    cleanup();
  }
  assert.equal(fs.existsSync(env.HOME), false);
});

test('keeps PLAYWRIGHT_BROWSERS_PATH=0 and loads config without changing it', () => {
  const configPath = path.join(directory, 'config.json');
  const config = JSON.stringify({ browser: { browserName: 'chromium' }, outputDir: './results' });
  fs.writeFileSync(configPath, config);
  const env = { HOME: '/original', PLAYWRIGHT_BROWSERS_PATH: '0' };
  const cleanup = configureCABundle(bundlePath, { config: configPath }, env, 'linux', () => {});
  cleanup();
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '0');
  assert.equal(fs.readFileSync(configPath, 'utf8'), config);
});

test('failed NSS initialization cleans up and leaves environment untouched', () => {
  const env = { HOME: '/original' };
  let database;
  assert.throws(() => configureCABundle(bundlePath, {}, env, 'linux', args => {
    database = args[args.indexOf('-d') + 1].slice(4);
    throw new Error('simulated certutil failure');
  }), /simulated/);
  assert.deepEqual(env, { HOME: '/original' });
  assert.equal(fs.existsSync(database), false);
});

test('fails clearly on a non-Linux host', () => {
  assert.throws(() => configureCABundle(bundlePath, {}, {}, 'darwin'), /Linux/);
});
