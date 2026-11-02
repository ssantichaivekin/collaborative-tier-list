import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({dns:vi.fn(),get:vi.fn()}));
vi.mock('node:dns/promises',()=>({Resolver:class {resolve4=mocks.dns;}}));
vi.mock('node:https',()=>({get:mocks.get}));
import { downloadImage } from '../convex/lib/remoteImage';
beforeEach(()=>{mocks.dns.mockReset().mockResolvedValue(['8.8.8.8']);mocks.get.mockReset();});
function reply(statusCode:number,headers:Record<string,string>,body='image') {
  return (_url:unknown,_options:unknown,callback:(response:unknown)=>void)=>{
    const request=Object.assign(new EventEmitter(),{destroy:vi.fn()});
    queueMicrotask(()=>{
      const response=Object.assign(new EventEmitter(),{statusCode,headers,destroy:vi.fn()});
      callback(response);
      if(statusCode===200){response.emit('data',Buffer.from(body));response.emit('end');}
      request.emit('close');
    });
    return request;
  };
}
it('follows a public redirect and accepts a supported image',async()=>{
  mocks.get.mockImplementationOnce(reply(302,{location:'https://cdn.example.com/picture'})).mockImplementationOnce(reply(200,{'content-type':'image/avif'}));
  expect((await downloadImage('https://example.com/image')).toString()).toBe('image');
  expect(mocks.dns).toHaveBeenCalledWith('cdn.example.com');
});
it('rejects a redirect whose hostname resolves to a private address',async()=>{
  mocks.dns.mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1']);
  mocks.get.mockImplementationOnce(reply(302,{location:'https://private.example.com/image'}));
  await expect(downloadImage('https://example.com/image')).rejects.toThrow('Non-public');
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
it('bounds redirect loops',async()=>{
  mocks.get.mockImplementation(reply(302,{location:'/again'}));
  await expect(downloadImage('https://example.com/image')).rejects.toThrow('Too many');
  expect(mocks.get).toHaveBeenCalledTimes(4);
});
it('rejects a login page even when it returns HTTP 200',async()=>{
  mocks.get.mockImplementation(reply(200,{'content-type':'text/html'},'<html>Sign in</html>'));
  await expect(downloadImage('https://example.com/image')).rejects.toThrow('Unsupported image response');
});
it('rejects blocked images',async()=>{
  mocks.get.mockImplementation(reply(403,{'content-type':'text/plain'},'Forbidden'));
  await expect(downloadImage('https://example.com/image')).rejects.toThrow('403');
});
