"""Resize sources to <=384px WebP, store blobs in Convex, publish complete templates.
Run with python scripts/store-catalog.py catalog/manifest.json (requires Pillow).
"""
from pathlib import Path
import json,hashlib,urllib.request,subprocess,os,io,concurrent.futures,time,sys,uuid
from PIL import Image, ImageOps
ROOT=Path(__file__).resolve().parents[1];CACHE=ROOT/'catalog-cache';IMAGES=CACHE/'images';IMAGES.mkdir(parents=True,exist_ok=True)
ENV=dict(os.environ)
DEPLOYMENT_FLAGS=['--prod'] if os.environ.get('CONVEX_CATALOG_PROD')=='1' else []
def convex(fn,args):
 r=subprocess.run(['npx','convex','run','catalog:'+fn,json.dumps(args,separators=(',',':'))]+DEPLOYMENT_FLAGS,cwd=ROOT,env=ENV,capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr[-800:])
 return json.loads(r.stdout)
source=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'catalog-cache/selected.json')
rows=json.loads(source.read_text())
for n,row in enumerate(rows):row.setdefault('rank',n);row.setdefault('featured',row['score']>=80)
assets={item['imageUrl']:item for row in rows for item in row['items']}
assetmap={}; failures={}; uploadedBytes=0
mapping=CACHE/('asset-map-'+source.stem+'.json')
for prior in CACHE.glob('asset-map*.json'):
 try:assetmap.update(json.loads(prior.read_text()))
 except json.JSONDecodeError:pass
def prepare(entry):
 url=entry['sourceUrl'];item=assets[url]
 if entry['uploadUrl'] is None:return {'sourceUrl':url,'assetId':entry['assetId']}
 path=IMAGES/(hashlib.sha256(url.encode()).hexdigest()+'.webp')
 try:
  if not path.exists():
   for attempt in range(3):
    try:
     with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MultiplayerTierList/1.0'}),timeout=25) as response:data=response.read(8*1024*1024+1)
     if len(data)>8*1024*1024:raise ValueError('Source over 8MB')
     with Image.open(io.BytesIO(data)) as original:
      image=ImageOps.exif_transpose(original);image.thumbnail((384,384),Image.Resampling.LANCZOS)
      image=image.convert('RGBA' if 'A' in image.getbands() or image.info.get('transparency') is not None else 'RGB')
      temporary=path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
      image.save(temporary,'WEBP',quality=82,method=6)
      temporary.replace(path)
     break
    except Exception:
     if attempt==2:raise
     time.sleep(1+attempt)
  data=path.read_bytes()
  if len(data)>200000:raise ValueError('Optimized image over 200KB')
  with Image.open(path) as im:width,height=im.size
  req=urllib.request.Request(entry['uploadUrl'],data=data,headers={'Content-Type':'image/webp'},method='POST')
  with urllib.request.urlopen(req,timeout=30) as response:stored=json.load(response)
  return {'sourceUrl':url,'storageId':stored['storageId'],'label':item['label'],'attributionUrl':item['sourceUrl'],'width':width,'height':height}
 except Exception as e:return {'sourceUrl':url,'error':str(e)}
urls=[u for u in assets if u not in assetmap] if "--missing" in sys.argv else list(assets)
for offset in range(0,len(urls),40):
 batch=urls[offset:offset+40]
 # Server confirms cached assets so a resumed job never trusts stale local storage IDs.
 prepared=convex('prepareAssets',{'entries':[{'sourceUrl':u} for u in batch]})
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:results=list(ex.map(prepare,prepared))
 pending=[]
 for r in results:
  if 'error' in r:failures[r['sourceUrl']]=r['error']
  elif 'assetId' in r:assetmap[r['sourceUrl']]=r['assetId']
  else:pending.append(r)
 if pending:
  for r in convex('finishAssets',{'entries':pending}):assetmap[r['sourceUrl']]=r['assetId']
 mapping.write_text(json.dumps(assetmap))
 print('ASSETS',min(offset+40,len(urls)),'/',len(urls),'ready',len(assetmap),'failed',len(failures),flush=True)
 # Publish newly complete templates as the batch progresses, using only optimized assets.
 ready=[r for r in rows if all(i['imageUrl'] in assetmap for i in r['items'])]
 if offset%200==0:
  published=set(json.loads((CACHE/('published-'+source.stem+'.json')).read_text())) if (CACHE/('published-'+source.stem+'.json')).exists() else set()
  fresh=[r for r in ready if r['slug'] not in published]
  for start in range(0,len(fresh),10):
   batchrows=fresh[start:start+10]
   convex('putBatch',{'entries':[{'template':r,'assets':[assetmap[i['imageUrl']] for i in r['items']]} for r in batchrows]})
   published.update(r['slug'] for r in batchrows)
  (CACHE/('published-'+source.stem+'.json')).write_text(json.dumps(sorted(published)))
ready=[r for r in rows if all(i['imageUrl'] in assetmap for i in r['items'])]
for start in range(0,len(ready),10):
 convex('putBatch',{'entries':[{'template':r,'assets':[assetmap[i['imageUrl']] for i in r['items']]} for r in ready[start:start+10]]})
(CACHE/('asset-failures-'+source.stem+'.json')).write_text(json.dumps(failures,indent=2))
(CACHE/('ready-'+source.stem+'.json')).write_text(json.dumps(ready))
print('COMPLETE TEMPLATES',len(ready),'of',len(rows),'ASSET FAILURES',len(failures),flush=True)
