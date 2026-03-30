#!/usr/bin/env python3
"""Build question_images.json by matching question text to PDF pages (first image on that page)."""
from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).parent
PDF_PATH = ROOT / "OBC_databanka_testovychuloh_260105.pdf"
QUESTIONS = ROOT / "questions.json"
OUT = ROOT / "question_images.json"
EXTRACTED = ROOT / "images" / "extracted"


def norm(s: str) -> str:
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def main() -> None:
    if not PDF_PATH.is_file():
        print("PDF not found:", PDF_PATH)
        return
    data = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    reader = PdfReader(str(PDF_PATH))
    page_texts = [norm(p.extract_text() or "") for p in reader.pages]

    mapping: dict[str, str] = {}
    for q in data.get("questions", []):
        qt = norm(q.get("question", ""))
        if "obrázku" not in qt.lower() and "obrazku" not in qt.lower():
            continue
        # Match by distinctive substring (first 50 chars, avoid typos in PDF)
        key = qt[:55] if len(qt) > 55 else qt
        found_page = None
        for pi, text in enumerate(page_texts):
            if key[:40] in text.replace("\n", " ") or qt[:35] in text.replace("\n", " "):
                found_page = pi + 1
                break
        if found_page is None:
            print("No page for id", q["id"], qt[:50])
            continue
        # First image on that page (0-indexed filename)
        pat = f"page-{found_page:03d}-0."
        matches = sorted(EXTRACTED.glob(f"page-{found_page:03d}-0.*"))
        if not matches:
            # try any image on page
            matches = sorted(EXTRACTED.glob(f"page-{found_page:03d}-*"))
        if not matches:
            print("No extracted file for page", found_page, "id", q["id"])
            continue
        rel = str(matches[0].relative_to(ROOT)).replace("\\", "/")
        mapping[str(q["id"])] = rel
        print("id", q["id"], "->", rel, "(PDF page", found_page, ")")

    OUT.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    js_out = ROOT / "question_images.js"
    js_out.write_text(
        "window.CZ_QUESTION_IMAGES = "
        + json.dumps(mapping, ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    print("Wrote", OUT, "and", js_out, len(mapping), "entries")


if __name__ == "__main__":
    main()
