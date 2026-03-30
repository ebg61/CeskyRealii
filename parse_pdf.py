#!/usr/bin/env python3
"""Extract quiz questions from NPI PDF into questions.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader

PDF_PATH = Path(__file__).parent / "OBC_databanka_testovychuloh_260105.pdf"
OUT_JSON = Path(__file__).parent / "questions.json"

# Major chapter titles (appear alone or with dots)
MAJOR_PATTERNS = [
    "OBČANSKÝ ZÁKLAD",
    "ZÁKLADNÍ GEOGRAFICKÉ INFORMACE",
    "ZÁKLADNÍ HISTORICKÉ A KULTURNÍ INFORMACE",
]

SKIP_LINE_SUBSTR = (
    "Datum aktualizace",
    "NPI ČR",
    "Národní pedagogický",
    "Vydání desáté",
    "Aktualizováno",
    "© ",
    "Struktura testových",
    "Každá testová úloha",
    "ZÁKLADNÍ INFORMACE",
    "CITACE OBRAZOVÉHO",
    "TESTOVÉ ÚLOHY",
    "DATABANKA",
    "ČESKÝCH REÁLIÍ",
)


def normalize_line(s: str) -> str:
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_subsection_header(line: str) -> bool:
    """e.g. '1. ZVYKY A TRADICE' — short, mostly uppercase title."""
    m = re.match(r"^(\d+)\.\s+(.+)$", line)
    if not m:
        return False
    rest = m.group(2).strip()
    if len(rest) > 120:
        return False
    if "?" in rest:
        return False
    # Mostly uppercase letters (Czech), allow digits and punctuation
    letters = [c for c in rest if c.isalpha()]
    if len(letters) < 4:
        return False
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    return upper_ratio > 0.65


def clean_blocks(text: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = normalize_line(raw)
        if not line:
            continue
        if any(x in line for x in SKIP_LINE_SUBSTR):
            continue
        # drop page-only numbers
        if re.fullmatch(r"\d{1,3}", line):
            continue
        lines.append(line)
    return "\n".join(lines)


def parse_options(chunk: str) -> tuple[list[dict[str, str]], str]:
    """From 'A) ... B) ...' return options and leftover."""
    opts: list[dict[str, str]] = []
    # Find A) B) C) D) starts
    pat = re.compile(r"([A-D])\)\s*", re.I)
    matches = list(pat.finditer(chunk))
    if len(matches) < 4:
        return [], chunk
    for i, m in enumerate(matches[:4]):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(chunk)
        letter = m.group(1).upper()
        text = normalize_line(chunk[start:end])
        opts.append({"letter": letter, "text": text})
    rest_start = matches[4].start() if len(matches) > 4 else len(chunk)
    return opts, chunk[rest_start:]


def split_by_answer_keys(text: str) -> list[tuple[str, dict[int, str]]]:
    """Split full text into (block_before key, answer_dict) pairs."""
    combined: list[tuple[str, dict[int, str]]] = []
    pattern = re.compile(r"SPRÁVNÉ ŘEŠENÍ:\s*([^\n]+)", re.I)
    pos = 0
    for m in pattern.finditer(text):
        block_text = text[pos : m.start()].strip()
        ans_line = m.group(1)
        ans: dict[int, str] = {}
        tail = re.sub(r"(\d+)\s+([A-D])", r"\1\2", ans_line)
        for part in re.split(r"[\s,;]+", tail):
            part = part.strip()
            if not part:
                continue
            mm = re.match(r"^(\d+)([A-D])$", part, re.I)
            if mm:
                ans[int(mm.group(1))] = mm.group(2).upper()
        combined.append((block_text, ans))
        pos = m.end()
    return combined


def parse_questions_in_block(
    block: str, answers: dict[int, str], major: str, subsection: str
) -> list[dict]:
    block = clean_blocks(block)
    if not block:
        return []
    lines = block.split("\n")
    i = 0
    # Skip major chapter line if present
    while i < len(lines):
        L = lines[i]
        if any(mp in L for mp in MAJOR_PATTERNS) and len(L) < 80:
            major = L
            i += 1
            continue
        if is_subsection_header(L):
            subsection = L
            i += 1
            continue
        break

    questions: list[dict] = []
    while i < len(lines):
        L = lines[i]
        m = re.match(r"^(\d+)\.\s+(.*)$", L)
        if not m:
            i += 1
            continue
        qnum = int(m.group(1))
        qrest = m.group(2).strip()
        if is_subsection_header(L):
            subsection = L
            i += 1
            continue
        # accumulate question text until A)
        qtext_parts = [qrest]
        i += 1
        while i < len(lines) and not re.match(r"^[A-D]\)", lines[i]):
            qtext_parts.append(lines[i])
            i += 1
        qtext = normalize_line(" ".join(qtext_parts))
        if i >= len(lines):
            break
        opt_chunk_lines = []
        while i < len(lines):
            opt_chunk_lines.append(lines[i])
            line = lines[i]
            if re.match(r"^[A-D]\)", line) and line.strip().startswith("D)"):
                # might have more after D) on same block — take until next question
                rest = "\n".join(opt_chunk_lines)
                opts, _ = parse_options(rest)
                if len(opts) == 4:
                    i += 1
                    break
            i += 1
            # next question starts
            if i < len(lines) and re.match(r"^\d+\.\s", lines[i]):
                next_line = lines[i]
                if not is_subsection_header(next_line):
                    # check if really new question number
                    nm = re.match(r"^(\d+)\.", next_line)
                    if nm and int(nm.group(1)) == qnum + 1:
                        break
                    if nm and int(nm.group(1)) <= 10 and int(nm.group(1)) != qnum:
                        break
        opt_text = "\n".join(opt_chunk_lines)
        opts, _ = parse_options(opt_text)
        correct = answers.get(qnum)
        entry = {
            "id": f"{major[:12]}-{subsection[:20]}-{qnum}",
            "major": major,
            "category": subsection,
            "number": qnum,
            "question": qtext,
            "options": opts,
            "correct": correct,
        }
        questions.append(entry)
    return questions


def main() -> None:
    reader = PdfReader(str(PDF_PATH))
    raw = "\n".join((p.extract_text() or "") for p in reader.pages)
    text = clean_blocks(raw)
    # Start from first OBČANSKÝ ZÁKLAD in body (skip TOC)
    idx = text.find("OBČANSKÝ ZÁKLAD\n1. ZVYKY")
    if idx == -1:
        idx = text.find("OBČANSKÝ ZÁKLAD")
    if idx != -1:
        text = text[idx:]

    # Cut at CITACE OBRAZOVÉHO (image citations appendix)
    cut = text.find("CITACE OBRAZOVÉHO")
    if cut != -1:
        text = text[:cut]

    pairs = split_by_answer_keys(text)
    all_q: list[dict] = []
    major = "OBČANSKÝ ZÁKLAD"
    subsection = ""

    for block, ans in pairs:
        if not ans:
            continue
        # detect major / subsection at block start
        blines = block.split("\n")[:5]
        for L in blines:
            Ln = normalize_line(L)
            for mp in MAJOR_PATTERNS:
                if mp in Ln and len(Ln) < 90:
                    major = Ln
            if is_subsection_header(Ln):
                subsection = Ln
        parsed = parse_questions_in_block(block, ans, major, subsection)
        for q in parsed:
            if q["category"]:
                subsection = q["category"]
            q["major"] = major
        all_q.extend(parsed)
        # update subsection from last parsed
        if parsed:
            subsection = parsed[-1].get("category", subsection)

    # De-duplicate by (category, number, question[:40])
    seen = set()
    unique: list[dict] = []
    for q in all_q:
        key = (q["category"], q["number"], q["question"][:50])
        if key in seen:
            continue
        seen.add(key)
        unique.append(q)

    # Stable ids
    for i, q in enumerate(unique, 1):
        q["id"] = i

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(
            {
                "title": "Databanka testových úloh z českých reálií",
                "source": "https://cestina-pro-cizince.cz/obcanstvi/wp-content/uploads/2026/01/OBC_databanka_testovychuloh_260105.pdf",
                "count": len(unique),
                "questions": unique,
            },
            f,
            ensure_ascii=False,
            indent=0,
        )

    print("Written", OUT_JSON, "questions:", len(unique))

    js_path = OUT_JSON.with_suffix(".js")
    payload = {
        "title": "Databanka testových úloh z českých reálií",
        "source": "https://cestina-pro-cizince.cz/obcanstvi/wp-content/uploads/2026/01/OBC_databanka_testovychuloh_260105.pdf",
        "count": len(unique),
        "questions": unique,
    }
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.CZ_QUIZ_DATA = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    print("Written", js_path, "(for opening index.html without a server)")


if __name__ == "__main__":
    main()
