"""Import physical text positions from the reference PDF; never reflow other pages."""
import sys, json, re, hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tmp/pdf-deps'))
import pymupdf as pdf
REFERENCE=ROOT/'resources/pdf-template/reference.pdf'

def norm(s):return re.sub(r'[^а-яa-z0-9]','',s.lower().replace('ё','е'))
def lines_of(page):
    lines=[]
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines',[]):
            spans=line['spans']
            if not spans:continue
            lines.append({'text':''.join(s['text'] for s in spans),'bbox':list(line['bbox']),'origin':list(spans[0]['origin']),'font':spans[0]['font'],'size':spans[0]['size']})
    return sorted(lines,key=lambda l:(round(l['origin'][1],1),l['origin'][0]))

def import_template():
    doc=pdf.open(REFERENCE);pages=[lines_of(p) for p in doc];cards=json.loads((ROOT/'docs/cards.json').read_text());entries={};missing=[]
    # Section ranges verified against the reference, not the Word page numbers.
    ranges={'умение':(3,40),'мёртвый бонус':(40,52),'припас':(52,75)}
    for id,card in enumerate(cards):
        lo,hi=ranges[card['cardType']];found=[]
        for pi in range(lo,hi):
            for li,line in enumerate(pages[pi]):
                prefixes=[line['text'][:m.start()] for m in re.finditer(r'\s+[–—-]\s+',line['text'])]
                if 'Bold' in line['font'] and any(norm(prefix)==norm(card['name']) for prefix in prefixes):found.append((pi,li))
        if len(found)!=1:
            missing.append({'id':str(id),'name':card['name'],'reason':'ambiguous' if found else 'not-found'});continue
        pi,li=found[0];heading=pages[pi][li];attr=[]
        for line in pages[pi][li+1:]:
            if 'Bold' in line['font'] and re.match(r'^.+?\s+[–—-]\s+',line['text']):break
            if not attr:
                if re.match(r'^\((?:дневное|ночное|одноразовое|двухразовое|тр[её]хразовое|многоразовое|пассивное)',line['text']):attr.append(line)
            else:attr.append(line)
            if attr and attr[-1]['text'].rstrip().endswith(')'):break
        if attr and not attr[-1]['text'].rstrip().endswith(')'):attr=[]
        entries[str(id)]={'name':card['name'],'page':pi,'heading':heading,'attributes':attr}
    result={'schema':1,'sha256':hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),'pages':len(doc),'entries':entries,'unmapped':missing}
    (REFERENCE.parent/'template.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({'mapped':len(entries),'attributes':sum(bool(e['attributes']) for e in entries.values()),'unmapped':missing},ensure_ascii=False))
    return result

if __name__=='__main__':import_template()
