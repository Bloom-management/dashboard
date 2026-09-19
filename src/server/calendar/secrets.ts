import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { CalendarError } from './errors';
import { validateUrl } from './fetch';
import type { Provider } from './types';
function key() {
  const value = process.env.CALENDAR_ENCRYPTION_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(value)) throw new CalendarError('CONFIGURATION_ERROR', 503);
  return Buffer.from(value, 'hex');
}
export function protectUrl(input: string, provider: Provider, propertyId: string) {
  const url = validateUrl(input, provider); const secret = key(); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(Buffer.from(`${propertyId}:${provider}`));
  const ciphertext = Buffer.concat([cipher.update(url.href, 'utf8'), cipher.final()]);
  return { encryptedUrl: ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.'),
    // Provider export path is stable through token/locale changes. Identity is scoped to property.
    urlDigest: createHmac('sha256', secret).update(url.href).digest('hex'),
    fingerprint: createHmac('sha256', secret).update(`${propertyId}:${provider}:${url.pathname}`).digest('hex') };
}
export function revealUrl(value: string, provider: Provider, propertyId: string) {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || extra || !ciphertext) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${propertyId}:${provider}`)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new CalendarError('CONFIGURATION_ERROR', 503); }
}
