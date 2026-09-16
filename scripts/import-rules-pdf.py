"""Extract the authoritative 24 May rules, matching existing IDs by type and title.
Requires PyMuPDF. Keeps text styling and audits every source text line.
"""
import json,re,hashlib,html,sys
from pathlib import Path
import pymupdf as fitz
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'resources/rules-2026-05-24'
PDF=DEST/'source.pdf'
PREFIX='<!--bunker-rich-text:v1-->'
old=[dict(c,id=str(i)) for i,c in enumerate(json.loads((ROOT/'docs/cards.json').read_text()))]+json.loads((ROOT/'public/assets/rule-sections.json').read_text())
def norm(s):return re.sub(r'\W','',s.lower().replace('ё','е'))
def separators(text):return list(re.finditer(r'\s*[–—]\s*|\s+-\s+',text))
def text(line):return ''.join(s['text'] for s in line['spans']).strip()
doc=fitz.open(PDF);lines=[];starts=[];drawings={}
for i,page in enumerate(doc):
 drawings[i+1]=page.get_drawings()
 raw=sorted([l for b in page.get_text('dict')['blocks'] if b['type']==0 for l in b['lines']],key=lambda l:(round(l['bbox'][1],1),l['bbox'][0]))
 # PDF list markers can be separate text objects at the same baseline.
 merged=[]
 for line in raw:
  if merged and abs(line['bbox'][1]-merged[-1]['bbox'][1])<1:
   merged[-1]['spans'].append(dict(line['spans'][0],text=' '))
   merged[-1]['spans'].extend(line['spans'])
   merged[-1]['bbox']=(merged[-1]['bbox'][0],merged[-1]['bbox'][1],line['bbox'][2],max(line['bbox'][3],merged[-1]['bbox'][3]))
  else:merged.append(line)
 for line in merged:line['page']=i+1;line['index']=len(lines);lines.append(line)
 images=[im for im in page.get_image_info() if im['bbox'][0]<125 and im['bbox'][2]<140 and im['bbox'][3]-im['bbox'][1]>50]
 kind='роль' if i==2 else 'умение' if i<40 else 'мёртвый бонус' if i<52 else 'припас' if i<75 else 'наёмник'
 for im in images:
  candidates=[l for l in merged if abs(l['bbox'][1]-im['bbox'][1])<26 and l['bbox'][0]>120 and separators(text(l)) and separators(text(l))[0].start()<65]
  assert candidates, (i+1,im['bbox'])
  line=min(candidates,key=lambda l:l['bbox'][1]);t=text(line)
  choices=[(o,m) for m in separators(t) for o in old if o['cardType']==kind and norm(o['name'])==norm(t[:m.start()])]
  assert len(choices)<=1,(i+1,t,choices)
  match=choices[0] if choices else None;sep=match[1] if match else separators(t)[0]
  name=t[:sep.start()].strip()
  assert len(name)>=2,(i+1,name)
  id=match[0]['id'] if match else 'pdf24-'+hashlib.sha256((kind+':'+norm(name)).encode()).hexdigest()[:12]
  starts.append(dict(id=id,name=name,cardType=kind,index=line['index'],titleEnd=sep.end(),imageRect=im['bbox'],page=i+1,new=not bool(match)))
# General-rule sections have no card illustration; their boundaries are explicit source headings.
for id,name,prefix in [('rule-intro','Об игре','Здравствуйте, дорогие друзья!'),('rule-outing','Вылазка','Вылазка –'),('rule-dead','Игра мёртвых','Игра мертвых –'),('rule-duel','Дуэль','Дуэль –'),('rule-skills','Карты умений','Карта умения такая же')]:
 line=next(l for l in lines if text(l).startswith(prefix));starts.append(dict(id=id,name=name,cardType='правило',index=line['index'],titleEnd=0,page=line['page'],new=False))
starts.sort(key=lambda s:s['index']);assert len({s['id'] for s in starts})==len(starts)
assert len(starts)==329,len(starts)

def style(span,page):
 box=fitz.Rect(span['bbox']);cx=(box.x0+box.x1)/2;cy=(box.y0+box.y1)/2;bg=None;under=False
 for d in drawings[page]:
  r=d['rect']
  if d['fill'] and r.x0-.5<=cx<=r.x1+.5 and r.y0-.5<=cy<=r.y1+.5 and r.height<30:
   bg='#'+''.join(f'{round(v*255):02x}' for v in d['fill'][:3])
  if d['type']=='s' and r.height<1 and span['origin'][1]-.5<=r.y0<=span['origin'][1]+3 and r.x0<=cx<=r.x1:under=True
 fg=f'#{span["color"]:06x}' if span['color'] else None
 assert not(fg=='#ffffff' and not bg and span['text'].strip()),('white text without background',page,span['text'])
 return ('Bold' in span['font'], bool(span['flags']&2),under,fg,bg)

def richLine(line,skip=0):
 groups=[];offset=0
 for s in line['spans']:
  t=s['text'];end=offset+len(t)
  if end<=skip:offset=end;continue
  t=t[max(0,skip-offset):];offset=end
  st=style(s,line['page'])
  if groups and groups[-1][0]==st:groups[-1][1]+=t
  else:groups.append([st,t])
 result=''
 for (bold,italic,underline,fg,bg),t in groups:
  v=html.escape(t)
  if fg:v=f'<span style="color:{fg}">{v}</span>'
  if bg:v=f'<mark style="background-color:{bg}">{v}</mark>'
  if underline:v=f'<u>{v}</u>'
  if italic:v=f'<em>{v}</em>'
  if bold:v=f'<strong>{v}</strong>'
  result+=v
 return result

def attributes(value):
 value=value.strip().lstrip('(').rstrip(')')
 # The source alternates slashes and commas, and sometimes omits its closing bracket.
 match=re.search(r'(?:[А-Яа-яЁё0-9-]+\s*)?разов[А-Яа-яЁё-]*(?:-[А-Яа-яЁё]+)?',value)
 if not match:return None
 frequency=match[0].strip();times=value[:match.start()].strip(' /,')
 rest=value[match.end():].strip(' /,')
 location=re.search(r'находясь\s+(.+)',rest)
 if location:
  locations=[v.strip(' ,/') for v in re.split(r'[/,]',location[1]) if v.strip(' ,/')]
  tags=rest[:location.start()]
 else:
  locations=[v for v in ['внутри бункера','на вылазке','снаружи бункера'] if v in rest]
  tags=rest
  for v in locations:tags=tags.replace(v,'')
 tags=tags.replace('используется','').strip(' /,')
 return {'activationTime':[t for t in ['дневное','ночное'] if t in times] or ([times] if times else []),'usageFrequency':frequency,'usageLocation':locations,'tags':[v.strip() for v in re.split(r'[/,]',tags) if v.strip()]}

entries=[];coverage=[];sha=hashlib.sha256(PDF.read_bytes()).hexdigest()
for n,start in enumerate(starts):
 end=starts[n+1]['index'] if n+1<len(starts) else len(lines);source=lines[start['index']:end];coverage.extend(l['index'] for l in source)
 footer=None
 for j in range(len(source)-1,-1,-1):
  if re.match(r'^\((?:дневное|ночное|пассивное|одноразовое)',text(source[j]),re.I):
   candidate=' '.join(text(l) for l in source[j:])
   if len(candidate)<500:footer=(j,candidate,attributes(candidate))
   break
 attrs=footer[2] if footer and footer[2] else {'activationTime':[],'usageFrequency':'','usageLocation':[],'tags':[]}
 content=source[:footer[0]] if footer and footer[2] else source
 paragraphs=[];paragraph='';previous=None
 for j,line in enumerate(content):
  t=text(line);skip=start['titleEnd'] if j==0 else 0
  if skip:t=t[skip:]
  if not t:continue
  boundary=previous is None or (line['page']==previous['page'] and line['bbox'][1]-previous['bbox'][1]>25) or bool(re.match(r'^(?:\d+[.)]|[-–•*]|\d+ волна|За \d|\(Данная|Топливом|Обрез\*|Кожаная куртка\*|Связка коктейлей|И САМОЕ)',t))
  if previous and text(previous).endswith(':'):boundary=True
  if boundary and paragraph:paragraphs.append(paragraph);paragraph=''
  if paragraph and not re.search(r'-(?:</[^>]+>)*$', paragraph):paragraph+=' '
  paragraph+=richLine(line,skip)
  previous=line
 if paragraph:paragraphs.append(paragraph)
 description=PREFIX+''.join('<p>'+p+'</p>' for p in paragraphs)
 entry={k:start[k] for k in ['id','name','cardType']};entry.update(description=description,attributes=attrs,source={'file':'Правила Бункер 24.05.26.pdf','sha256':sha,'pageStart':source[0]['page'],'pageEnd':source[-1]['page'],'lineStart':start['index'],'lineEndExclusive':end},sourceText='\n'.join(text(l) for l in source),attributeText=footer[1] if footer and footer[2] else '',new=start['new'])
 if start['new']:
  pix=doc[start['page']-1].get_pixmap(matrix=fitz.Matrix(3,3),clip=fitz.Rect(start['imageRect']))
  file='images/'+start['id']+'.png';pix.save(DEST/file);entry['imageFile']=file
 entries.append(entry)
assert coverage==list(range(len(lines))), 'Source text skipped or duplicated'
retired=[{'id':c['id'],'name':c['name'],'cardType':c['cardType']} for c in old if c['id'] not in {e['id'] for e in entries}]
manifest={'id':'rules-2026-05-24','title':'Правила от 24.05.2026','sourceSha256':sha,'sourcePages':len(doc),'sourceLines':len(lines),'entries':entries,'retired':retired}
(DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'entries':len(entries),'new':sum(e['new'] for e in entries),'retired':retired,'sourceLines':len(lines),'types':{kind:sum(e['cardType']==kind for e in entries) for kind in set(e['cardType'] for e in entries)}},ensure_ascii=False,indent=2))
