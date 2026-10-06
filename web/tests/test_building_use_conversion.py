import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("conversion", ROOT / "scripts/build-building-use-codes.py")
conversion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conversion)


def workbook(path, data):
    rows = [("코드값", "코드값의미", "비고"), *data]
    xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    for number, row in enumerate(rows, 1):
        xml += f'<row r="{number}">' + ''.join(f'<c r="{col}{number}" t="inlineStr"><is><t>{escape(value)}</t></is></c>' for col, value in zip("ABC", row)) + '</row>'
    xml += '</sheetData></worksheet>'
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="codes" r:id="r1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", xml)


class ConversionTests(unittest.TestCase):
    def test_authoritative_source_matches_committed_lookup_and_audit(self):
        lookup, report = conversion.convert(ROOT / "data/reference/source/buinding code.xlsx")
        self.assertEqual(lookup, json.loads((ROOT / "data/reference/building_use_codes.json").read_text()))
        self.assertEqual(report, json.loads((ROOT / "data/reference/building_use_codes.report.json").read_text()))
        self.assertEqual((report["excelRowsRead"], report["dataRowsRead"], report["validCodeRows"], report["uniqueCodes"]), (969, 968, 694, 694))
        self.assertEqual(report["leadingZeroCodes"], 293)
        self.assertEqual(len(report["excludedRows"]), 274)
        self.assertEqual(sum(r["reason"] == "legacy_length_change" for r in report["excludedRows"]), 271)
        self.assertEqual(report["conflictingCodes"], {})
        self.assertEqual(lookup["03000"]["name"], "제1종근린생활시설")
        self.assertEqual(lookup["14000"]["note"], "2009년 12월 24일 개정")
        self.assertNotIn("3000", lookup)

    def test_identical_meanings_collapse_and_preserve_different_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.xlsx"
            workbook(path, [("03000", "근린시설", "개정"), ("03000", "근린시설", "참고"), ("3000", "다른 과거 뜻", "코드길이 5자리로 변경")])
            lookup, report = conversion.convert(path)
            self.assertEqual(lookup, {"03000": {"name": "근린시설", "note": "개정\n참고"}})
            self.assertEqual(report["validCodeRows"], 2)
            self.assertEqual(len(report["duplicateCodes"]), 1)
            self.assertEqual(report["conflictingCodes"], {})

    def test_conflicts_and_malformed_rows_report_without_overwriting_lookup(self):
        for rows in [[("03000", "시설 A", ""), ("03000", "시설 B", "")], [("XXXXX", "시설", "")], [("03000", "", "")]]:
            with self.subTest(rows=rows), tempfile.TemporaryDirectory() as directory:
                source, output, report = [Path(directory) / name for name in ("source.xlsx", "lookup.json", "report.json")]
                workbook(source, rows)
                output.write_text("original lookup")
                with patch("sys.argv", ["convert", "--source", str(source), "--output", str(output), "--report", str(report)]), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(conversion.main(), 1)
                self.assertEqual(output.read_text(), "original lookup")
                audit = json.loads(report.read_text())
                self.assertTrue(audit["conflictingCodes"] or audit["malformedRows"])


if __name__ == "__main__":
    unittest.main()
