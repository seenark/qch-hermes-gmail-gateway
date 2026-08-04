import { describe, expect, test } from "bun:test";

import {
  buildGoogleAuthorizationUrl,
  createPkcePair,
  createOAuthState,
  isGoogleEmailVerified,
  isAllowedGoogleAccount,
  validateOAuthState,
} from "./oauth";

describe("Google OAuth security boundary", () => {
  test("creates a URL with readonly Gmail scope and PKCE parameters", async () => {
    const pkce = await createPkcePair();
    const state = createOAuthState();

    const url = buildGoogleAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "https://gateway.example.test/oauth/google/callback",
      state,
      codeChallenge: pkce.codeChallenge,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    const params = new URL(url).searchParams;

    expect(params.get("client_id")).toBe("client-id");
    expect(params.get("redirect_uri")).toBe("https://gateway.example.test/oauth/google/callback");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent select_account");
    expect(params.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(params.get("state")).toBe(state);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBe(pkce.codeChallenge);
  });

  test("rejects a state value that does not match the stored state", () => {
    expect(validateOAuthState("expected-state", "expected-state")).toBe(true);
    expect(validateOAuthState("expected-state", "attacker-state")).toBe(false);
    expect(validateOAuthState("expected-state", "")).toBe(false);
  });

  test("allows only verified accounts in the configured company domain", () => {
    expect(
      isAllowedGoogleAccount({
        email: "alice@company.example",
        emailVerified: true,
        hostedDomain: "company.example",
        allowedDomain: "company.example",
      }),
    ).toBe(true);
    expect(
      isAllowedGoogleAccount({
        email: "alice@company.example",
        emailVerified: false,
        hostedDomain: "company.example",
        allowedDomain: "company.example",
      }),
    ).toBe(false);
    expect(
      isAllowedGoogleAccount({
        email: "alice@not-company.example",
        emailVerified: true,
        hostedDomain: "not-company.example",
        allowedDomain: "company.example",
      }),
    ).toBe(false);
    expect(
      isAllowedGoogleAccount({
        email: "alice@company.example.attacker.test",
        emailVerified: true,
        hostedDomain: "company.example.attacker.test",
        allowedDomain: "company.example",
      }),
    ).toBe(false);
  });

  test("allows any verified account only when development test mode is explicit", () => {
    expect(
      isAllowedGoogleAccount({
        email: "tester@gmail.com",
        emailVerified: true,
        allowedDomain: "company.example",
        allowAnyVerifiedAccount: true,
      }),
    ).toBe(true);
    expect(
      isAllowedGoogleAccount({
        email: "tester@gmail.com",
        emailVerified: false,
        allowedDomain: "company.example",
        allowAnyVerifiedAccount: true,
      }),
    ).toBe(false);
  });

  test("accepts Google's verified_email tokeninfo field", () => {
    expect(isGoogleEmailVerified({ verified_email: true })).toBe(true);
    expect(isGoogleEmailVerified({ verified_email: "true" })).toBe(true);
    expect(isGoogleEmailVerified({ verified_email: false })).toBe(false);
  });
});
