import { describe, expect, test } from "bun:test";

import { buildServerPath } from "./server-url";

describe("frontend server paths", () => {
  test("uses same-origin relative paths when no build-time host is configured", () => {
    expect(buildServerPath("/oauth/google/start")).toBe("/oauth/google/start");
  });

  test("preserves an explicit server host for split deployments", () => {
    expect(buildServerPath("/api/session", "https://gateway.example.test")).toBe(
      "https://gateway.example.test/api/session",
    );
  });
});
