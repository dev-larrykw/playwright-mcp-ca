# Linux CA bundle support

Status: local prototype based on upstream commit
`ab6d67cbf8b619338f096980806fdbe29432cc4d`. Seven unit tests, CLI help, npm packaging,
and upstream's README generation check passed on the development Mac. The Linux
browser test has not been executed here because Docker is unresponsive; it is
included below and wired into the fork's Ubuntu CI job. No remote fork has been
published.

This local fork adds `--ca-bundle /absolute/path/company-ca-bundle.pem` and the
equivalent `PLAYWRIGHT_MCP_CA_BUNDLE` environment variable for locally launched
Chromium-family browsers on Linux, WSL, and Linux containers.

Node and Chromium use separate certificate trust settings. Keep your existing
`NODE_EXTRA_CA_CERTS` setting for Node. The new option imports the supplied CA
certificates into a temporary NSS database before the browser starts.
HTTPS certificate validation remains enabled.

## Install on Debian or Ubuntu, including WSL

From this fork's directory:

```sh
sudo apt-get update
sudo apt-get install -y libnss3-tools
npm ci
node cli.js install-browser chromium
```

On Fedora/RHEL, install `nss-tools` instead. Set `NODE_EXTRA_CA_CERTS` before npm
installation and browser downloads if your network requires it. Your existing
approved package and browser mirrors can be used in a restricted network.

In Claude Code's project `.mcp.json`, merge the following server entry, replacing
the example paths with absolute **Linux** paths:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": [
        "/opt/playwright-mcp-ca/cli.js",
        "--browser", "chromium",
        "--ca-bundle", "/etc/company/company-ca-bundle.pem"
      ],
      "env": {
        "NODE_EXTRA_CA_CERTS": "/etc/company/company-ca-bundle.pem"
      }
    }
  }
}
```

Restart/reconnect the MCP server after changing the configuration or bundle.
Add `--headless` if you do not want a visible browser. For Claude Code running on
Windows with a Linux/WSL MCP server, launch this command through your existing WSL
launcher; Windows certificate stores are not the Linux browser's NSS database.

## Container deployment

The fork's Dockerfile adds NSS `certutil` and packages `ca-bundle.js`. Build with
your organization's approved build configuration, then mount the bundle at runtime:

```sh
docker build -t playwright-mcp-ca .
docker run --rm -i --init \
  --mount type=bind,src=/absolute/host/company-ca-bundle.pem,dst=/certs/company.pem,readonly \
  -e NODE_EXTRA_CA_CERTS=/certs/company.pem \
  -e PLAYWRIGHT_MCP_CA_BUNDLE=/certs/company.pem \
  playwright-mcp-ca
```

The runtime mount does not configure trust for `apt`, npm, or browser downloads
during image construction. Those build steps still need your existing CA/mirror
configuration. The container inherits upstream's headless launch settings.

## Behavior and scope

- Only self-signed CA roots receive NSS SSL-server trust (`C,,`). Intermediate
  CAs are imported without promoting them to trust anchors (`,,`). Bundles must
  include at least one valid root; leaf certificates and private keys are rejected.
- Both `$HOME/.pki/nssdb` and `$HOME/.local/share/pki/nssdb` point to the same
  temporary database. The second location became Chromium's default in M146.
- The MCP process and its browser children receive a temporary HOME and XDG
  directories. Existing OS and user certificate stores are untouched. Downloads
  remain available through the preserved `PLAYWRIGHT_BROWSERS_PATH` setting.
- Default browser profiles are temporary. Use `--user-data-dir` with an absolute
  path if you need persistent browser sessions. Tools or plugins that depend on
  other files in the user's original HOME may need explicit paths.
- Temporary trust files are deleted on normal process exit. A forced termination
  such as SIGKILL may leave a `playwright-mcp-ca-*` directory in the temp directory.
- CDP, remote browser endpoints, browser extensions, non-Chromium browsers, and
  custom `browser.launchOptions.env` are rejected with this option. A browser
  running elsewhere must have trust configured where it runs.
- This feature is implemented in the CLI. Programmatic `createConnection()` calls
  do not automatically invoke the bootstrap.
- Keep the bundle outside the source repository. This checkout retains upstream's
  package identity; choose your own package name before publishing an npm fork.

## Verification

```sh
node --test test-ca/unit.test.cjs
node --test test-ca/browser.test.cjs
```

The browser test requires Linux, NSS certutil, OpenSSL, installed dependencies,
and Playwright Chromium. It creates temporary test CAs and verifies all four:
the private site fails before import, works after import, an unknown certificate
still fails, and a hostname mismatch still fails. It skips on non-Linux hosts.

Reference: [Chromium Linux certificate management](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/cert_management.md).
