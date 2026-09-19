import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import type { Provider } from './types';
import { CalendarError } from './errors';
export function validateUrl(input: string, provider: Provider): URL {
  try {
    const url = new URL(input);
    const valid = provider === 'airbnb'
      ? url.hostname === 'www.airbnb.com' && /^\/calendar\/ical\/\d+\.ics$/.test(url.pathname)
      : provider === 'vrbo' && url.hostname === 'www.vrbo.com' && /^\/icalendar\/[a-f\d]+\.ics$/.test(url.pathname);
    if (!valid || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || input.length > 4096) throw new Error();
    return url;
  } catch { throw new CalendarError('UNSAFE_URL', 400); }
}
export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export type FetchResult = { status: 200 | 304; body?: string; etag?: string; lastModified?: string };
export async function fetchCalendar(input: string, provider: Provider, validators: { etag?: string; lastModified?: string } = {}): Promise<FetchResult> {
  const url = validateUrl(input, provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const addresses = await Promise.race([
      dns.lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new CalendarError('FETCH_TIMEOUT')), { once: true })),
    ]);
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new CalendarError('UNSAFE_ADDRESS');
    if (controller.signal.aborted) throw new CalendarError('FETCH_TIMEOUT');
    // Pin the checked address while TLS still verifies the original hostname. No connection pool or second DNS lookup.
    const address = addresses[0];
    return await new Promise<FetchResult>((resolve, reject) => {
      const headers: Record<string, string> = { Accept: 'text/calendar', 'Accept-Encoding': 'identity', 'User-Agent': 'BloomCalendar/1.0' };
      if (validators.etag && validators.etag.length < 512 && !/[\r\n]/.test(validators.etag)) headers['If-None-Match'] = validators.etag;
      if (validators.lastModified && validators.lastModified.length < 128 && !/[\r\n]/.test(validators.lastModified)) headers['If-Modified-Since'] = validators.lastModified;
      const request = https.get(url, { agent: false, headers, signal: controller.signal,
        lookup: ((_host: string, options: { all?: boolean }, callback: (error: null, address: string | {address: string; family: number}[], family?: number) => void) => options.all
          ? callback(null, [{ address: address.address, family: address.family }])
          : callback(null, address.address, address.family)) as never,
      }, response => {
        const fail = (code: string) => { response.destroy(); reject(new CalendarError(code)); };
        // Redirects are deliberately unsupported; never forward the secret token to another destination.
        if (response.statusCode === 304) { response.resume(); resolve({ status: 304 }); return; }
        if (response.statusCode !== 200) { fail('FETCH_HTTP'); return; }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { fail('FETCH_HTTP'); return; }
        const contentLength = response.headers['content-length'];
        if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 1_048_576)) { fail('FETCH_TOO_LARGE'); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1_048_576) fail('FETCH_TOO_LARGE'); else chunks.push(chunk); });
        response.on('aborted', () => reject(new CalendarError('FETCH_FAILED')));
        response.on('error', () => reject(new CalendarError('FETCH_FAILED')));
        response.on('end', () => {
          if (!response.complete || (contentLength && size !== Number(contentLength))) { reject(new CalendarError('FETCH_FAILED')); return; }
          try {
            const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
            resolve({ status: 200, body, etag: response.headers.etag, lastModified: response.headers['last-modified'] });
          } catch { reject(new CalendarError('INVALID_CALENDAR')); }
        });
      });
      request.on('error', () => reject(new CalendarError(controller.signal.aborted ? 'FETCH_TIMEOUT' : 'FETCH_FAILED')));
    });
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError(controller.signal.aborted ? 'FETCH_TIMEOUT' : 'FETCH_FAILED');
  } finally { clearTimeout(timer); }
}
