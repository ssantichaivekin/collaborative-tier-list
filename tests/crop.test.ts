import {describe,it,expect} from 'vitest';
import {resizeCrop} from '../src/cropGeometry';
describe('crop corner expansion',()=>{
 it('restores the original square after an inward crop',()=>{
  const result=resizeCrop({x:250,y:250,side:500},1000,1000,'se',1);
  expect(result).toEqual({left:-.5,top:-.5,size:2});
 });
 it('allows all four corners to expand without exceeding source bounds',()=>{
  for(const corner of ['nw','ne','sw','se']){
   const rect={x:200,y:100,side:400};
   const r=resizeCrop(rect,1200,800,corner,10);
   expect(r.size).toBe(2);
   expect(rect.x+r.left*rect.side).toBeGreaterThanOrEqual(0);
   expect(rect.x+(r.left+r.size)*rect.side).toBeLessThanOrEqual(1200);
   expect(rect.y+(r.top+r.size)*rect.side).toBeLessThanOrEqual(800);
  }
 });
 it('retains the four-times zoom limit',()=>{
  expect(resizeCrop({x:0,y:0,side:800},1200,800,'nw',-10).size).toBe(.25);
 });
});
