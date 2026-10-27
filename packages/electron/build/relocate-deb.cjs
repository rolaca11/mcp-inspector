const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

exports.relocateDeb = function relocateDeb(artifact) {
  artifact = path.resolve(artifact);
  const temporary = mkdtempSync(path.join(path.dirname(artifact), ".deb-layout-"));
  const root = path.join(temporary, "root");
  const previous = "/opt/MCP Inspector";
  const destination = "/usr/lib/mcp-inspector";
  try {
    execFileSync("dpkg-deb", ["--raw-extract", artifact, root], { stdio: "inherit" });
    mkdirSync(path.join(root, "usr/lib"), { recursive: true });
    renameSync(path.join(root, previous), path.join(root, destination));
    rmdirSync(path.join(root, "opt"));
    for (const relative of [
      "DEBIAN/postinst",
      "DEBIAN/postrm",
      "usr/share/applications/mcp-inspector-desktop.desktop",
      "usr/lib/mcp-inspector/resources/apparmor-profile",
    ]) {
      const file = path.join(root, relative);
      if (existsSync(file)) writeFileSync(file, readFileSync(file, "utf8").replaceAll(previous, destination));
    }
    const checksums = [];
    function collectChecksums(directory, relative = "") {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!relative && entry.name === "DEBIAN") continue;
        const file = path.join(directory, entry.name);
        const installed = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) collectChecksums(file, installed);
        else if (entry.isFile()) checksums.push(`${createHash("md5").update(readFileSync(file)).digest("hex")}  ${installed}`);
      }
    }
    collectChecksums(root);
    writeFileSync(path.join(root, "DEBIAN/md5sums"), `${checksums.sort().join("\n")}\n`);
    const output = path.join(temporary, "package.deb");
    execFileSync("dpkg-deb", ["--build", "--root-owner-group", root, output], { stdio: "inherit" });
    copyFileSync(output, artifact);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};
