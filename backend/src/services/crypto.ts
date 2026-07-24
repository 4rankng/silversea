// At-rest secret encryption for DB-stored credentials (LLM API keys, etc.).
//
// AES-256-GCM: authenticated, so tampered ciphertext fails to decrypt. Output
// is a single self-describing string:
//
//     enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
//
// `decryptSecret` is *pass-through* for anything without the `enc:v1:` prefix.
// That keeps reads resilient to legacy plaintext values (e.g. rows written
// before encryption rolled out) without a separate migration step.
//
// Master key resolution (first non-empty wins):
//   1. SETTINGS_ENCRYPTION_KEY — 32 bytes, base64 or hex (recommended for prod)
//   2. sha256(JWT_SECRET)      — keeps existing deployments working without a
//                                new env var; we log a one-time prod warning.
//
// WARNING: changing the master key makes previously-encrypted values
// undecryptable. Rotate by decrypting under the old key and re-encrypting.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { config } from '../config';

const PREFIX = 'enc:v1:';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit IV — the GCM convention

let cachedKey: Buffer | null = null;
let warnedFallback = false;

/** Resolve the 32-byte master key (cached). See module header for precedence. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const explicit = config.settingsEncryptionKey?.trim();
  if (explicit) {
    const key = decodeKeyMaterial(explicit);
    if (key.length === KEY_BYTES) {
      cachedKey = key;
      return key;
    }
    throw new Error(
      `SETTINGS_ENCRYPTION_KEY phải là 32 byte (base64 hoặc hex), nhận được ${key.length} byte`,
    );
  }

  // Fallback: derive from JWT_SECRET so the feature works out-of-the-box for
  // existing dev/prod deployments that haven't set an explicit key.
  if (config.nodeEnv === 'production' && !warnedFallback) {
    warnedFallback = true;
    console.warn(
      '⚠️  SETTINGS_ENCRYPTION_KEY chưa đặt — deriving from JWT_SECRET. Set an explicit key in production for clean rotation.',
    );
  }
  cachedKey = createHash('sha256').update(config.jwtSecret).digest();
  return cachedKey;
}

/** Accept base64 or hex of any byte length; reject otherwise (caller checks length). */
function decodeKeyMaterial(raw: string): Buffer {
  // A 32-byte hex key is also syntactically valid base64, so detect hex first.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return Buffer.from(raw, 'base64');
}

/** Encrypt a plaintext secret into the `enc:v1:` transport format. */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext === '') return '';
  // Idempotent: never double-encrypt an already-encrypted value.
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt an `enc:v1:` payload. Returns the input unchanged when it isn't
 *  encrypted (legacy plaintext pass-through), and `''` for empty input. */
export function decryptSecret(payload: string): string {
  if (!payload) return '';
  if (!payload.startsWith(PREFIX)) return payload; // plaintext pass-through

  const parts = payload.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Mã hóa secret không hợp lệ (định dạng enc:v1 iv:tag:ct)');
  }
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

/** Mask a key for safe display — shows only the last 4 chars. Returns an empty
 *  string when the key is empty, and '••••' when it's too short to safely mask. */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return '••••••••' + key.slice(-4);
}
