"""Reference PDF preview: exact untouched pages and bounded attribute replacements."""
import json,sys,re,hashlib,shutil,math
import numpy as np
from pathlib import Path
from pdf_template import ROOT,REFERENCE,pdf

def attribute_text(original,before,after):
    """Apply only edited properties; preserve all other wording of the PDF."""
    parts=original.strip()[1:-1].split('/')
    for key,pattern in [('activationTime',r'^(?:дневное|ночное)(?:[–—-](?:дневное|ночное))*$'),('usageFrequency',r'^(одноразовое|двухразовое|тр[её]хразовое|многоразовое|пассивное)$')]:
        if before.get(key)==after.get(key):continue
        ids=[i for i,p in enumerate(parts) if re.match(pattern,p.strip())];at=ids[0] if ids else 0
        parts=[p for i,p in enumerate(parts) if i not in ids]
        value=after.get(key,[]);values=value if isinstance(value,list) else [value] if value else []
        parts[at:at]=values
    if before.get('tags')!=after.get('tags'):
        old=before.get('tags') or [];old=[old] if isinstance(old,str) else old
        parts=[p for p in parts if p.strip() not in old]
        tags=after.get('tags') or [];tags=[tags] if isinstance(tags,str) else tags
        at=next((i for i,p in enumerate(parts) if 'используется' in p),len(parts));parts[at:at]=tags
    if before.get('usageLocation')!=after.get('usageLocation'):
        parts=[p for p in parts if not re.match(r'^используется',p.strip())]
        loc=after.get('usageLocation') or [];loc=', '.join(loc) if isinstance(loc,list) else loc
        if loc:parts.append('используется, находясь '+loc)
    return '('+'/'.join(parts)+')'

def wrap(text,width,font,size):
    result=[];line=''
    for word in text.split():
        if font.text_length(word,fontsize=size)>width:raise ValueError('В тексте есть слово, которое не помещается в область шаблона.')
        candidate=(line+' '+word).strip()
        if line and font.text_length(candidate,fontsize=size)>width:result.append(line);line=word
        else:line=candidate
    if line:result.append(line)
    return result

def build(payload_path,outdir):
    out=Path(outdir);out.mkdir(parents=True,exist_ok=True)
    template=json.loads((REFERENCE.parent/'template.json').read_text())
    if hashlib.sha256(REFERENCE.read_bytes()).hexdigest()!=template['sha256']:raise ValueError('PDF-эталон изменился. Требуется повторный импорт шаблона.')
    originals=json.loads((ROOT/'docs/cards.json').read_text());images=json.loads((ROOT/'public/assets/card-images.json').read_text());sections=json.loads((ROOT/'public/assets/rule-sections.json').read_text())
    baseline={str(i):dict(c,id=str(i),image=images.get(str(i),{}).get('image','')) for i,c in enumerate(originals)};baseline.update({c['id']:c for c in sections})
    cards=json.loads(Path(payload_path).read_text())['cards'];fields=['name','description','attributes','image','cardType'];edits=[]
    if set(baseline)-{c['id'] for c in cards}:raise ValueError('В черновике отсутствуют исходные элементы.')
    for c in cards:
        old=baseline.get(c['id'])
        if old is None:raise ValueError('Новые элементы требуют расширения PDF-шаблона: '+c['name'])
        changed=[k for k in fields if old.get(k)!=c.get(k)]
        if not changed:continue
        if changed!=['attributes']:raise ValueError('В точном шаблоне пока поддержаны правки характеристик. Для «'+c['name']+'» изменены другие поля; используйте отдельную пробную сборку Word.')
        entry=template['entries'].get(c['id'])
        if not entry or not entry['attributes']:raise ValueError('В PDF не найдена однозначная область характеристик: '+c['name'])
        lines=entry['attributes'];oldtext=' '.join(l['text'] for l in lines);newtext=attribute_text(oldtext,old.get('attributes') or {},c.get('attributes') or {})
        if newtext==oldtext:continue
        font=pdf.Font(fontfile=str(ROOT/'resources/fonts/segoepr.ttf'));size=lines[0]['size'];x=lines[0]['origin'][0];right=552.82
        replacement=wrap(newtext,right-x,font,size)
        if len(replacement)>len(lines):raise ValueError('«'+c['name']+'»: характеристики не помещаются в исходную область ('+str(len(replacement))+' строк вместо '+str(len(lines))+'). Уменьшение шрифта и обрезка отключены.')
        edits.append({'id':c['id'],'name':c['name'],'page':entry['page'],'fields':changed,'oldText':oldtext,'newText':newtext,'sourceLines':lines,'replacement':replacement})
    doc=pdf.open(REFERENCE);regions=[]
    for pi in sorted({e['page'] for e in edits}):
        page=doc[pi];items=[e for e in edits if e['page']==pi]
        for e in items:
            for line in e['sourceLines']:page.add_redact_annot(pdf.Rect(line['bbox']),fill=False,cross_out=False)
        page.apply_redactions(images=0,graphics=0)
        page.insert_font(fontname='BunkerSegoePrint',fontfile=str(ROOT/'resources/fonts/segoepr.ttf'))
        for e in items:
            for i,line in enumerate(e['sourceLines']):
                box=list(line['bbox']);box[0]-=1;box[1]-=1;box[2]=552.82;box[3]+=1;regions.append({'page':pi,'rect':box})
                if i<len(e['replacement']):page.insert_text(line['origin'],e['replacement'][i],fontname='BunkerSegoePrint',fontsize=line['size'])
    target=out/'rules-preview.pdf'
    if edits:doc.save(target,garbage=3,deflate=True)
    else:shutil.copyfile(REFERENCE,target)
    doc.close()
    # Pixel comparison is a regression check, not a claim about text semantics.
    source=pdf.open(REFERENCE);result=pdf.open(target);changed_pages={e['page'] for e in edits};verified=[]
    for i in range(len(source)):
        a=source[i].get_pixmap(matrix=pdf.Matrix(2,2));b=result[i].get_pixmap(matrix=pdf.Matrix(2,2))
        left=np.frombuffer(a.samples,dtype=np.uint8).reshape(a.height,a.width,a.n)
        right=np.frombuffer(b.samples,dtype=np.uint8).reshape(b.height,b.width,b.n)
        different=np.any(left!=right,axis=2)
        for region in regions:
            if region['page']!=i:continue
            x0,y0,x1,y1=region['rect']
            different[max(0,math.floor(y0*2)):math.ceil(y1*2),max(0,math.floor(x0*2)):math.ceil(x1*2)]=False
        if different.any():raise ValueError('Изменение за пределами разрешённой области на странице '+str(i+1))
        if i not in changed_pages:verified.append(i+1)
    fonts=sorted({f[3].split('+')[-1] for p in result for f in p.get_fonts()})
    report={'status':'ready','reviewOnly':True,'mode':'reference-template','pages':len(result),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'fonts':fonts,'appliedChanges':[{k:e[k] for k in ['id','name','fields','oldText','newText']} for e in edits],'templateSha256':template['sha256'],'changedPages':[i+1 for i in sorted(changed_pages)],'unchangedPagesVerified':len(verified),'outsideEditRegionsVerified':True,'verificationDpi':144,'editRegions':regions,'warnings':['Сборка по PDF-эталону: неизменённые страницы проверены попиксельно. Изменённые области требуют просмотра.','На этом этапе шаблон поддерживает правки характеристик в пределах исходной области. Остальные правки доступны в пробной сборке Word.']}
    (out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':
    try:build(sys.argv[1],sys.argv[2])
    except Exception as e:
        out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);(out/'result.json').write_text(json.dumps({'status':'failed','error':str(e)},ensure_ascii=False));print(e,file=sys.stderr);sys.exit(1)
