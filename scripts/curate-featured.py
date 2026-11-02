"""Supplement the historical TV index with explicitly selected contemporary topics."""
import json,urllib.request,urllib.parse,time,hashlib,re,concurrent.futures
from pathlib import Path
R=Path(__file__).resolve().parents[1];C=R/'catalog-cache';out=[];series=[]
anime='Demon Slayer: Kimetsu no Yaiba|Jujutsu Kaisen|Chainsaw Man|Frieren: Beyond Journey’s End|Spy x Family|Solo Leveling|Dandadan|The Apothecary Diaries|Blue Lock|Haikyu!!|My Hero Academia|Vinland Saga|Mob Psycho 100|One Punch Man|Dr. Stone|Black Clover|Boruto: Naruto Next Generations|Bungo Stray Dogs|Re:Zero|Kaguya-sama: Love is War|Violet Evergarden|Made in Abyss|The Promised Neverland|Cyberpunk: Edgerunners|Delicious in Dungeon|Bocchi the Rock!|Oshi no Ko|Mashle: Magic and Muscles|Kaiju No. 8|Hell’s Paradise|86|To Your Eternity|Odd Taxi|Ranking of Kings|Tokyo Revengers|Fire Force|The Rising of the Shield Hero|That Time I Got Reincarnated as a Slime|Overlord|Konosuba|Fruits Basket|Horimiya|My Dress-Up Darling|A Sign of Affection|Skip and Loafer|The Dangers in My Heart|Wotakoi|Yuri!!! on Ice|Banana Fish|Given|Sailor Moon|Cardcaptor Sakura|Inuyasha|Yu Yu Hakusho|Rurouni Kenshin|Neon Genesis Evangelion|Serial Experiments Lain|Samurai Champloo|Code Geass|Gurren Lagann|Soul Eater|Blue Exorcist|Noragami|Assassination Classroom|Food Wars!|Kuroko’s Basketball|Free!|Hajime no Ippo|Initial D|Trigun|Monster|Nana|March Comes in Like a Lion|Your Lie in April|Clannad|Angel Beats!|Toradora!|K-On!|Lucky Star|Nichijou|Azumanga Daioh|Saiki K.|Gintama|JoJo’s Bizarre Adventure|Attack on Titan|One Piece|Naruto|Bleach|Death Note|Hunter x Hunter'.split('|')
tv='Stranger Things|Wednesday|The Last of Us|Severance|The Bear|Succession|The White Lotus|House of the Dragon|The Boys|Invincible|Arcane|Fallout|Shōgun|Andor|The Mandalorian|Ahsoka|Loki|WandaVision|Agatha All Along|Squid Game|Alice in Borderland|All of Us Are Dead|Sweet Home|Kingdom|Ted Lasso|Only Murders in the Building|Abbott Elementary|What We Do in the Shadows|Schitt’s Creek|Brooklyn Nine-Nine|The Good Place|Fleabag|Derry Girls|Heartstopper|Sex Education|Euphoria|Yellowjackets|The Queen’s Gambit|The Sandman|Good Omens|Our Flag Means Death|The Umbrella Academy|The Witcher|Shadow and Bone|Percy Jackson and the Olympians|Avatar: The Last Airbender|The Legend of Korra|Adventure Time|Steven Universe|Gravity Falls|The Owl House|Amphibia|Bluey|Hazbin Hotel|Helluva Boss|Smiling Friends|The Amazing Digital Circus|Castlevania|Blue Eye Samurai|Scavengers Reign|Love, Death & Robots|Primal|BoJack Horseman|Rick and Morty|Star Wars: The Clone Wars|Star Wars Rebels|Star Wars: The Bad Batch'.split('|')
def get(name):
 u='https://api.tvmaze.com/singlesearch/shows?'+urllib.parse.urlencode({'q':name,'embed':'cast'});p=C/(hashlib.sha256(u.encode()).hexdigest()+'.json')
 if p.exists():return json.loads(p.read_text())
 try:
  with urllib.request.urlopen(u,timeout=20) as r:d=json.load(r)
  p.write_text(json.dumps(d));time.sleep(1);return d
 except Exception:return None
def create(title,category,items,source,tags):
 seen=set();clean=[]
 for i in items:
  if i['label'].casefold() not in seen and i['imageUrl']:seen.add(i['label'].casefold());clean.append(i)
 if len(clean)<5:return
 clean=clean[:30];signature='|'.join(sorted(i['label'].casefold() for i in clean))
 out.append(dict(slug=re.sub('[^a-z0-9]+','-',title.lower()).strip('-')[:100]+'-'+hashlib.md5(signature.encode()).hexdigest()[:6],title=title,category=category,tags=tags,items=clean,sourceUrl=source,sourceNote='Editorial selection from TVmaze. Up to 30 pictured characters in source cast order; may omit minor characters.',score=150,coverUrl=clean[0]['imageUrl']))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
 for n,(name,s) in enumerate(zip(anime+tv,ex.map(get,anime+tv))):
  if not s or not s.get('image'):continue
  series.append(s)
  cast=s.get('_embedded',{}).get('cast',[])
  items=[dict(label=x['character']['name'],imageUrl=x['character']['image']['medium'],sourceUrl=x['character']['url']) for x in cast if x['character'].get('image')]
  category='Animation' if s['type']=='Animation' or 'Anime' in s['genres'] else 'TV & film'
  create(s['name']+' characters',category,items,s['url'],s['genres']+['characters'])
  if n%20==0:print('FEATURED',n,len(out),flush=True)
  (C/'featured-extra.json').write_text(json.dumps(out))
for category,subset,title in [('Animation',[s for s in series if 'Anime' in s['genres']],'Anime essentials'),('Animation',[s for s in series if s['type']=='Animation' and 'Anime' not in s['genres']],'Animated series essentials'),('TV & film',[s for s in series if s['type']!='Animation'],'Modern TV essentials')]:
 create(title,category,[dict(label=s['name'],imageUrl=s['image']['medium'],sourceUrl=s['url']) for s in subset],'https://www.tvmaze.com/',['featured','series'])
 out[-1]['sourceNote']='Editorial shortlist of series, not a measured popularity ranking.'
(C/'featured-extra.json').write_text(json.dumps(out));print('DONE',len(out),flush=True)
