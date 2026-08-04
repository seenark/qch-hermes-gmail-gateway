import { describe, expect, test } from "bun:test";

import { decryptSecret, encryptSecret, hashOpaqueToken, timingSafeStringEqual } from "./secrets";

describe("server secret boundary", () => {
  test("encrypts and decrypts a refresh token without storing plaintext", async () => {
    const key = new Uint8Array(32);
    key.fill(7);

    const encrypted = await encryptSecret("refresh-token-value", key);

    expect(encrypted.ciphertext).not.toContain("refresh-token-value");
    expect(Buffer.from(encrypted.iv, "base64url")).toHaveLength(12);
    expect(await decryptSecret(encrypted, key)).toBe("refresh-token-value");
  });

  test("rejects decryption with a different key", async () => {
    const firstKey = new Uint8Array(32).fill(1);
    const secondKey = new Uint8Array(32).fill(2);
    const encrypted = await encryptSecret("refresh-token-value", firstKey);

    await expect(decryptSecret(encrypted, secondKey)).rejects.toThrow();
  });

  test("hashes opaque tokens and compares them in constant time", async () => {
    const token = "session-token";
    const hash = await hashOpaqueToken(token);

    expect(hash).not.toBe(token);
    expect(timingSafeStringEqual(hash, await hashOpaqueToken(token))).toBe(true);
    expect(timingSafeStringEqual(hash, await hashOpaqueToken("other-token"))).toBe(false);
  });
});
