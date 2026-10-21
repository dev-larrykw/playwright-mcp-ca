# Publish this fork to GitHub and GHCR

Local directory: `/Users/larrywright/Documents/Obot/playwright-mcp-ca`.

The checkout uses `main`. Microsoft's repository is retained as the `upstream`
remote; `origin` is reserved for your own repository. Full upstream Git history
has been fetched so the initial push does not depend on a shallow clone.

## First push and release

Install GitHub CLI if needed (`brew install gh` on this Mac), then run:

```sh
cd /Users/larrywright/Documents/Obot/playwright-mcp-ca
gh auth login
git add .
git commit -m "feat(ca): support Linux CA bundles and GHCR releases"
gh repo create playwright-mcp-ca --private --source=. --remote=origin --push
gh release create v0.1.0 --target main --title "v0.1.0" --notes-file RELEASE-NOTES.md
gh run list --workflow publish.yml --limit 5
```

This creates the repository under your authenticated GitHub account. To use an
organization, replace `playwright-mcp-ca` in `gh repo create` with
`YOUR-ORG/playwright-mcp-ca`. Use `--public` instead of `--private` if appropriate.
The command creates an independent repository containing the upstream history;
it does not create GitHub's formal fork relationship.

If the destination repository already exists, replace the `gh repo create` step
with the following, using its actual URL:

```sh
git remote add origin https://github.com/YOUR-OWNER/playwright-mcp-ca.git
git push -u origin main
```

Run the commands in order and stop if a command fails. Nothing has been pushed
or released by the local setup. The first command sequence commits the prepared
changes before publishing.

## What the release does

Publishing a GitHub release triggers `.github/workflows/publish.yml`:

1. Install dependencies, NSS tools, and Chromium on an Ubuntu runner.
2. Run unit tests, the real browser CA tests, the CLI smoke test, and README checks.
3. Build Linux AMD64 and ARM64 images and push them using `GITHUB_TOKEN`.

For `v0.1.0`, the resulting image tags are:

```text
ghcr.io/your-owner/playwright-mcp-ca:v0.1.0
ghcr.io/your-owner/playwright-mcp-ca:0.1.0
ghcr.io/your-owner/playwright-mcp-ca:latest
```

The owner/repository portion is lowercased automatically. Prereleases get version
tags only; they do not update `latest`. `vX.Y.Z` and `vX.Y.Z-rc.N` are supported tag
formats. The container version is independent of the retained upstream npm
package version. The fork's release workflow publishes only to GHCR.

The GitHub release is created first; the image becomes available only after the
workflow succeeds. A failed test or build prevents publishing. Inspect progress
with `gh run list --workflow publish.yml`, then `gh run watch RUN_ID --exit-status`.
After correcting a failure, release a new version; for a transient failure you
can rerun the failed Actions run.

GitHub Actions must be enabled and organization policy must allow the workflow's
`packages: write` permission. No separate publishing PAT is required for a new
package linked to this repository. GHCR packages are initially private; adjust
package visibility in GitHub if you need anonymous pulls. For private images,
authenticate the deployment host to GHCR with an account/token authorized to
read the package.

## Pull and run

After publication, replace `your-owner` and the bundle path:

```sh
docker pull ghcr.io/your-owner/playwright-mcp-ca:v0.1.0
docker run --rm -i --init \
  --mount type=bind,src=/absolute/host/company-ca-bundle.pem,dst=/certs/company.pem,readonly \
  -e NODE_EXTRA_CA_CERTS=/certs/company.pem \
  -e PLAYWRIGHT_MCP_CA_BUNDLE=/certs/company.pem \
  ghcr.io/your-owner/playwright-mcp-ca:v0.1.0
```

The MCP server speaks stdio, so use `-i` without `-t`. The image runs headless;
it does not open a browser window on the host. The CA is mounted at runtime and
is not included in the image. See `CA-BUNDLE.md` for native headed browser usage.

## Later releases

Commit your changes, push `main`, and choose a new version:

```sh
git push origin main
gh release create v0.1.1 --target main --title "v0.1.1" --generate-notes
```

References: [GitHub repository creation](https://cli.github.com/manual/gh_repo_create),
[GitHub releases](https://cli.github.com/manual/gh_release_create), and
[GHCR publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
