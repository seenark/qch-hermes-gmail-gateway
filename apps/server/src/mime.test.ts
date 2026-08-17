import { describe, expect, test } from "bun:test";

import { encodeMimeHeader } from "./mime";

describe("encodeMimeHeader", () => {
  test("keeps printable ASCII headers readable", () => {
    expect(encodeMimeHeader("Build complete")).toBe("Build complete");
  });

  test("encodes Thai headers as RFC 2047 UTF-8 base64 words", () => {
    const encoded = encodeMimeHeader("[ทดสอบภาษาไทย QCH] สอบถามเรื่องสร้างบ้าน");
    expect(encoded).toContain("=?UTF-8?B?");
    expect(encoded.split("\r\n ").every((word) => word.length <= 75)).toBe(true);
    expect(
      Buffer.from(encoded.match(/\?B\?([^?]+)\?=/)?.[1] ?? "", "base64").toString("utf8"),
    ).toContain("ทดสอบ");
  });

  test("does not split a UTF-8 code point across encoded words", () => {
    const encoded = encodeMimeHeader("ก".repeat(100));
    const decoded = encoded
      .split("\r\n ")
      .map((word) => Buffer.from(word.slice(MIME_PREFIX_LENGTH, -2), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("ก".repeat(100));
  });
});

const MIME_PREFIX_LENGTH = "=?UTF-8?B?".length;
