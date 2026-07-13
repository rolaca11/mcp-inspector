const { execFileSync } = require("node:child_process");
const { basename } = require("node:path");
const { closeSync, openSync, writeSync } = require("node:fs");

const GITHUB_OWNER = "rolaca11";
const GITHUB_REPOSITORY = "mcp-inspector";

function embedUpdateInformation(appImage) {
  const artifactName = basename(appImage);
  const zsyncName = `${artifactName}.zsync`;
  const updateInformation = [
    "gh-releases-zsync",
    GITHUB_OWNER,
    GITHUB_REPOSITORY,
    "latest",
    zsyncName,
  ].join("|");

  const sections = execFileSync("readelf", ["--sections", "--wide", appImage], {
    encoding: "utf8",
  });
  const section = sections.match(
    /^\s*\[\s*\d+\]\s+\.upd_info\s+\S+\s+\S+\s+([0-9a-f]+)\s+([0-9a-f]+)/im,
  );

  if (!section) {
    throw new Error(`Could not find the .upd_info section in ${appImage}`);
  }

  const offset = Number.parseInt(section[1], 16);
  const size = Number.parseInt(section[2], 16);
  const contents = Buffer.alloc(size);
  const updateLength = contents.write(updateInformation, "utf8");

  if (updateLength !== Buffer.byteLength(updateInformation)) {
    throw new Error(`Update information does not fit in ${appImage}'s .upd_info section`);
  }

  const file = openSync(appImage, "r+");
  try {
    writeSync(file, contents, 0, contents.length, offset);
  } finally {
    closeSync(file);
  }

  const zsyncPath = `${appImage}.zsync`;
  execFileSync(
    "zsyncmake",
    ["-u", artifactName, "-o", zsyncPath, appImage],
    { stdio: "inherit" },
  );

  return zsyncPath;
}

exports.afterAllArtifactBuild = function afterAllArtifactBuild(buildResult) {
  return buildResult.artifactPaths
    .filter((artifact) => artifact.endsWith(".AppImage"))
    .map(embedUpdateInformation);
};
