"""Import images from a Word-converted DOCX without modifying rule text.
Usage: bundled-python scripts/import-card-images.py source.docx
Matching is exact after punctuation normalization, scoped by source section.
"""
import sys,json,re,io,hashlib
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from PIL import Image,ImageOps,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]);z=ZipFile(source)
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
ps=E.fromstring(z.read('word/document.xml')).findall('.//w:p',ns)
texts=[''.join(p.xpath('.//w:t/text()',namespaces=ns)).strip() for p in ps]
rels={r.get('Id'):r.get('Target') for r in E.fromstring(z.read('word/_rels/document.xml.rels'))}
cards=json.loads((ROOT/'docs/cards.json').read_text())
def norm(s):return re.sub(r'[^\w]','',s.lower().replace('ё','е'))
def section(i):
 return 'умение' if i<next(j for j,t in enumerate(texts) if t.startswith('Алло-это НЛО!')) else 'мёртвый бонус' if i<next(j for j,t in enumerate(texts) if t.startswith('Адреналин –')) else 'припас' if i<next(j for j,t in enumerate(texts) if t.startswith('Айтишник –')) else 'наёмник'
records=[];mapping={};collisions=[]
for i,p in enumerate(ps):
 for blip in p.findall('.//a:blip',ns):
  rid=blip.get('{'+ns['r']+'}embed');target=rels.get(rid)
  if not target:continue
  candidates=[]
  for j in range(i,min(i+5,len(ps))):
   t=texts[j]
   if not t:continue
   for idx,c in enumerate(cards):
    if c['cardType']!=section(i):continue
    # A full card name followed by the description separator, not a mention.
    prefix=re.split(r'\s*[–—]\s*|\s+-\s+',t,maxsplit=1)[0]
    if norm(prefix)==norm(c['name']) or any(norm(t[:m.start()])==norm(c['name']) for m in re.finditer(r'[–—]|\s-\s',t)):candidates.append((idx,j))
   if candidates:break
   if t and not t.startswith('('):break
  # This paragraph omits the heading; the image itself reads ЛЕВЫЙ (visually verified).
  if i==447 and rid=='rId66':candidates=[(53,447)]
  data=z.read('word/'+target);digest=hashlib.sha256(data).hexdigest()
  record={'paragraph':i,'relationship':rid,'media':target,'sha256':digest,'text':texts[i][:100],'matches':candidates}
  records.append(record)
  if len(candidates)!=1:continue
  idx,j=candidates[0]
  if str(idx) in mapping:collisions.append({'id':str(idx),'paragraph':i});continue
  im=Image.open(io.BytesIO(data));im=ImageOps.exif_transpose(im).convert('RGB');record['dimensions']=list(im.size)
  if im.width<50 or im.height<70:continue
  im.thumbnail((480,720))
  name=f'{idx}-{digest[:12]}.webp';im.save(ROOT/'public/assets/cards'/name,'WEBP',quality=90)
  mapping[str(idx)]={'image':'/assets/cards/'+name,'name':cards[idx]['name'],'cardType':cards[idx]['cardType'],'sourceParagraph':i,'textParagraph':j,'sourceMedia':target,'sha256':digest}
report={'sourceFile':source.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'matched':len(mapping),'total':len(cards),'unmatched':[{'id':str(i),'name':c['name'],'cardType':c['cardType']} for i,c in enumerate(cards) if str(i) not in mapping],'collisions':collisions,'records':records}
(ROOT/'public/assets/card-images.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2))
(ROOT/'tmp/source-import/image-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['records','sourceSha256']},ensure_ascii=False,indent=2))
# Contact sheets show every association, to review labels against image titles.
items=list(mapping.items())
for batch in range(0,len(items),48):
 part=items[batch:batch+48];sheet=Image.new('RGB',(1000,((len(part)+7)//8)*200),'#f0f1e9');draw=ImageDraw.Draw(sheet)
 for n,(idx,m) in enumerate(part):
  img=Image.open(ROOT/'public'/m['image'].lstrip('/'));img.thumbnail((100,155));x=(n%8)*125;y=(n//8)*200;sheet.paste(img,(x+(125-img.width)//2,y));draw.text((x+5,y+158),idx,fill='black')
 sheet.save(ROOT/f'tmp/source-import/contact-{batch//48}.jpg')
