"use node";
import { Resolver } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";

export function publicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
export function imageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.local')) throw new Error('Unsupported image URL');
  return url;
}
export async function downloadImage(value: string, redirects = 0): Promise<Buffer> {
  const url = imageUrl(value);
  const resolver = new Resolver({ timeout: 5000, tries: 1 });
  const addresses = await resolver.resolve4(url.hostname);
  if (!addresses.length || !addresses.every(publicIPv4)) throw new Error('Non-public image host');
  // Pin the validated address to prevent DNS rebinding; redirect destinations are independently validated.
  return new Promise((resolve, reject) => {
    const request = get(url, { agent:false, family:4, lookup:(_host,_options,callback)=>callback(null,addresses[0],4) }, response => {
      if ([301,302,303,307,308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.destroy();
        if (redirects >= 3) { reject(new Error('Too many image redirects')); return; }
        // Every redirect repeats protocol, DNS and public-address validation.
        void downloadImage(new URL(response.headers.location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200 || !/^image\/(jpeg|png|webp|avif|gif)(;|$)/i.test(response.headers['content-type'] ?? '')) { response.destroy(); reject(new Error(`Unsupported image response (${response.statusCode}, ${response.headers['content-type'] ?? 'no type'})`)); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 4*1024*1024) request.destroy(new Error('Image too large')); else chunks.push(chunk); });
      response.on('end',()=>resolve(Buffer.concat(chunks)));
      response.on('error',reject);
    });
    const timer = setTimeout(()=>request.destroy(new Error('Image timeout')),15000);
    request.on('close',()=>clearTimeout(timer));
    request.on('error',reject);
  });
}
