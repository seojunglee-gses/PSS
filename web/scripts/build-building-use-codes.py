#!/usr/bin/env python3
"""Offline XLSX -> JSON conversion using only Python's standard library."""
import argparse
import hashlib
import json
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def workbook_rows(source):
    with zipfile.ZipFile(source) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(t.text or "" for t in si.findall(".//m:t", NS))
                       for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        relationships = {r.attrib["Id"]: r.attrib["Target"] for r in
                         ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).findall("m:sheets/m:sheet", NS):
            target = relationships[sheet.attrib[f"{{{REL}}}id"]]
            path = posixpath.normpath(posixpath.join("xl", target)) if not target.startswith("/") else target.lstrip("/")
            rows = []
            for row in ET.fromstring(archive.read(path)).findall("m:sheetData/m:row", NS):
                cells = {}
                for cell in row.findall("m:c", NS):
                    column = re.match(r"[A-Z]+", cell.attrib["r"])[0]
                    value = cell.findtext("m:v", "", NS)
                    kind = cell.attrib.get("t")
                    if kind == "s":
                        value = strings[int(value)]
                    elif kind == "inlineStr":
                        value = "".join(t.text or "" for t in cell.findall("m:is//m:t", NS))
                    # Never infer missing leading zeros from numeric cells or formulas.
                    cells[column] = (value, cell.find("m:f", NS) is not None)
                rows.append((int(row.attrib["r"]), cells))
            yield sheet.attrib["name"], rows


def convert(source):
    candidates = []
    for sheet, rows in workbook_rows(source):
        for index, (_, cells) in enumerate(rows):
            headers = {v[0].strip(): col for col, v in cells.items()}
            if {"코드값", "코드값의미", "비고"} <= headers.keys():
                candidates.append((sheet, rows, index, headers))
                break
    if len(candidates) != 1:
        raise ValueError("Expected exactly one sheet with 코드값 / 코드값의미 / 비고 headers.")
    sheet, rows, header_index, headers = candidates[0]
    groups, all_groups, excluded, malformed = {}, {}, [], []
    data_rows = valid = 0
    for row_number, cells in rows[header_index + 1:]:
        values = [cells.get(headers[h], ("", False)) for h in ("코드값", "코드값의미", "비고")]
        if not any(value[0].strip() for value in values):
            continue
        data_rows += 1
        code, name, note = [value[0].strip() for value in values]
        record = {"row": row_number, "code": code, "name": name, "note": note}
        if any(value[1] for value in values) or not name or not re.fullmatch(r"[0-9]+", code):
            malformed.append(record)
        else:
            all_groups.setdefault(code, []).append(record)
            if len(code) != 5:
                excluded.append({**record, "reason": "legacy_length_change" if "코드길이 5자리로 변경" in note else "not_five_characters"})
            else:
                valid += 1
                groups.setdefault(code, []).append(record)
    duplicates = {code: records for code, records in all_groups.items() if len(records) > 1}
    conflicts = {code: records for code, records in all_groups.items() if len({r["name"] for r in records}) > 1}
    lookup = {}
    for code, records in sorted(groups.items()):
        if code not in conflicts:
            notes = list(dict.fromkeys(r["note"] for r in records if r["note"]))
            lookup[code] = {"name": records[0]["name"], "note": "\n".join(notes)}
    report = {"source": source.name, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "sheet": sheet, "excelRowsRead": len(rows), "dataRowsRead": data_rows,
              "validCodeRows": valid, "uniqueCodes": len(lookup), "duplicateCodes": duplicates,
              "conflictingCodes": conflicts, "malformedRows": malformed, "excludedRows": excluded,
              "leadingZeroCodes": sum(code.startswith("0") for code in lookup)}
    return lookup, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "data/reference/source/buinding code.xlsx")
    parser.add_argument("--output", type=Path, default=ROOT / "data/reference/building_use_codes.json")
    parser.add_argument("--report", type=Path, default=ROOT / "data/reference/building_use_codes.report.json")
    args = parser.parse_args()
    try:
        lookup, report = convert(args.source)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Rows: {report['excelRowsRead']} incl. header / {report['dataRowsRead']} data; valid: {report['validCodeRows']}; unique: {report['uniqueCodes']}; duplicates: {len(report['duplicateCodes'])}; conflicts: {len(report['conflictingCodes'])}; malformed: {len(report['malformedRows'])}; excluded: {len(report['excludedRows'])}; leading zeros: {report['leadingZeroCodes']}")
        if not lookup or report["conflictingCodes"] or report["malformedRows"]:
            raise ValueError("Review the report: conflicting/malformed rows; lookup was not overwritten.")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(lookup, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for code in ("03000", "14000", "02000"):
            if code in lookup:
                print(f"{code}: {lookup[code]['name']}")
    except (ValueError, KeyError, ET.ParseError, zipfile.BadZipFile, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
