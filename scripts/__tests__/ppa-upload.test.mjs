import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadWithRetry } from "../ppa-upload-retry.mjs";

const args = ["ppa:ropi11/mcp-inspector", "/tmp/mcp-inspector_1.8.3-0ubuntu1~26.04.1_source.changes"];

test("a successful upload runs once without waiting", async () => {
  const calls = [];
  await uploadWithRetry(args, {
    run: (...call) => calls.push(call),
    wait: () => assert.fail("Successful uploads must not wait"),
    warn: () => assert.fail("Successful uploads must not warn"),
  });
  assert.deepEqual(calls, [["dput", args, { stdio: "inherit" }]]);
});

test("failed transfers retry the same signed source upload with increasing delays", async () => {
  const calls = [];
  const delays = [];
  const warnings = [];
  await uploadWithRetry(args, {
    run: (...call) => {
      calls.push(call);
      if (calls.length < 3) throw Object.assign(new Error("550 Requested action not taken: internal server error"), { status: 1 });
    },
    wait: async (delay) => delays.push(delay),
    warn: (message) => warnings.push(message),
  });
  assert.equal(calls.length, 3);
  for (const call of calls) assert.deepEqual(call, ["dput", args, { stdio: "inherit" }]);
  assert.deepEqual(delays, [10000, 20000]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((message) => message.includes(args[1])));
});

test("a persistent upload failure stops after four attempts and preserves the error", async () => {
  const error = Object.assign(new Error("Launchpad unavailable"), { status: 1 });
  let calls = 0;
  const delays = [];
  await assert.rejects(uploadWithRetry(args, {
    run: () => {
      calls++;
      throw error;
    },
    wait: async (delay) => delays.push(delay),
    warn: () => {},
  }), (actual) => actual === error);
  assert.equal(calls, 4);
  assert.deepEqual(delays, [10000, 20000, 40000]);
});

test("missing commands and terminated uploads fail without retries", async () => {
  for (const error of [Object.assign(new Error("dput missing"), { code: "ENOENT" }), Object.assign(new Error("dput terminated"), { status: null, signal: "SIGTERM" })]) {
    let calls = 0;
    await assert.rejects(uploadWithRetry(args, {
      run: () => {
        calls++;
        throw error;
      },
      wait: () => assert.fail("Non-exit failures must not wait"),
      warn: () => assert.fail("Non-exit failures must not warn"),
    }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});
