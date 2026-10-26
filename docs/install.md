---
title: Install
description: Every supported install path for Sourcey. npm, Homebrew, Docker, and Nix for the main CLI. Go, Homebrew, and Scoop for the standalone Go docs generator.
---

# Install

Install Sourcey with npm, Homebrew, Docker or Nix. Pick the one your project already uses.

## Sourcey CLI

The full Sourcey binary handles OpenAPI, MCP, Doxygen, godoc, rustdoc, MkDocs, and Markdown sources.

### npm

Requires Node.js 22.22.2 or later, 24.15 or later, or 26.

```bash
npm install -g sourcey
sourcey init
```

For one-shot use without a global install:

```bash
npx sourcey init
npm install
npm run dev
```

Stop the development server with Ctrl+C, then run `npm run build` to write the static site to `dist/`.

### Homebrew

Works on macOS and Linuxbrew.

```bash
brew tap sourcey/tap
brew install sourcey
sourcey init
npm install
sourcey dev
```

The formula installs Sourcey through Node under the hood, so it depends on `node`. If you already have Node, the npm path is a smaller install.

### Docker

The official `sourcey/sourcey` image runs every CLI command. The image's `WORKDIR` is `/docs` and its `ENTRYPOINT` is `sourcey`, so the first argument after the image name becomes the subcommand.

Initialize a new project (interactive):

```bash
docker run --rm -it -v "$PWD":/docs sourcey/sourcey init
```

Install the generated project's dependencies inside the container:

```bash
docker run --rm -v "$PWD":/docs --entrypoint npm sourcey/sourcey install
```

Build:

```bash
docker run --rm -v "$PWD":/docs sourcey/sourcey build
```

Run the dev server. The container needs `--host 0.0.0.0` so the dev server binds outside the loopback interface, and `-p 4400:4400` to forward the port to the host:

```bash
docker run --rm -p 4400:4400 -v "$PWD":/docs sourcey/sourcey dev --host 0.0.0.0
```

On Linux, files written by the container are owned by root by default. Pass `--user "$(id -u):$(id -g)"` to keep them owned by your user.

On Windows PowerShell, use `${PWD}` instead of `"$PWD"`.

### Nix

Requires a Nix install with flakes enabled. The generated project also needs Node.js 22.22.2 or later, 24.15 or later, or 26, and npm for its local dependencies.

One-shot run:

```bash
nix run github:sourcey/sourcey
```

Persistent install:

```bash
nix profile install github:sourcey/sourcey
sourcey init
npm install
sourcey dev
```

## Standalone Go docs generator

For Go-only consumers without a JavaScript toolchain, `sourcey-godoc` ships as a separate native binary. It produces static Go docs sites or portable `godoc.json` snapshots; no Sourcey npm package required.

### Go

```bash
go install github.com/sourcey/sourcey/go/sourcey-godoc/cmd/sourcey-godoc@latest
```

### Homebrew

```bash
brew tap sourcey/tap
brew install sourcey-godoc
```

### Scoop (Windows)

```powershell
scoop bucket add sourcey https://github.com/sourcey/scoop-bucket
scoop install sourcey-godoc
```

## Local development

To work on Sourcey itself:

```bash
git clone https://github.com/sourcey/sourcey.git
cd sourcey
npm install
npm run build && npm test
```
