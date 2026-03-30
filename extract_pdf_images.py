#!/usr/bin/env python3
"""
Extract embedded images from the official NPI PDF into images/extracted/.

Requires: pip install pypdf pillow
Place the PDF next to this script as OBC_databanka_testovychuloh_260105.pdf (same name as parse_pdf.py).

After extraction, map files to question ids. Questions that refer to "obrázku" need a picture from the PDF.
Edit question_images.json like: { "50": "images/extracted/page-3-0.jpg" }

List question ids that mention obrázku:
  python3 -c "import json;d=json.load(open('questions.json'));print([q['id'] for q in d['questions'] if 'obrázku' in q.get('question','') or 'obrazku' in q.get('question','').lower()])"
"""
from __future__ import annotations

import json
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    raise SystemExit("Install pypdf: pip install pypdf pillow")

PDF_PATH = Path(__file__).parent / "OBC_databanka_testovychuloh_260105.pdf"
OUT_DIR = Path(__file__).parent / "images" / "extracted"


def main() -> None:
    if not PDF_PATH.is_file():
        print("PDF not found:", PDF_PATH)
        print("Download the Jan 2026 databank PDF and save it with that exact filename.")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(PDF_PATH))
    n_saved = 0
    for page_index, page in enumerate(reader.pages):
        try:
            image_list = list(page.images)
        except Exception as e:
            print("Page", page_index + 1, "images error:", e)
            continue
        for i, img in enumerate(image_list):
            ext = "bin"
            name_attr = getattr(img, "name", "") or ""
            if "." in name_attr:
                ext = name_attr.rsplit(".", 1)[-1].lower()[:4]
            if ext not in ("png", "jpg", "jpeg", "webp", "bin"):
                ext = "png"
            name = f"page-{page_index + 1:03d}-{i}.{ext}"
            path = OUT_DIR / name
            try:
                data = getattr(img, "data", None)
                if data is None:
                    continue
                path.write_bytes(data)
                n_saved += 1
                print("Saved", path, f"({len(data)} bytes)")
            except Exception as e:
                print("Skip", page_index, i, e)

    print("Done. Extracted", n_saved, "images into", OUT_DIR)
    print("Then edit question_images.json to point question id -> relative path.")


if __name__ == "__main__":
    main()
