"""Import general rules, roles and mercenaries from the supplied source DOCX.
Does not alter original source files or existing JSON cards.
"""
import sys,json,re,io,hashlib
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);z=ZipFile(source)
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
ps=E.fromstring(z.read('word/document.xml')).findall('.//w:p',ns)
texts=[''.join(p.xpath('.//w:t/text()',namespaces=ns)).strip() for p in ps]
rels={r.get('Id'):r.get('Target') for r in E.fromstring(z.read('word/_rels/document.xml.rels'))}
sha=hashlib.sha256(source.read_bytes()).hexdigest()
def find(prefix):return next(i for i,t in enumerate(texts) if t.startswith(prefix))
def picture(i,id):
 blips=ps[i].findall('.//a:blip',ns)
 if not blips:return ''
 target=rels[blips[0].get('{'+ns['r']+'}embed')];raw=z.read('word/'+target)
 im=ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGB');im.thumbnail((480,720))
 filename=f'{id}-{hashlib.sha256(raw).hexdigest()[:12]}.webp';im.save(ROOT/'public/assets/cards'/filename,'WEBP',quality=90)
 return '/assets/cards/'+filename
entries=[]
def add(id,name,kind,lo,hi,imageAt=None):
 paragraphs=[{'index':i,'text':texts[i]} for i in range(lo,hi) if texts[i]]
 # Preserve every source paragraph, including headings and original list markers.
 item={'id':id,'name':name,'cardType':kind,'description':'\n\n'.join(p['text'] for p in paragraphs),'attributes':{},'image':picture(imageAt,id) if imageAt is not None else '', 'kind':'Уточнение','note':'','source':{'file':'Правила Бункер Картинки.doc','workingCopySha256':sha,'paragraphStart':lo,'paragraphEndExclusive':hi},'sourceParagraphs':paragraphs}
 entries.append(item)
intro=find('Здравствуйте, дорогие друзья!');outing=find('Вылазка –');dead=find('Игра мертвых –');duel=find('Дуэль –');survivor=find('Выживший –');marauder=find('Мародер –');medic=find('Санитар –');skill=find('Карта умения такая же');leader=find('Лидер –');merc=find('Айтишник –')
for id,name,lo,hi in [('rule-intro','Об игре',intro,outing),('rule-outing','Вылазка',outing,dead),('rule-dead','Игра мёртвых',dead,duel),('rule-duel','Дуэль',duel,survivor),('rule-skills','Карты умений',skill,leader)]:add(id,name,'правило',lo,hi)
for id,name,lo,hi in [('role-survivor','Выживший',survivor,marauder),('role-marauder','Мародёр',marauder,medic),('role-medic','Санитар',medic,skill)]:add(id,name,'роль',lo,hi,lo)
starts=[]
for i in range(merc,len(ps)):
 if ps[i].findall('.//a:blip',ns):
  # Every mercenary starts in its own illustrated paragraph or the next nonempty paragraph.
  j=next((j for j in range(i,min(i+4,len(ps))) if texts[j]),None)
  if j is None:continue
  parts=re.split(r'\s+[–—]\s+',texts[j],maxsplit=1)
  if len(parts)!=2:raise ValueError(f'Unrecognized mercenary at {i}')
  starts.append((i,parts[0]))
assert len(starts)==33, len(starts)
for n,(lo,name) in enumerate(starts):add(f'merc-{hashlib.sha256(name.encode()).hexdigest()[:12]}',name,'наёмник',lo,starts[n+1][0] if n+1<len(starts) else len(ps),lo)
# Check all nonempty source paragraphs in the imported spans are represented once.
indices=[p['index'] for e in entries for p in e['sourceParagraphs']]
assert len(indices)==len(set(indices))
expected={i for i in list(range(intro,leader))+list(range(merc,len(ps))) if texts[i]}
assert set(indices)==expected,(expected-set(indices),set(indices)-expected)
(ROOT/'public/assets/rule-sections.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2))
print('Imported',len(entries),'entries:',{kind:sum(e['cardType']==kind for e in entries) for kind in ['правило','роль','наёмник']})
print('Verified complete source coverage:',len(indices),'nonempty paragraphs')
