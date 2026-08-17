const MIME_WORD_PREFIX = "=?UTF-8?B?";
const MIME_WORD_SUFFIX = "?=";
const MAX_ENCODED_WORD_LENGTH = 75;

function isContinuationByte(value: number): boolean {
  return (value & 0xc0) === 0x80;
}

/** Encode a mail header value using RFC 2047 UTF-8 encoded-words when needed. */
export function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;

  const bytes = Buffer.from(value, "utf8");
  const maxBase64Length =
    MAX_ENCODED_WORD_LENGTH - MIME_WORD_PREFIX.length - MIME_WORD_SUFFIX.length;
  const maxBytesPerWord = Math.floor(maxBase64Length / 4) * 3;
  const words: string[] = [];

  for (let offset = 0; offset < bytes.length;) {
    let end = Math.min(offset + maxBytesPerWord, bytes.length);
    while (end > offset && end < bytes.length && isContinuationByte(bytes[end] ?? 0)) end -= 1;
    if (end === offset) end = Math.min(offset + maxBytesPerWord, bytes.length);
    words.push(
      `${MIME_WORD_PREFIX}${bytes.subarray(offset, end).toString("base64")}${MIME_WORD_SUFFIX}`,
    );
    offset = end;
  }

  return words.join("\r\n ");
}
