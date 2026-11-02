export function resizeCrop(rect:{x:number;y:number;side:number},width:number,height:number,corner:string,change:number){
 const minimum=Math.min(width,height)/4;
 const side=Math.max(minimum,Math.min(Math.min(width,height),rect.side*(1+change)));
 const x=Math.max(0,Math.min(width-side,rect.x+(corner.endsWith('w')?rect.side-side:0)));
 const y=Math.max(0,Math.min(height-side,rect.y+(corner.startsWith('n')?rect.side-side:0)));
 return {left:(x-rect.x)/rect.side,top:(y-rect.y)/rect.side,size:side/rect.side};
}
