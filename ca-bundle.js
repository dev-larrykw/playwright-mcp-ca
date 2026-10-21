// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { execFileSync } = require('node:child_process');

function parseBundle(pem) {
  if (/-----BEGIN .*PRIVATE KEY-----/.test(pem))
    throw new Error('Supply CA certificates only, without private keys.');
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  if (!blocks.length)
    throw new Error('No PEM certificates found.');
  // Permit comments and OpenSSL certificate descriptions, but not malformed PEM blocks.
  if (/-----BEGIN|-----END/.test(pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '')))
    throw new Error('Malformed or unsupported PEM block.');
  const certificates = new Map();
  for (const block of blocks) {
    const cert = new X509Certificate(block);
    if (!cert.ca)
      throw new Error(`Certificate is not a CA: ${cert.subject}`);
    if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now())
      throw new Error(`CA certificate is not currently valid: ${cert.subject}`);
    const root = cert.subject === cert.issuer && cert.verify(cert.publicKey);
    certificates.set(cert.fingerprint256, { pem: cert.toString(), root, fingerprint: cert.fingerprint256 });
  }
  const result = [...certificates.values()];
  if (!result.some(cert => cert.root))
    throw new Error('Bundle must contain a self-signed root CA; intermediates alone are insufficient.');
  return result;
}

function validateLocalBrowser(options, env, config) {
  const browser = config.browser || {};
  const browserName = options.browser || env.PLAYWRIGHT_MCP_BROWSER || browser.browserName || 'chromium';
  if (!/^(chromium|chrome(-beta|-canary|-dev|-for-testing)?|msedge(-beta|-canary|-dev)?)$/.test(browserName))
    throw new Error('--ca-bundle supports Chromium-family browsers only.');
  const enabled = value => value === true || value === 'true' || value === '1';
  if (options.cdpEndpoint || options.endpoint || options.extension ||
      env.PLAYWRIGHT_MCP_CDP_ENDPOINT || env.PLAYWRIGHT_MCP_ENDPOINT || enabled(env.PLAYWRIGHT_MCP_EXTENSION) ||
      browser.cdpEndpoint || browser.remoteEndpoint || config.extension)
    throw new Error('Configure trust on the browser host for CDP, remote, or extension connections.');
  if (browser.launchOptions?.env)
    throw new Error('Custom browser.launchOptions.env is incompatible with the isolated CA home; use the MCP process environment instead.');
  if (options.ignoreHttpsErrors || enabled(env.PLAYWRIGHT_MCP_IGNORE_HTTPS_ERRORS) || browser.contextOptions?.ignoreHTTPSErrors)
    throw new Error('Remove ignore-https-errors/ignoreHTTPSErrors to use CA validation.');
  if ((browser.launchOptions?.args || []).some(arg => /^--ignore-certificate-errors(?:=|-|$)/.test(arg)))
    throw new Error('Remove certificate-error bypass launch arguments to use CA validation.');
}

function runCertutil(args) {
  try {
    execFileSync('certutil', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error('NSS certutil is required. Install libnss3-tools (Debian/Ubuntu) or nss-tools (Fedora/RHEL).');
    throw new Error(`NSS certificate import failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}

function configureCABundle(bundlePath, options = {}, env = process.env, platform = process.platform, certutil = runCertutil) {
  if (platform !== 'linux')
    throw new Error('--ca-bundle currently supports Linux/WSL/Linux containers only.');
  const configPath = options.config || env.PLAYWRIGHT_MCP_CONFIG;
  const config = configPath ? JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8')) : {};
  validateLocalBrowser(options, env, config);
  const certificates = parseBundle(fs.readFileSync(path.resolve(bundlePath), 'utf8'));
  const originalHome = env.HOME || os.homedir();
  const browserCache = env.PLAYWRIGHT_BROWSERS_PATH || path.resolve(env.XDG_CACHE_HOME || path.join(originalHome, '.cache'), 'ms-playwright');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-mcp-ca-'));
  fs.chmodSync(home, 0o700);
  const cleanup = () => fs.rmSync(home, { recursive: true, force: true });
  try {
    const database = path.join(home, '.local', 'share', 'pki', 'nssdb');
    fs.mkdirSync(database, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(home, '.pki'), { mode: 0o700 });
    // Support Chromium before and after M146 with the same private database.
    fs.symlinkSync(database, path.join(home, '.pki', 'nssdb'), 'dir');
    certutil(['-N', '-d', `sql:${database}`, '--empty-password']);
    for (const cert of certificates) {
      const nickname = `mcp-ca-${cert.fingerprint.replaceAll(':', '')}`;
      const filename = path.join(home, `${nickname}.pem`);
      fs.writeFileSync(filename, cert.pem, { mode: 0o600 });
      certutil(['-A', '-d', `sql:${database}`, '-n', nickname, '-t', cert.root ? 'C,,' : ',,', '-a', '-i', filename]);
      fs.unlinkSync(filename);
    }
    // Playwright inherits this environment when launching Chromium. Node's TLS
    // settings stay unchanged; NODE_EXTRA_CA_CERTS must be set before Node starts.
    Object.assign(env, {
      HOME: home,
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      PLAYWRIGHT_BROWSERS_PATH: browserCache,
    });
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}

module.exports = { parseBundle, validateLocalBrowser, configureCABundle };
