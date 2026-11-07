import { createHash } from 'node:crypto';

// tetszőleges, de rögzített névtér; ne változtasd meg
const NAMESPACE = '6f1c1e0a-5b7e-4a53-9a41-2f0f7a9c0d11';

export function uuidv5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}