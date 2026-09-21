import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateAuthorizationResponseIssuer } from "@modelcontextprotocol/client";
import { FileOAuthProvider, startLoopbackCallback } from "../oauth.js";

describe("OAuth issuer binding", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("persists issuer stamps and discovery across the redirect round trip", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "inspector-oauth-"));
    const options = {
      file: path.join(directory, "auth.json"),
      redirectUrl: "http://127.0.0.1:31234/callback",
      clientMetadata: { redirect_uris: ["http://127.0.0.1:31234/callback"], application_type: "native" },
      onRedirect: () => {},
    };
    const provider = new FileOAuthProvider(options);
    const issuer = "https://auth.example.com";
    await provider.saveClientInformation({ client_id: "client", issuer });
    await provider.saveTokens({ access_token: "token", token_type: "Bearer", issuer });
    await provider.saveCodeVerifier("verifier");
    await provider.saveDiscoveryState({ authorizationServerUrl: issuer, authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"] } });

    const restored = new FileOAuthProvider(options);
    expect((await restored.clientInformation())?.issuer).toBe(issuer);
    expect((await restored.tokens())?.issuer).toBe(issuer);
    expect((await restored.discoveryState())?.authorizationServerMetadata?.issuer).toBe(issuer);
    expect(await restored.codeVerifier()).toBe("verifier");
    await restored.invalidateCredentials("discovery");
    expect(await restored.discoveryState()).toBeUndefined();
    expect(await restored.tokens()).toBeDefined();
    await restored.invalidateCredentials("all");
    expect(await restored.tokens()).toBeUndefined();
    expect(await restored.clientInformation()).toBeUndefined();
    await expect(restored.codeVerifier()).rejects.toThrow();
  });

  it("retains the callback issuer so the SDK can reject a mismatch", async () => {
    const loopback = await startLoopbackCallback(0);
    try {
      const callback = loopback.waitForCode();
      const url = new URL(loopback.redirectUrl);
      url.searchParams.set("code", "code");
      url.searchParams.set("iss", "https://wrong.example.com");
      await fetch(url);
      const { iss } = await callback;
      expect(iss).toBe("https://wrong.example.com");
      expect(() => validateAuthorizationResponseIssuer({ iss: iss ?? undefined, expectedIssuer: "https://auth.example.com", issParameterSupported: true }))
        .toThrow();
    } finally {
      loopback.close();
    }
  });
});
