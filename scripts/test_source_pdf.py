import unittest,importlib.util
from pathlib import Path
from lxml import etree as E
spec=importlib.util.spec_from_file_location('source_pdf',Path(__file__).with_name('build-source-pdf.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SourcePatching(unittest.TestCase):
 def test_preserves_drawing_and_bold_run(self):
  p=E.fromstring(f'<w:p xmlns:w="{m.NS["w"]}"><w:r><w:rPr><w:b/></w:rPr><w:t>Алиби</w:t></w:r><w:r><w:drawing/><w:t> – старый текст.</w:t></w:r></w:p>')
  m.replace_text(p,'Алиби – новый текст!');self.assertEqual(m.text(p),'Алиби – новый текст!');self.assertIsNotNone(p.find('.//w:drawing',m.NS));self.assertIsNotNone(p.find('.//w:b',m.NS))
 def test_block_expansion_and_shortening(self):
  root=E.fromstring(f'<w:body xmlns:w="{m.NS["w"]}"><w:p><w:r><w:t>Один</w:t></w:r></w:p><w:p><w:r><w:t>Два</w:t></w:r></w:p></w:body>')
  m.replace_block(list(root),'Первый\n\nВторой\n\nТретий');self.assertEqual([m.text(p) for p in root],['Первый','Второй','Третий']);m.replace_block(list(root),'Единственный');self.assertEqual([m.text(p) for p in root],['Единственный'])
 def test_boundaries_empty_runs_and_multiple_replacements(self):
  p=E.fromstring(f'<w:p xmlns:w="{m.NS["w"]}"><w:r><w:t>А</w:t></w:r><w:r><w:t></w:t></w:r><w:r><w:t>БВГ</w:t></w:r></w:p>')
  m.replace_text(p,'А!БГ?');self.assertEqual(m.text(p),'А!БГ?')
if __name__=='__main__':unittest.main()
