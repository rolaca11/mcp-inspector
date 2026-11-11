import assert from "node:assert/strict";
import { test } from "node:test";
import { publishedVersions } from "../ppa-published.mjs";

const ppa = { owner: "ropi11", name: "mcp-inspector" };
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("versions from every listing page are collected", async () => {
  const urls = [];
  const pages = [
    reply({ entries: [{ source_package_version: "1.8.5-0ubuntu1~24.04.1" }], next_collection_link: "https://api.launchpad.net/page-2" }),
    reply({ entries: [{ source_package_version: "1.8.4-0ubuntu1~22.04.1" }] }),
  ];
  const versions = await publishedVersions(ppa, {
    get: async (url) => {
      urls.push(url);
      return pages.shift();
    },
    wait: () => assert.fail("Successful listings must not wait"),
    warn: () => assert.fail("Successful listings must not warn"),
  });
  assert.deepEqual([...versions], ["1.8.5-0ubuntu1~24.04.1", "1.8.4-0ubuntu1~22.04.1"]);
  assert.equal(new URL(urls[0]).pathname, "/1.0/~ropi11/+archive/ubuntu/mcp-inspector");
  assert.equal(new URL(urls[0]).searchParams.get("ws.op"), "getPublishedSources");
  assert.equal(urls[1], "https://api.launchpad.net/page-2");
});

test("failed listings retry with increasing delays", async () => {
  let calls = 0;
  const delays = [];
  const versions = await publishedVersions(ppa, {
    get: async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      if (calls === 2) return reply({}, 503);
      return reply({ entries: [{ source_package_version: "1.8.5-0ubuntu1~26.04.1" }] });
    },
    wait: async (delay) => delays.push(delay),
    warn: () => {},
  });
  assert.deepEqual([...versions], ["1.8.5-0ubuntu1~26.04.1"]);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10000, 20000]);
});

test("a persistent listing failure stops after four attempts and preserves the error", async () => {
  const error = new TypeError("fetch failed");
  let calls = 0;
  await assert.rejects(publishedVersions(ppa, {
    get: async () => {
      calls++;
      throw error;
    },
    wait: async () => {},
    warn: () => {},
  }), (actual) => actual === error);
  assert.equal(calls, 4);
});
