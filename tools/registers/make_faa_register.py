#!/usr/bin/env python3
"""Make InFlight's offline copy of the FAA aircraft register (United States N-numbers).

    python tools/registers/make_faa_register.py <folder with MASTER.txt and ACFTREF.txt> [out.json]

Source: the FAA Releasable Aircraft Database, https://registry.faa.gov/database/ReleasableAircraft.zip, a work of the
US Government (public domain). Kept: the N-number, the aircraft's maker and model, and the registered operator ONLY when
the registrant is a corporation or a government (registrant types 3, 5 and 8). Individuals, partnerships, co-owners and
LLCs are never copied: no person's name or address goes into InFlight.
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

OPERATOR_TYPES = {"3", "5", "8"}  # corporation, government, non-citizen corporation


def rows(path: Path):
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
        reader = csv.reader(handle)
        header = [name.strip() for name in next(reader)]
        for row in reader:
            yield {header[i]: value.strip() for i, value in enumerate(row) if i < len(header)}


def tidy(text: str) -> str:
    return " ".join(text.split())


def main() -> int:
    folder = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / "src/assets/registers/faa.json"
    models = {row["CODE"]: tidy(f"{row['MFR']} {row['MODEL']}") for row in rows(folder / "ACFTREF.txt")}
    types: list[str] = []
    type_index: dict[str, int] = {}
    operators: list[str] = []
    operator_index: dict[str, int] = {}
    lines = []
    for row in rows(folder / "MASTER.txt"):
        number = row["N-NUMBER"].upper()
        model = models.get(row["MFR MDL CODE"])
        if not number or not model:
            continue
        if model not in type_index:
            type_index[model] = len(types)
            types.append(model)
        line = f"{number},{type_index[model]:x}"
        if row["TYPE REGISTRANT"] in OPERATOR_TYPES and row["NAME"]:
            name = tidy(row["NAME"])
            if name not in operator_index:
                operator_index[name] = len(operators)
                operators.append(name)
            line += f",{operator_index[name]:x}"
        lines.append(line)
    lines.sort()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "source": "FAA Releasable Aircraft Database (MASTER, ACFTREF)",
        "licence": "Public domain (work of the United States Government)",
        "extracted": datetime.fromtimestamp((folder / "MASTER.txt").stat().st_mtime, timezone.utc).date().isoformat(),
        "keys": "N-number without the leading N, then the type and operator as hexadecimal indexes",
        "note": "Operator kept only for corporations and governments; no individual's name or address.",
        "types": types,
        "operators": operators,
        "entries": "\n".join(lines),
    }, separators=(",", ":")), encoding="utf-8")
    print(f"{len(lines)} N-numbers, {len(types)} types, {len(operators)} operators -> {out} ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
