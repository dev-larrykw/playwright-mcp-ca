Initial container release of Playwright MCP with Linux CA bundle support.

- Accept a PEM CA bundle through `--ca-bundle` or `PLAYWRIGHT_MCP_CA_BUNDLE`.
- Import roots and intermediates into an isolated NSS certificate database before Chromium starts.
- Preserve Node's existing `NODE_EXTRA_CA_CERTS` configuration and HTTPS certificate validation.
- Package NSS tools in the container image.
- Publish Linux AMD64 and ARM64 images to GHCR after Linux CA validation tests pass.

Supply company CA certificates at runtime using a read-only mount. See `CA-BUNDLE.md`
for configuration and `RELEASING.md` for the image tags and release process.
