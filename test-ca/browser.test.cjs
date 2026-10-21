const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { once } = require('node:events');
const { fixtures } = require('./fixtures.cjs');

test('real Linux Chromium accepts the supplied CA and rejects untrusted certificates and hostname mismatches', {
  skip: process.platform !== 'linux' ? 'Requires Linux, NSS certutil, and installed Playwright Chromium' : false,
  timeout: 120000,
}, async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ca-browser-test-'));
  const clients = [];
  const servers = [];
  try {
    const certs = fixtures(directory);
    const bundlePath = path.join(directory, 'bundle.pem');
    fs.writeFileSync(bundlePath, certs.bundle);
    async function serve(key, cert) {
      const server = https.createServer({ key, cert }, (_, res) => res.end('<h1>CA validation succeeded</h1>'));
      servers.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return server.address().port;
    }
    const trustedPort = await serve(certs.read('leaf.key'), certs.read('leaf.pem') + certs.read('intermediate.pem'));
    const untrustedPort = await serve(certs.read('untrusted.key'), certs.read('untrusted.pem'));
    async function connect(useBundle) {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PLAYWRIGHT_MCP_')));
      const client = new Client({ name: 'ca-test', version: '1.0.0' });
      clients.push(client);
      await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve(__dirname, '../cli.js'), '--browser', 'chromium', '--headless', '--isolated', ...(useBundle ? ['--ca-bundle', bundlePath] : [])],
        env,
        cwd: directory,
        stderr: 'inherit',
      }));
      return client;
    }
    const baseline = await connect(false);
    const withoutCA = await baseline.callTool({ name: 'browser_navigate', arguments: { url: `https://localhost:${trustedPort}` } });
    assert.equal(withoutCA.isError, true, JSON.stringify(withoutCA));
    assert.match(JSON.stringify(withoutCA), /ERR_CERT_AUTHORITY_INVALID/);
    await baseline.close();
    const configured = await connect(true);
    const trusted = await configured.callTool({ name: 'browser_navigate', arguments: { url: `https://localhost:${trustedPort}` } });
    assert.notEqual(trusted.isError, true, JSON.stringify(trusted));
    assert.match(JSON.stringify(trusted), /CA validation succeeded/);
    const untrusted = await configured.callTool({ name: 'browser_navigate', arguments: { url: `https://localhost:${untrustedPort}` } });
    assert.equal(untrusted.isError, true, JSON.stringify(untrusted));
    assert.match(JSON.stringify(untrusted), /ERR_CERT_AUTHORITY_INVALID/);
    const wrongHost = await configured.callTool({ name: 'browser_navigate', arguments: { url: `https://127.0.0.1:${trustedPort}` } });
    assert.equal(wrongHost.isError, true, JSON.stringify(wrongHost));
    assert.match(JSON.stringify(wrongHost), /ERR_CERT_COMMON_NAME_INVALID/);
  } finally {
    for (const client of clients)
      await client.close();
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
