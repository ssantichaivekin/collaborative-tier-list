import { describe, it, expect } from 'vitest';
import { publicIPv4, imageUrl } from '../convex/lib/remoteImage';
describe('remote image network boundary',()=>{
  it('rejects private, link-local and reserved addresses',()=>{
    for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','224.0.0.1','198.18.0.1','::1']) expect(publicIPv4(ip),ip).toBe(false);
    expect(publicIPv4('8.8.8.8')).toBe(true);
  });
  it('rejects credentials, unsupported protocols, ports and literal addresses',()=>{
    for(const url of ['http://example.com/a','https://user:pass@example.com/a','https://example.com:8080/a','https://127.0.0.1/a','https://localhost/a','https://host.local/a'])expect(()=>imageUrl(url)).toThrow();
    expect(imageUrl('https://images.example.com/a.jpg').hostname).toBe('images.example.com');
  });
});
