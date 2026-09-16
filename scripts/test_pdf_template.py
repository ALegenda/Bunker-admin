import unittest,importlib.util,tempfile,json,copy,hashlib
from pathlib import Path
from contextlib import redirect_stdout
import io
spec=importlib.util.spec_from_file_location('builder',Path(__file__).with_name('build-template-pdf.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TemplateExport(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  original=json.loads((m.ROOT/'docs/cards.json').read_text());images=json.loads((m.ROOT/'public/assets/card-images.json').read_text())
  cls.base=[dict(c,id=str(i),image=images.get(str(i),{}).get('image','')) for i,c in enumerate(original)]+json.loads((m.ROOT/'public/assets/rule-sections.json').read_text())
 def run_export(self,cards,d):
  payload=Path(d)/'input.json';payload.write_text(json.dumps({'cards':cards},ensure_ascii=False))
  with redirect_stdout(io.StringIO()):m.build(payload,Path(d)/'out')
  return json.loads((Path(d)/'out/result.json').read_text())
 def test_no_change_is_identical_file(self):
  with tempfile.TemporaryDirectory() as d:
   report=self.run_export(self.base,d)
   self.assertEqual(report['sha256'],hashlib.sha256(m.REFERENCE.read_bytes()).hexdigest());self.assertEqual(report['unchangedPagesVerified'],85)
 def test_alibi_changes_only_requested_attributes_and_region(self):
  cards=copy.deepcopy(self.base);cards[3]['attributes']['activationTime']=['дневное','ночное'];cards[3]['attributes']['usageLocation']=['внутри бункера','на вылазке']
  with tempfile.TemporaryDirectory() as d:
   report=self.run_export(cards,d)
   self.assertEqual(report['pages'],85);self.assertEqual(report['unchangedPagesVerified'],84);self.assertEqual(report['changedPages'],[5]);self.assertTrue(report['outsideEditRegionsVerified'])
   new=report['appliedChanges'][0]['newText'];self.assertIn('дневное/ночное',new);self.assertNotIn('Голосование',new)
   out=m.pdf.open(Path(d)/'out/rules-preview.pdf');text=out[4].get_text(clip=m.pdf.Rect(report['editRegions'][0]['rect']));self.assertIn(new,text);self.assertNotIn(report['appliedChanges'][0]['oldText'],text)
 def test_overflow_rejects_instead_of_shrinking(self):
  cards=copy.deepcopy(self.base);cards[3]['attributes']['tags']=['Большой новый тег']*60
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaisesRegex(ValueError,'не помещаются'):self.run_export(cards,d)
   self.assertFalse((Path(d)/'out/rules-preview.pdf').exists())
 def test_unsupported_change_is_not_silently_dropped(self):
  cards=copy.deepcopy(self.base);cards[3]['name']='Новый заголовок'
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaisesRegex(ValueError,'другие поля'):self.run_export(cards,d)
 def test_preserve_source_tags_on_location_only_change(self):
  self.assertEqual(m.attribute_text('(ночное-дневное/одноразовое/опасная личность/используется, находясь внутри бункера)',{'usageLocation':['внутри бункера']},{'usageLocation':['на вылазке']}),'(ночное-дневное/одноразовое/опасная личность/используется, находясь на вылазке)')
if __name__=='__main__':unittest.main()
