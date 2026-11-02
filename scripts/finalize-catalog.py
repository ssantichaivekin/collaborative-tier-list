"""Publish and audit the frozen 1,000-template manifest after image ingestion."""
from pathlib import Path
import json,os,subprocess
ROOT=Path(__file__).resolve().parents[1]; CACHE=ROOT/'catalog-cache'
ENV=dict(os.environ)
DEPLOYMENT_FLAGS=['--prod'] if os.environ.get('CONVEX_CATALOG_PROD')=='1' else []
def convex(fn,args):
 r=subprocess.run(['npx','convex','run','catalog:'+fn,json.dumps(args,separators=(',',':'))]+DEPLOYMENT_FLAGS,cwd=ROOT,env=ENV,capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr[-1000:])
 return json.loads(r.stdout)
rows=json.loads((CACHE/'selected.json').read_text()); assets={}
for p in CACHE.glob('asset-map*.json'):assets.update(json.loads(p.read_text()))
assert len(rows)==1000 and len({r['slug'] for r in rows})==1000
assert all(5<=len(r['items'])<=40 for r in rows)
missing={i['imageUrl'] for r in rows for i in r['items'] if i['imageUrl'] not in assets}
assert not missing, f'{len(missing)} images still missing'
for r in rows:
 if r['category']=='TV & film':r['category']='Television'
 if r['category']=='Animation':r['category']='Anime & cartoons'
 if r['category']=='Games':r['category']='Pokémon'
for start in range(0,len(rows),20):
 convex('putBatch',{'entries':[{'template':r,'assets':[assets[i['imageUrl']] for i in r['items']]} for r in rows[start:start+20]]})
 print('PUBLISHED',start+20,flush=True)
issues=[];items=0
for start in range(0,len(rows),20):
 result=convex('auditBatch',{'slugs':[r['slug'] for r in rows[start:start+20]]});issues.extend(result['issues']);items+=result['items']
assert not issues,issues
print('AUDIT PASS',len(rows),'templates',items,'item references',flush=True)
print(convex('finalize',{'slugs':[r['slug'] for r in rows]}),flush=True)
(ROOT/'catalog').mkdir(exist_ok=True)
(ROOT/'catalog'/'manifest.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
(CACHE/'final-audit.json').write_text(json.dumps({'templates':len(rows),'itemReferences':items,'issues':issues}))
