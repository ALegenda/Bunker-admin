"""Normalize source metadata categories without changing descriptions or the applied v1 manifest."""
import json,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'resources/rules-2026-05-24/manifest.json').read_text())
entries=[]
for e in manifest['entries']:
 before=e['attributes'];after=json.loads(json.dumps(before));freq=[before['usageFrequency']];tags=[];locations=[]
 for tag in before['tags']:
  if 'разов' in tag:freq.append(tag)
  else:tags.append(tag.lower().strip('* '))
 for location in before['usageLocation']:
  if 'опасная личность' in location.lower():tags.append('опасная личность')
  found=re.findall(r'внутри бункера|на вылазке|снаружи бункера',location.lower())
  locations.extend(found or ([] if 'опасная личность' in location.lower() else [location]))
 after['activationTime']=list(dict.fromkeys(t.lower() for t in before['activationTime']))
 after['usageFrequency']=', '.join(dict.fromkeys(f.lower() for f in freq if f))
 after['usageLocation']=list(dict.fromkeys(locations));after['tags']=list(dict.fromkeys(tags))
 if before!=after:entries.append({'id':e['id'],'name':e['name'],'before':before,'after':after})
result={'id':'rules-2026-05-24-attributes-v2','sourceSha256':manifest['sourceSha256'],'entries':entries}
(root/'resources/rules-2026-05-24/attribute-corrections.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('Attribute corrections:',len(entries))
for e in entries:print(e['name'], e['after'])
