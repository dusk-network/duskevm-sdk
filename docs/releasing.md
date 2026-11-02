# Releasing

A `v*` tag publishes that version to JSR through `.github/workflows/publish.yml`,
authenticated through this repository's GitHub OIDC token. npm publishing is
still manual.

## Prerequisites

- The npm `@dusk` organization grants publish access to `evm-sdk`.
- The JSR `@dusk/evm-sdk` package exists and the publisher is a scope member.
- `package.json` and `jsr.json` contain the same name and version.
- Prereleases use a SemVer prerelease and the npm `beta` dist-tag.
- The release commit is on `main` and the worktree is clean.

## Verify

```sh
npm ci
npm run release:verify
npm run release:pack
```

Inspect the generated tarball before publishing. The verification command checks
that the release is on a clean `main` branch, then checks generated interfaces,
types, tests, public documentation, packed contents, all subpath imports, a Vite
browser bundle, JSR rules, and npm's publish dry run.

## Publish npm Prerelease

```sh
npm publish --access public --tag beta
```

Confirm that `latest` was not changed:

```sh
npm view @dusk/evm-sdk dist-tags
```

## Publish JSR Prerelease

Push the release tag from the release commit on `main`:

```sh
git tag v0.1.0-beta.4
git push origin v0.1.0-beta.4
```

The Publish workflow checks that the tagged commit is on `main` and that the tag
matches `package.json` and `jsr.json`, runs `npm run check`, and publishes with
provenance. It skips a version JSR already has, so a failed run can be run
again.

After the first JSR publish, set the package description and mark Node.js, Deno,
and browsers as supported in the package settings. Leave Bun and Cloudflare
Workers as unknown until they have dedicated compatibility coverage.

## Promote to Stable

After the wallet integration has exercised deposit and withdrawal workflows,
remove the beta suffix, remove the `publishConfig.tag` override, update this
changelog, rerun the release verification, and publish `0.1.0` to `latest`.
