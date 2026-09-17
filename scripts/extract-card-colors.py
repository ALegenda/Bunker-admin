"""Read-only color evidence and contact sheets from source.pdf; writes only to tmp/card-metadata.
Requires PyMuPDF and Pillow. Run from the repository root.
"""
import sys,json,collections,colorsys
from pathlib import Path
import pymupdf as fitz
from PIL import Image,ImageDraw
Path('tmp/card-metadata').mkdir(parents=True,exist_ok=True)
m=json.load(open('resources/rules-2026-05-24/manifest.json'));doc=fitz.open('resources/rules-2026-05-24/source.pdf')
result=[]
for p in range(len(doc)):
 entries=[e for e in m['entries'] if e['cardType']!='правило' and e['source']['pageStart']==p+1]
 images=sorted([im for im in doc[p].get_image_info() if im['bbox'][0]<125 and im['bbox'][2]<140 and im['bbox'][3]-im['bbox'][1]>50],key=lambda im:im['bbox'][1])
 assert len(entries)==len(images),(p,len(entries),len(images))
 for e,im in zip(entries,images):
  pix=doc[p].get_pixmap(matrix=fitz.Matrix(3,3),clip=fitz.Rect(im['bbox']))
  path=f"tmp/card-metadata/{e['id']}.png";pix.save(path)
  img=Image.open(path).convert('RGB');w,h=img.size
  pixels=[img.getpixel((int(x*w),int(y*h))) for x,y in [(x/100,y/100) for x in range(20,80,4) for y in [2,3,4,96,97]]+[(x/100,y/100) for x in [2,3,4,96,97] for y in range(20,80,4)]]
  dominant=collections.Counter(tuple(round(v/16)*16 for v in rgb) for rgb in pixels).most_common(1)[0][0]
  result.append(dict(id=e['id'],name=e['name'],type=e['cardType'],rgb=dominant,page=p+1))
for batch in range(0,len(result),54):
 part=result[batch:batch+54];sheet=Image.new('RGB',(1080,((len(part)+8)//9)*190),'#f4f4f4');draw=ImageDraw.Draw(sheet)
 for n,r in enumerate(part):
  img=Image.open(f"tmp/card-metadata/{r['id']}.png");img.thumbnail((105,155));x=n%9*120;y=n//9*190;sheet.paste(img,(x,y));draw.text((x,y+156),str(batch+n),fill='black');draw.text((x,y+170),str(r['rgb']),fill='black')
 sheet.save(f'tmp/card-metadata/sheet-{batch//54}.png')
json.dump(result,open('tmp/card-metadata/colors.json','w'),ensure_ascii=False,indent=2)
print(collections.Counter(tuple(r['rgb']) for r in result))
