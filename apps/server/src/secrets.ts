export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
}

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function importKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) {
    throw new Error("Secret encryption key must be exactly 32 bytes");
  }

  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, rawKey: Uint8Array): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importKey(rawKey),
    new TextEncoder().encode(value),
  );

  return { ciphertext: encode(new Uint8Array(ciphertext)), iv: encode(iv) };
}

export async function decryptSecret(
  encrypted: EncryptedSecret,
  rawKey: Uint8Array,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(encrypted.iv) },
    await importKey(rawKey),
    decode(encrypted.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

export async function hashOpaqueToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
