# PPA publishing

The PPA is `ppa:ropi11/mcp-inspector`, owned by the
[ropi11 team](https://launchpad.net/~ropi11). It targets the Ubuntu releases in
standard support as of October 2026, on amd64:

| Ubuntu | Series |
| --- | --- |
| 22.04 LTS | jammy |
| 24.04 LTS | noble |
| 26.04 LTS | resolute |
| 26.10 | stonking |

The package installs the desktop app, the `mcp-inspector://` handler, and the
`mcp-inspector` command. The owner and release matrix live in `debian/ppa.json`.
Commands live in `/usr/bin`, private application files in `/usr/lib/mcp-inspector`,
and the desktop entry in `/usr/share/applications`.
Update the matrix when Ubuntu releases enter or leave standard support, using
the [Ubuntu release cycle](https://ubuntu.com/about/release-cycle).

Launchpad rebuilds the web dashboard and Electron application code from source.
The source archive includes the locked npm dependencies and the upstream Electron
Linux runtime so that the build can run without network access. It does not
compile Electron or Chromium. Builds use Electron's bundled Node runtime, so
the older Node.js versions in Ubuntu 22.04 and 24.04 are not a build dependency.
The runtime and npm dependencies include native binaries, so prepare the archive
on Linux amd64.

## CI and release uploads

The reusable `.github/workflows/ppa.yml` workflow prepares one source archive,
then builds and tests each configured Ubuntu release in a container with
networking disabled. Pull requests and pushes to `main` run these checks with
version `0.0.0`. They do not upload to Launchpad or receive signing credentials.

The Release workflow calls the same checks for the release tag. Stable releases
then sign and upload all source packages after every Ubuntu check passes.
Prereleases skip PPA publishing. GitHub Actions retains the source archive and
verification reports for three days.
The release version check rejects an upstream version already present in the PPA
before creating a Git tag or publishing other artifacts. Version `1.8.2` was
uploaded during setup, so the next application release must use a newer version.

The repository needs two Actions secrets:

- `PPA_GPG_PRIVATE_KEY`, an ASCII-armored export of the registered key's signing
  subkey. Export it with `gpg --armor --export-secret-subkeys SUBKEY_FINGERPRINT!`.
- `PPA_GPG_PASSPHRASE`, the passphrase protecting that subkey. Leave it unset only
  if the exported subkey has no passphrase.

The public primary-key fingerprint is `signingKey` in `debian/ppa.json`. The
upload job imports the subkey into a temporary keyring, tests a signature, and
uses loopback pinentry for noninteractive signing. It removes the keyring and
passphrase file after the upload step, including on failure.

The upload job completes after transferring the signed source packages.
Launchpad accepts, builds, and publishes them asynchronously. Its build results
and notification emails remain the publication check.

## Create the archive

Sign in to Launchpad with an account that can administer `ropi11` and
[create the team's PPA](https://launchpad.net/~ropi11/+activate-ppa), named
`mcp-inspector`. Its page is
[ropi11/mcp-inspector](https://launchpad.net/~ropi11/+archive/ubuntu/mcp-inspector).
Register your OpenPGP signing key on your personal Launchpad member account
at [OpenPGP keys](https://launchpad.net/~/+editpgpkeys). Complete the key ownership
verification before uploading.

Install the preparation tools on Ubuntu 26.04. Bun must also be on your PATH.

```bash
sudo apt install build-essential debhelper devscripts dput nodejs unzip xz-utils
```

From the project root, prepare a stable version:

```bash
bun run ppa:source --version 1.8.2
```

This packages the current contents of Git-tracked files. Add new source files to
Git before preparing a release. It installs dependencies in a separate
directory with `bun install --frozen-lockfile --ignore-scripts`, fetches the
Electron runtime through `@electron/get` with checksum verification, and creates
one original tarball and a separate unsigned source upload for every configured
Ubuntu series under `release/ppa`. Each source upload references the exact same
original tarball. `manifest.json` lists the upload target and changes files.
It leaves the working tree's versions and dependencies unchanged.

Use `--series jammy` or `--series jammy,noble` to prepare a subset. Unknown or
duplicate series fail before creating any output.

Use `--maintainer 'Name <email>'` if your signing identity differs from the
default maintainer in `debian/control`. Use `--output DIRECTORY` to prepare another
version without overwriting an earlier build. The script refuses to overwrite
an existing source directory or original tarball.

## Verify the build

Verify every source upload in its own Ubuntu container:

```bash
bun run ppa:verify --engine podman
```

Use `--series jammy` to test one release, or `--engine docker` to use Docker.
Each run needs a source directory without an earlier `verify-SERIES` extraction.
The image installs the build dependencies declared in `debian/control` and the
runtime libraries needed for smoke checks. The offline container has no Node.js,
Bun, npm, or existing Electron cache.

## Sign and upload

Find the fingerprint of the key registered with Launchpad:

```bash
gpg --list-secret-keys --keyid-format long
```

Use the full signing fingerprint to sign every source changes file and upload
the matrix to the configured team PPA:

```bash
SIGNING_KEY=your-signing-key-fingerprint
bun run ppa:upload --key "$SIGNING_KEY" --dry-run
bun run ppa:upload --key "$SIGNING_KEY"
```

The upload command validates the manifest, signs all source uploads with
`debsign`, then sends them with `dput`. It uploads only `_source.changes` files
and their referenced source files. Launchpad builds the `.deb` itself. Check the
acceptance email and the PPA's package page for every series before announcing
installation instructions.

Each failed `dput` transfer gets up to four attempts, with delays of 10, 20, and
40 seconds. Retries use the same signed files and do not repeat earlier completed
uploads. Signing failures stop immediately. If the job still fails, rerun only
the failed job while its source artifact is available. Do not rerun the full
release or regenerate the original archive for a version already accepted by
Launchpad.

For noninteractive signing, add `--batch --passphrase-file PATH`. Use
`--sign-only` to prepare signed uploads without transferring them. Omitting
`--key` uses the configured `signingKey` fingerprint.

After publication, users can install it with:

```bash
sudo add-apt-repository ppa:ropi11/mcp-inspector
sudo apt update
sudo apt install mcp-inspector
```

## Later uploads

Use a new application version for each release. The `--revision` option sets
the Debian revision when preparing an unpublished version. For example,
`--revision 2` produces `1.8.2-0ubuntu2~22.04.1` for jammy. Numeric Ubuntu
versions in the suffix keep upgrade ordering correct across Ubuntu releases.

Once Launchpad accepts an original tarball for an application version, reuse that
exact `.orig.tar.xz` for subsequent revisions and Ubuntu series:

```bash
bun run ppa:source --version 1.8.2 --revision 2 \
  --orig-tarball release/ppa/mcp-inspector_1.8.2.orig.tar.xz \
  --output release/ppa-r2
```

This extracts the existing source archive, copies the current Debian packaging,
and records launcher and package-verification changes as quilt patches. It does
not reinstall dependencies or change the original archive. The resulting source
uploads share the original archive's checksum. Do not regenerate the dependency
archive for an already published application version.
Revision uploads omit the original archive because Launchpad already has it.

Ubuntu Pro and legacy releases are outside this matrix. Additional architectures
need their own dependency bundle and Electron runtime; the current packaging
declares amd64.

See Launchpad's [source build and upload guide](https://ubuntu.com/docs/launchpad/user/how-to/packaging/build-deb-packages-in-launchpad/)
for account setup, signature requirements, and upload troubleshooting.
