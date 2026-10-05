/**
 * Client-Side Zero-Knowledge Encryption Utilities using Web Crypto API.
 * Uses PBKDF2 (100,000 iterations of SHA-256) for key derivation
 * and AES-GCM (256-bit with random 12-byte IV) for authenticated encryption.
 *
 * Payload wire layout:
 * [16 bytes Salt] + [12 bytes IV] + [Ciphertext + 16 bytes Auth Tag]
 */

const SALT_LENGTH = 16; // 128-bit PBKDF2 salt
const IV_LENGTH = 12; // 96-bit AES-GCM initialization vector
const PBKDF2_ITERATIONS = 100000;

export async function deriveEncryptionKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a File locally before transmission.
 * Returns a new File object containing [Salt (16B) | IV (12B) | Ciphertext].
 */
export async function encryptFileClientSide(file: File, passphrase: string): Promise<File> {
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveEncryptionKey(passphrase, salt);

  const fileBytes = await file.arrayBuffer();
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    fileBytes
  );

  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertextBuffer.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(ciphertextBuffer), SALT_LENGTH + IV_LENGTH);

  return new File([combined], file.name, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
}

/**
 * Decrypts an encrypted ArrayBuffer locally in browser memory.
 * Extracts the 16-byte salt, 12-byte IV, and decrypts the ciphertext.
 */
export async function decryptFileClientSide(
  encryptedData: ArrayBuffer,
  passphrase: string
): Promise<ArrayBuffer> {
  if (encryptedData.byteLength < SALT_LENGTH + IV_LENGTH) {
    throw new Error("Invalid encrypted payload: file is too small or corrupted.");
  }

  const uint8 = new Uint8Array(encryptedData);
  const salt = uint8.slice(0, SALT_LENGTH);
  const iv = uint8.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = uint8.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveEncryptionKey(passphrase, salt);

  try {
    return await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error("Decryption failed. Incorrect passphrase or corrupted data.");
  }
}
