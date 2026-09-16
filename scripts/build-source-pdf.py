"""Build a review-only PDF from the original Word layout plus explicit draft changes.
The original and the editor's legacy JSON are not equivalent baselines. Untouched
Word text is retained; this is deliberately labelled a source-layout preview.
"""
import sys,json,re,copy,io,base64,os,subprocess,hashlib
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from difflib import SequenceMatcher
from lxml import etree as E
from PIL import Image,ImageOps
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
W='{'+NS['w']+'}'
def text(p):return ''.join(p.xpath('.//w:t/text()',namespaces=NS))
def replace_text(p,new):
    """Keep existing runs/drawings and styles, replacing only affected text spans."""
    ts=p.findall('.//w:t',NS)
    if not ts:
        run=E.SubElement(p,W+'r');t=E.SubElement(run,W+'t');t.text=new;return
    old=''.join(t.text or '' for t in ts);positions=[];n=0
    for t in ts:positions.append(n);n+=len(t.text or '')
    for tag,a,b,c,d in reversed(SequenceMatcher(None,old,new,autojunk=False).get_opcodes()):
        if tag=='equal':continue
        first=max(i for i,pos in enumerate(positions) if pos<=a)
        last=max(i for i,pos in enumerate(positions) if pos<max(a+1,b))
        if first==last:
            value=ts[first].text or '';ts[first].text=value[:a-positions[first]]+new[c:d]+value[b-positions[first]:]
        else:
            ts[first].text=(ts[first].text or '')[:a-positions[first]]+new[c:d]
            ts[last].text=(ts[last].text or '')[b-positions[last]:]
            for i in range(first+1,last):ts[i].text=''
    for t in ts:
        t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        if '\n' in (t.text or ''):
            parts=t.text.split('\n');t.text=parts[0];anchor=t
            for part in parts[1:]:
                br=E.Element(W+'br');anchor.addnext(br);nt=E.Element(W+'t');nt.text=part;nt.set('{http://www.w3.org/XML/1998/namespace}space','preserve');br.addnext(nt);anchor=nt
def replace_block(paragraphs,new):
    values=[v for v in re.split(r'\n\s*\n',new) if v.strip()]
    if not values:values=['']
    nonempty=[p for p in paragraphs if text(p).strip()]
    if not nonempty:raise ValueError('Не найден текстовый блок для правки.')
    for i,v in enumerate(values):
        if i<len(nonempty):replace_text(nonempty[i],v)
        else:
            clone=E.Element(W+'p');style=nonempty[-1].find(W+'pPr')
            if style is not None:clone.append(copy.deepcopy(style))
            run=E.SubElement(clone,W+'r');style=nonempty[-1].find('.//w:rPr',NS)
            if style is not None:run.append(copy.deepcopy(style))
            t=E.SubElement(run,W+'t');t.text=v;t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
            nonempty[-1].addnext(clone);nonempty.append(clone)
    for p in nonempty[len(values):]:
        if p.find('.//w:drawing',NS) is not None:replace_text(p,'')
        else:p.getparent().remove(p)
def build(payload_path,outdir):
    outdir=Path(outdir);outdir.mkdir(parents=True,exist_ok=True)
    payload=json.loads(Path(payload_path).read_text());source=ROOT/'tmp/source-import/Правила Бункер Картинки.docx'
    if not source.exists():raise ValueError('Не найдена рабочая копия исходного Word.')
    cards=payload['cards'];original=json.loads((ROOT/'docs/cards.json').read_text());images=json.loads((ROOT/'public/assets/card-images.json').read_text());sections=json.loads((ROOT/'public/assets/rule-sections.json').read_text())
    baseline={str(i):dict(c,id=str(i),image=images.get(str(i),{}).get('image','')) for i,c in enumerate(original)}
    baseline.update({c['id']:c for c in sections})
    fields=['name','description','attributes','image','cardType'];updates=[];errors=[]
    if set(baseline)-{c.get('id') for c in cards}:raise ValueError('В черновике отсутствуют элементы исходной базы. Сначала обновите редактор.')
    for card in cards:
        old=baseline.get(card.get('id'))
        if old is None:errors.append(f'«{card.get("name", "Новый элемент")}»: вставка новых элементов в Word-шаблон ещё не поддерживается.');continue
        changed=[k for k in fields if card.get(k)!=old.get(k)]
        if not changed:continue
        if 'cardType' in changed:errors.append(f'«{card["name"]}»: перемещение в другой раздел требует настройки шаблона.');continue
        if card['id'] not in images and not old.get('source'):errors.append(f'«{card["name"]}»: нет подтверждённого блока в Word.');continue
        updates.append((card,old,changed))
    if errors:raise ValueError('\n'.join(errors))
    z=ZipFile(source);root=E.fromstring(z.read('word/document.xml'));ps=root.findall('.//w:p',NS);rels=E.fromstring(z.read('word/_rels/document.xml.rels'));relmap={r.get('Id'):r for r in rels};assets={}
    boundaries=[i for i,p in enumerate(ps) if p.find('.//a:blip',NS) is not None]+[len(ps)]
    for card,old,changed in updates:
        id=card['id'];src=old.get('source')
        if src:lo,hi=src['paragraphStart'],src['paragraphEndExclusive']
        else:
            lo=images[id]['textParagraph'];hi=next(i for i in boundaries if i>lo)
        block=ps[lo:hi];attrs=[p for p in block if re.match(r'^\s*\((?:днев|ноч|одно|двух|тр[её]х|много|пасс|использ)',text(p),re.I)]
        desc=[p for p in block if p not in attrs]
        if 'description' in changed:
            desired=card['description']
            if not src:desired=f'{card["name"]} – {desired}'
            replace_block(desc,desired)
        if 'name' in changed:
            heading=next((p for p in desc if text(p).strip()),None)
            if heading is not None:
                original_heading=re.split(r'\s+[–—]\s+',text(heading),maxsplit=1)[0]
                if original_heading.strip().lower().replace('ё','е')==old['name'].lower().replace('ё','е'):replace_text(heading,text(heading).replace(original_heading,card['name'],1))
                elif 'description' not in changed:raise ValueError(f'«{card["name"]}»: название раздела не соответствует печатному заголовку. Измените заголовок в тексте описания.')
        if 'attributes' in changed:
            # Editorial tags for imported sections have no counterpart in the source PDF.
            before=dict(old.get('attributes') or {});after=dict(card.get('attributes') or {})
            if src and set(before)|set(after)<= {'tags'}:pass
            else:
                a=card.get('attributes') or {};parts=[]
                for k in ['activationTime','usageFrequency','tags']:
                    v=a.get(k);parts.extend(v if isinstance(v,list) else [v] if v else [])
                loc=a.get('usageLocation',[])
                if loc:parts.append('используется, находясь '+', '.join(loc))
                value='('+ '/'.join(parts)+')'
                if attrs:replace_block(attrs,value)
                else:
                    anchor=next((p for p in reversed(block) if p.getparent() is not None),None)
                    p=E.Element(W+'p');r=E.SubElement(p,W+'r');t=E.SubElement(r,W+'t');t.text=value;anchor.addnext(p)
        if 'image' in changed:
            imageblock=([ps[images[id]['sourceParagraph']]] if id in images else block)
            blip=next((p.find('.//a:blip',NS) for p in imageblock if p.find('.//a:blip',NS) is not None),None)
            if blip is None:raise ValueError(f'«{card["name"]}»: в шаблоне нет места под изображение.')
            value=card.get('image','')
            if not value:raise ValueError('Удаление изображения из шаблона пока не поддерживается.')
            if value.startswith('data:image/'):
                raw=base64.b64decode(value.split(',',1)[1],validate=True)
            else:
                imgpath=(ROOT/'public'/value.lstrip('/')).resolve()
                if not imgpath.is_relative_to((ROOT/'public/assets').resolve()):raise ValueError('Недопустимый путь изображения.')
                raw=imgpath.read_bytes()
            im=Image.open(io.BytesIO(raw));im=ImageOps.exif_transpose(im).convert('RGB')
            rel=relmap[blip.get('{'+NS['r']+'}embed')];oldimage=Image.open(io.BytesIO(z.read('word/'+rel.get('Target'))));ratio=oldimage.width/oldimage.height
            size=(max(1,int(900*ratio)),900);canvas=Image.new('RGB',size,'white');fitted=ImageOps.contain(im,size);canvas.paste(fitted,((size[0]-fitted.width)//2,(size[1]-fitted.height)//2));bio=io.BytesIO();canvas.save(bio,'PNG');filename='media/draft-'+hashlib.sha256(id.encode()).hexdigest()[:12]+'.png';rel.set('Target',filename);assets['word/'+filename]=bio.getvalue()
    types=E.fromstring(z.read('[Content_Types].xml'))
    if assets and not any(e.get('Extension')=='png' for e in types):E.SubElement(types,'{http://schemas.openxmlformats.org/package/2006/content-types}Default',Extension='png',ContentType='image/png')
    # Provisional export uses an explicit available font, not an unpredictable OS substitute.
    # Never label this as faithful output; the report records the substitution.
    styles=E.fromstring(z.read('word/styles.xml'))
    font_substituted=not ((ROOT/'resources/fonts/segoepr.ttf').exists() and (ROOT/'resources/fonts/segoeprb.ttf').exists())
    for tree in [root,styles]:
        for node in tree.findall('.//w:rFonts',NS):
            if any('segoe print' in v.lower() or 'a_futuraround' in v.lower() for v in node.attrib.values()):
                for key in list(node.attrib):
                    if 'theme' in key.lower():del node.attrib[key]
                for key in ['ascii','hAnsi','eastAsia','cs']:node.set(W+key,'Calibri' if font_substituted else 'Segoe Print')
    overrides={'word/document.xml':E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True),'word/styles.xml':E.tostring(styles,xml_declaration=True,encoding='UTF-8',standalone=True),'word/_rels/document.xml.rels':E.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True),'[Content_Types].xml':E.tostring(types,xml_declaration=True,encoding='UTF-8',standalone=True),**assets}
    working=outdir/'rules-preview.docx'
    with ZipFile(working,'w',ZIP_DEFLATED) as dest:
        for info in z.infolist():dest.writestr(info,overrides.pop(info.filename,z.read(info.filename)))
        for key,data in overrides.items():dest.writestr(key,data)
    deps=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies';soffice=deps/'bin/override/soffice'
    config=outdir/'fonts.conf';fontdirs=[ROOT/'resources/fonts',Path('/Applications/Microsoft Outlook.app/Contents/Resources/DFonts'),Path('/System/Library/Fonts'),deps/'native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype']
    fc=E.Element('fontconfig')
    for d in fontdirs:
        if d.exists():E.SubElement(fc,'dir').text=str(d)
    # Make the provisional fallback deterministic instead of choosing a CJK system font.
    if not ((ROOT/'resources/fonts/segoepr.ttf').exists() and (ROOT/'resources/fonts/segoeprb.ttf').exists()):
        alias=E.SubElement(fc,'alias');E.SubElement(alias,'family').text='Segoe Print';prefer=E.SubElement(alias,'prefer');E.SubElement(prefer,'family').text='Linux Libertine G'
    E.SubElement(fc,'cachedir').text=str(outdir/'font-cache');config.write_bytes(E.tostring(fc,xml_declaration=True,encoding='UTF-8'))
    env=dict(os.environ,FONTCONFIG_FILE=str(config),SAL_FONTPATH=':'.join(str(d) for d in fontdirs if d.exists()))
    run=subprocess.run([str(soffice),'--headless','--convert-to','pdf','--outdir',str(outdir),str(working)],env=env,capture_output=True,text=True,timeout=180)
    (outdir/'renderer.log').write_text(run.stdout+'\n'+run.stderr)
    pdf=outdir/'rules-preview.pdf'
    if run.returncode or not pdf.exists():raise ValueError('Не удалось экспортировать Word. Проверьте журнал генератора.')
    r=PdfReader(pdf);fonts=set()
    for page in r.pages:
        for ref in page.get('/Resources',{}).get('/Font',{}).values():fonts.add(str(ref.get_object().get('/BaseFont','')).split('+')[-1])
    report={'status':'ready','reviewOnly':True,'pages':len(r.pages),'bytes':pdf.stat().st_size,'sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'fonts':sorted(fonts),'appliedChanges':[{'id':c['id'],'name':c['name'],'fields':f} for c,o,f in updates],'warnings':['Это PDF исходного Word с правками черновика. Неизменённые тексты взяты из Word, а не из старой базы JSON.','Точное совпадение с эталонным PDF пока не подтверждено.']}
    if font_substituted or not any('SegoePrint' in f.replace('-','').replace(' ','') for f in fonts):report['warnings'].insert(0,'Segoe Print подменён: полный шрифт не найден. Переносы и оформление могут отличаться.')
    (outdir/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));working.unlink();print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':
    try:build(sys.argv[1],sys.argv[2])
    except Exception as e:
        out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);(out/'result.json').write_text(json.dumps({'status':'failed','error':str(e)},ensure_ascii=False));print(str(e),file=sys.stderr);sys.exit(1)
