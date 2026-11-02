"""Build source-backed short-list candidates. Cached, resumable; no API credentials."""
import json, urllib.request, urllib.parse, time, hashlib, re, concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; CACHE=ROOT/'catalog-cache'; CACHE.mkdir(exist_ok=True)
def get(url):
 p=CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.json')
 if p.exists():return json.loads(p.read_text())
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MultiplayerTierList/1.0 (catalog research)'}),timeout=25) as r:d=json.load(r)
   p.write_text(json.dumps(d));return d
  except Exception as e:
   if attempt==2: print('SKIP',url,str(e),flush=True);return None
   time.sleep(2+attempt*3)
C=[]; signatures=set()
def add(title,category,items,source,tags=[],note='',score=0):
 seen=set(); cleaned=[]
 for i in items:
  k=i['label'].strip().casefold()
  if not k or k in seen or not i.get('imageUrl'):continue
  seen.add(k);cleaned.append(i)
 if len(cleaned)<5:return
 cleaned=cleaned[:30]
 signature='|'.join(sorted(i['label'].casefold() for i in cleaned))
 if signature in signatures:return
 signatures.add(signature)
 C.append(dict(slug=re.sub('[^a-z0-9]+','-',title.lower()).strip('-')[:100]+'-'+hashlib.md5(signature.encode()).hexdigest()[:6],title=title,category=category,tags=tags,items=cleaned,sourceUrl=source,sourceNote=note or 'A selection from the linked source, capped at 30 items.',score=score,coverUrl=cleaned[0]['imageUrl']))
def checkpoint():
 (ROOT/'catalog-cache/candidates.json').write_text(json.dumps(C));print('CANDIDATES',len(C),flush=True)
shows=[]
for page in range(16):
 d=get(f'https://api.tvmaze.com/shows?page={page}')
 if d:shows+=d
 time.sleep(.5)
print('SHOWS',len(shows),flush=True)
shows=[s for s in shows if s.get('image') and s.get('rating',{}).get('average') and s['rating']['average']>=6]
shows.sort(key=lambda s:((s.get('weight') or 0),s['rating']['average']),reverse=True)
def showitem(s):return dict(label=s['name'],imageUrl=s['image']['medium'],sourceUrl=s['url'])
genres=sorted(set(g for s in shows for g in s['genres']))
for g in genres:
 subset=[s for s in shows if g in s['genres']]
 cat='Animation' if g=='Anime' else 'TV & film'
 add(f'{g} series',cat,list(map(showitem,subset)),'https://www.tvmaze.com/',[g,'series'], 'Selected from TVmaze; ordered by its source weight, then rating. Not an exhaustive genre list.',100)
 for decade in range(1960,2030,10):
  sub=[s for s in subset if str(s.get('premiered') or '')[:3]==str(decade)[:3]]
  add(f'{decade}s {g.lower()} series',cat,list(map(showitem,sub)),'https://www.tvmaze.com/',[g,str(decade),'series'],score=40)
 for lang in ['English','Japanese','Korean','Spanish','French','German']:
  sub=[s for s in subset if s['language']==lang]
  add(f'{lang}-language {g.lower()} series',cat,list(map(showitem,sub)),'https://www.tvmaze.com/',[g,lang,'series'],score=25)
for i,g in enumerate(genres):
 for h in genres[i+1:]:
  if g=='Anime' or h=='Anime':cat='Animation'
  else:cat='TV & film'
  add(f'{g} & {h.lower()} series',cat,[showitem(s) for s in shows if g in s['genres'] and h in s['genres']],'https://www.tvmaze.com/',[g,h,'series'],score=20)
checkpoint()
# Character portraits only: do not silently substitute actors' photographs.
def cast(s):
 url=f'https://api.tvmaze.com/shows/{s["id"]}/cast'
 cached=(CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.json')).exists()
 d=get(url)
 if not cached:time.sleep(1.1)
 if not d:return None
 items=[dict(label=x['character']['name'],imageUrl=x['character']['image']['medium'],sourceUrl=x['character']['url']) for x in d if x.get('character',{}).get('image')]
 return s,items
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
 for n,result in enumerate(ex.map(cast,shows[:550])):
  if result:
   s,items=result;cat='Animation' if s.get('type')=='Animation' or 'Anime' in s['genres'] else 'TV & film'
   add(s['name']+' characters',cat,items,s['url'],s['genres']+['characters'], 'Selected pictured characters in TVmaze cast order; up to 30, excludes entries without character portraits.',score=60+(s.get('weight') or 0)/10)
  if n%50==0:checkpoint()
checkpoint()
# Pokemon type and generation collections: stable IDs, official artwork from PokeAPI sprites.
pokemon=get('https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon.csv') if False else None
import csv,io
u='https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/'
def csvget(name):
 p=CACHE/name
 if not p.exists():p.write_bytes(urllib.request.urlopen(u+name).read())
 return list(csv.DictReader(io.StringIO(p.read_text())))
species=csvget('pokemon_species.csv');ptypes=csvget('pokemon_types.csv');types={int(r['id']):r['identifier'] for r in csvget('types.csv')};pby={int(r['id']):r for r in species}
typesby={}
for r in ptypes:typesby.setdefault(int(r['pokemon_id']),[]).append(types.get(int(r['type_id']),''))
regions=['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar','Paldea']
def mon(r):return dict(label=r['identifier'].replace('-',' ').title(),imageUrl=f'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{r["id"]}.png',sourceUrl=f'https://pokeapi.co/api/v2/pokemon-species/{r["id"]}/')
for gen,region in enumerate(regions,1):
 group=[r for r in species if int(r['generation_id'])==gen]
 add(region+' Pokémon selection','Games',list(map(mon,group)),'https://pokeapi.co/',['Pokémon',region], 'First 30 species introduced in this generation, in Pokédex order; a selection, not the whole generation.',100)
 for typ in types.values():
  sub=[r for r in group if typ in typesby.get(int(r['id']),[])]
  add(region+' '+typ.title()+' Pokémon','Games',list(map(mon,sub)),'https://pokeapi.co/',['Pokémon',region,typ], 'Base-form type membership from PokeAPI, up to 30 species in Pokédex order.',score=70)
for typ in types.values():
 add(typ.title()+' Pokémon selection','Games',[mon(r) for r in species if typ in typesby.get(int(r['id']),[])],'https://pokeapi.co/',['Pokémon',typ], 'Up to 30 base-form species of this type, in Pokédex order.',score=60)
checkpoint()
# MealDB categories and cuisines.
for field,prop,label in [('c','strCategory',''),('a','strArea',' cuisine')]:
 d=get('https://www.themealdb.com/api/json/v1/1/list.php?'+field+'=list') or {}
 for x in d.get('meals',[]):
  name=x[prop];sub=get('https://www.themealdb.com/api/json/v1/1/filter.php?'+field+'='+urllib.parse.quote(name)) or {}
  add(name+label+' dishes','Food & drink',[dict(label=m['strMeal'],imageUrl=m['strMealThumb']+'/small',sourceUrl='https://www.themealdb.com/meal/'+m['idMeal']) for m in sub.get('meals') or []],'https://www.themealdb.com/',['food',name], 'A selection of recipes from TheMealDB, not a definitive cuisine ranking.',score=80)
  time.sleep(.2)
checkpoint()
artists='Taylor Swift|Beyoncé|Adele|Rihanna|Lady Gaga|Ariana Grande|Billie Eilish|Dua Lipa|Lana Del Rey|Olivia Rodrigo|Sabrina Carpenter|Chappell Roan|Harry Styles|Ed Sheeran|Bruno Mars|The Weeknd|Justin Bieber|Justin Timberlake|Michael Jackson|Prince|Madonna|Britney Spears|Christina Aguilera|Mariah Carey|Whitney Houston|Celine Dion|Elton John|Billy Joel|David Bowie|Queen|The Beatles|The Rolling Stones|Led Zeppelin|Pink Floyd|Fleetwood Mac|Eagles|ABBA|Bee Gees|U2|Coldplay|Radiohead|Muse|Oasis|Blur|Arctic Monkeys|The Strokes|The Killers|Foo Fighters|Nirvana|Pearl Jam|Soundgarden|Alice In Chains|Red Hot Chili Peppers|Green Day|Blink-182|My Chemical Romance|Paramore|Fall Out Boy|Panic! At The Disco|Linkin Park|Metallica|Iron Maiden|Black Sabbath|Judas Priest|Slipknot|System Of A Down|Deftones|Korn|Tool|Nine Inch Nails|Rammstein|Evanescence|Kendrick Lamar|Drake|Eminem|JAY-Z|Nas|2Pac|The Notorious B.I.G.|Outkast|J. Cole|Tyler, The Creator|Travis Scott|Kid Cudi|Mac Miller|SZA|Frank Ocean|Childish Gambino|Doja Cat|Nicki Minaj|Missy Elliott|Lauryn Hill|Alicia Keys|Usher|Mary J. Blige|D’Angelo|Erykah Badu|Stevie Wonder|Marvin Gaye|Aretha Franklin|James Brown|Otis Redding|Ray Charles|Sam Cooke|Bob Marley|Daft Punk|The Chemical Brothers|The Prodigy|Massive Attack|Portishead|Björk|Aphex Twin|Boards of Canada|Bonobo|Nujabes|Flying Lotus|Skrillex|Deadmau5|Calvin Harris|David Guetta|Avicii|Tiësto|Armin van Buuren|BTS|BLACKPINK|TWICE|Red Velvet|EXO|SHINee|SEVENTEEN|Stray Kids|NCT 127|ATEEZ|ITZY|aespa|NewJeans|IU|Girls’ Generation|BIGBANG|2NE1|Mamamoo|Dreamcatcher|TXT|ENHYPEN|LE SSERAFIM|IVE|GFRIEND|MONSTA X|Super Junior|TVXQ|GOT7|Taeyeon|BoA|Hikaru Utada|Ayumi Hamasaki|Namie Amuro|Perfume|BABYMETAL|ONE OK ROCK|RADWIMPS|YOASOBI|Aimer|LiSA|Kenshi Yonezu|King Gnu|Official HIGE DANdism|Mrs. GREEN APPLE|Bad Bunny|J Balvin|Rosalía|Shakira|Karol G|Daddy Yankee|Luis Fonsi|Enrique Iglesias|Ricky Martin|Juanes|Juan Luis Guerra|Celia Cruz|Buena Vista Social Club|Natalia Lafourcade|Mon Laferte|Soda Stereo|Gustavo Cerati|Café Tacvba|Maná|Selena|Dolly Parton|Johnny Cash|Willie Nelson|Kacey Musgraves|Chris Stapleton|Shania Twain|Carrie Underwood|Miranda Lambert|Luke Combs|Zach Bryan|Sturgill Simpson|Tyler Childers|Jason Isbell|George Strait|Garth Brooks|Tim McGraw|Faith Hill|The Chicks|Emmylou Harris|Patsy Cline|Joni Mitchell|Bob Dylan|Neil Young|Leonard Cohen|Simon & Garfunkel|Paul Simon|Cat Stevens|James Taylor|Carole King|Tracy Chapman|Norah Jones|Laufey|Miles Davis|John Coltrane|Ella Fitzgerald|Billie Holiday|Louis Armstrong|Nina Simone|Chet Baker|Herbie Hancock|Thelonious Monk|Charles Mingus|Duke Ellington|Bill Evans|Dave Brubeck|Chick Corea|Kamasi Washington|Esperanza Spalding|Snarky Puppy'.split('|')
for n,name in enumerate(artists):
 d=get('https://itunes.apple.com/search?'+urllib.parse.urlencode(dict(term=name,entity='album',limit=50))) or {}
 # Only exact artist names; deduplicate base titles across deluxe/remastered variants.
 selected=[];seen=set()
 for r in d.get('results',[]):
  if r.get('artistName','').casefold()!=name.casefold():continue
  title=r.get('collectionName','');base=re.sub(r'\s*[\[(].*','',title).casefold()
  if base in seen or re.search(r'\b(single|karaoke|tribute)\b',title,re.I):continue
  seen.add(base);selected.append(dict(label=title,imageUrl=r.get('artworkUrl100'),sourceUrl=r.get('collectionViewUrl','https://music.apple.com/')))
 add(name+' albums','Music',selected,'https://music.apple.com/',[name,'albums'], 'Selected album releases from Apple’s search catalog; editions deduplicated by base title. May include live albums or EPs.',score=75)
 if n%25==0:checkpoint()
 time.sleep(.6)
checkpoint()
# Select 1,000 distinct ready candidates, balancing interests before filling by source-derived priority.
quotas={'TV & film':450,'Animation':120,'Games':150,'Music':220,'Food & drink':60}
chosen=[]
for cat,n in quotas.items():chosen+=sorted([x for x in C if x['category']==cat],key=lambda x:-x['score'])[:n]
used={x['slug'] for x in chosen}
for x in sorted(C,key=lambda x:-x['score']):
 if len(chosen)>=1000:break
 if x['slug'] not in used: chosen.append(x);used.add(x['slug'])
for i,x in enumerate(chosen):x['featured']=x['score']>=80;x['rank']=i
(ROOT/'catalog-cache/selected.json').write_text(json.dumps(chosen))
print('SELECTED',len(chosen),{cat:sum(x['category']==cat for x in chosen) for cat in quotas},flush=True)
