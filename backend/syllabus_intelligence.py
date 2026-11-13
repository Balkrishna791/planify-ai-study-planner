"""Safe, structured extraction helpers for Planify Syllabus Intelligence.

This module deliberately does not create plans or persist uploaded files.  It
turns a validated upload into a small, reviewable structure; app.py owns the
database and the existing planner remains the only scheduling engine.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import warnings
from typing import Any


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PYQ_FILES = 5
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES * MAX_PYQ_FILES
MAX_IMAGE_PIXELS = 20_000_000
MAX_AI_TEXT_CHARS = 60_000
ALLOWED_EXTENSIONS = {"pdf", "txt", "md", "csv", "png", "jpg", "jpeg", "webp"}


class IntelligenceError(ValueError):
    """A safe, user-facing Syllabus Intelligence failure."""


def normalized(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())


def clean_label(value: Any, label: str, maximum: int = 300) -> str:
    cleaned = " ".join(str(value or "").split())
    if not 2 <= len(cleaned) <= maximum:
        raise IntelligenceError(f"{label} must contain 2 to {maximum} characters")
    return cleaned


def read_upload(file_storage) -> dict[str, Any]:
    """Validate and read an upload in memory. Nothing is written to disk."""
    filename = (getattr(file_storage, "filename", "") or "").strip()
    if not filename or "." not in filename:
        raise IntelligenceError("Choose a PDF, text, or image file")
    extension = filename.rsplit(".", 1)[1].casefold()
    if extension not in ALLOWED_EXTENSIONS:
        raise IntelligenceError("Supported files are PDF, TXT, MD, CSV, PNG, JPG, JPEG, and WEBP")

    raw = file_storage.read()
    if not raw:
        raise IntelligenceError("The uploaded file is empty")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise IntelligenceError("Each upload must be 10 MB or smaller")

    document = {
        "filename": filename,
        "extension": extension,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "kind": "text",
        "content": None,
    }

    if extension in {"txt", "md", "csv"}:
        text = raw.decode("utf-8", errors="replace").strip()
        if len(text) < 20:
            raise IntelligenceError("The text file does not contain enough readable syllabus or PYQ content")
        document["content"] = text[:MAX_AI_TEXT_CHARS]
        return document

    if extension == "pdf":
        try:
            from pypdf import PdfReader
        except ImportError as error:
            raise IntelligenceError("PDF analysis is temporarily unavailable on this server") from error
        try:
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        except Exception as error:
            raise IntelligenceError("This PDF could not be read. Upload a valid, unlocked PDF or a clear image") from error
        if len(text) < 20:
            raise IntelligenceError("This looks like a scanned or unreadable PDF. Upload clear page images instead")
        document["content"] = text[:MAX_AI_TEXT_CHARS]
        return document

    try:
        from PIL import Image
        # File size alone is not enough: a small compressed image can expand
        # into hundreds of MB. Check dimensions before decoding pixels.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as probe:
                probe.verify()
            with Image.open(io.BytesIO(raw)) as source:
                width, height = source.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise IntelligenceError("This image is too large. Upload a clear image up to 20 megapixels")
                source.load()
                image = source.convert("RGB")
    except ImportError as error:
        raise IntelligenceError("Image analysis is temporarily unavailable on this server") from error
    except Exception as error:
        raise IntelligenceError("This image could not be read. Upload a clear PNG, JPG, JPEG, or WEBP") from error
    document["kind"] = "image"
    document["content"] = image
    return document


def response_json(response_text: str) -> dict[str, Any]:
    text = (response_text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise IntelligenceError("AI returned an unreadable analysis. Please retry")
    try:
        result = json.loads(text[start:end + 1])
    except json.JSONDecodeError as error:
        raise IntelligenceError("AI returned malformed analysis. Please retry") from error
    if not isinstance(result, dict):
        raise IntelligenceError("AI returned an invalid analysis")
    return result


def run_ai_analysis(genai, prompt: str, document: dict[str, Any]) -> dict[str, Any]:
    """Try stable Gemini models and return only a parsed JSON object."""
    last_error = None
    for model_name in ("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"):
        try:
            model = genai.GenerativeModel(model_name)
            parts = [prompt, document["content"]] if document["kind"] == "image" else f"{prompt}\n\nDOCUMENT TEXT:\n{document['content']}"
            response = model.generate_content(parts, request_options={"timeout": 30})
            return response_json(getattr(response, "text", ""))
        except Exception as error:  # Model availability and quota are external failures.
            last_error = error
            continue
    raise IntelligenceError("AI analysis is unavailable right now. Your existing planner can still be used normally") from last_error


def canonical_syllabus(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept only explicitly extracted syllabus data; never fill in missing facts."""
    source_subjects = payload.get("subjects")
    if not isinstance(source_subjects, list) or not source_subjects:
        raise IntelligenceError("No subjects could be extracted. Upload the complete, readable syllabus and retry")

    subjects, seen_subjects = [], set()
    for raw_subject in source_subjects[:50]:
        if not isinstance(raw_subject, dict):
            continue
        try:
            subject_name = clean_label(raw_subject.get("name"), "Extracted subject")
        except IntelligenceError:
            continue
        subject_key = normalized(subject_name)
        if subject_key in seen_subjects:
            continue
        seen_subjects.add(subject_key)
        units, seen_topics = [], set()
        for unit_index, raw_unit in enumerate(raw_subject.get("units", [])[:100], start=1):
            if not isinstance(raw_unit, dict):
                continue
            unit_name = " ".join(str(raw_unit.get("name") or f"Unit {unit_index}").split())[:300]
            chapters = []
            raw_chapters = raw_unit.get("chapters", [])
            if not isinstance(raw_chapters, list):
                raw_chapters = []
            for chapter_index, raw_chapter in enumerate(raw_chapters[:100], start=1):
                if not isinstance(raw_chapter, dict):
                    continue
                chapter_name = " ".join(str(raw_chapter.get("name") or f"Topic group {chapter_index}").split())[:300]
                topics = []
                for raw_topic in raw_chapter.get("topics", [])[:300]:
                    try:
                        topic_name = clean_label(raw_topic, "Extracted topic")
                    except IntelligenceError:
                        continue
                    topic_key = normalized(topic_name)
                    if topic_key not in seen_topics:
                        seen_topics.add(topic_key)
                        topics.append(topic_name)
                if topics:
                    chapters.append({"name": chapter_name, "topics": topics})
            if chapters:
                units.append({"name": unit_name, "chapters": chapters})
        if units:
            subjects.append({"name": subject_name, "units": units})

    if not subjects:
        raise IntelligenceError("No usable syllabus topics could be extracted. Please review a clearer source")
    uncertainties = payload.get("uncertainties", [])
    if not isinstance(uncertainties, list):
        uncertainties = []
    return {"subjects": subjects, "uncertainties": [str(item)[:300] for item in uncertainties[:20]]}


def flatten_syllabus(structure: dict[str, Any]) -> list[dict[str, str]]:
    rows = []
    for subject in structure.get("subjects", []):
        for unit in subject.get("units", []):
            for chapter in unit.get("chapters", []):
                for topic in chapter.get("topics", []):
                    rows.append({
                        "subject": subject["name"], "unit": unit["name"],
                        "chapter": chapter["name"], "topic": topic,
                    })
    return rows


def syllabus_prompt() -> str:
    return """Extract ONLY information explicitly visible in this complete academic syllabus. Do not infer or add common curriculum topics. Return STRICT JSON only:
{"subjects":[{"name":"exact subject name","units":[{"name":"exact unit name","chapters":[{"name":"exact chapter name","topics":["exact topic"]}]}]}],"uncertainties":["short note only when source is unclear"]}
Rules: preserve the source's subject/unit/chapter names where present; use a neutral grouping name only when the source has a list of topics without a chapter label; omit unreadable text; no markdown."""


def pyq_prompt(catalog: list[dict[str, str]]) -> str:
    return f"""Analyze this previous-year question paper. Map questions semantically ONLY to the confirmed syllabus catalog below. Do not invent marks, frequencies, subjects, units, chapters, or topics. A frequency is the number of actual questions in THIS uploaded paper that map to the topic. Return STRICT JSON only:
{{"mappings":[{{"subject":"exact catalog subject","topic":"exact catalog topic","frequency":1,"importance":"low|medium|high","marks":null,"evidence":["short question/concept excerpt"]}}],"unmappedQuestionCount":0,"uncertainties":["short note"]}}
If no reliable match exists, return an empty mappings array. Catalog:\n{json.dumps(catalog[:500], ensure_ascii=False)}"""


def canonical_pyq(payload: dict[str, Any], catalog: list[dict[str, str]]) -> dict[str, Any]:
    by_pair = {(normalized(row["subject"]), normalized(row["topic"])): row for row in catalog}
    mappings, seen = [], set()
    raw_mappings = payload.get("mappings", [])
    if not isinstance(raw_mappings, list):
        raise IntelligenceError("AI returned an invalid PYQ analysis")
    for item in raw_mappings[:500]:
        if not isinstance(item, dict):
            continue
        key = (normalized(item.get("subject")), normalized(item.get("topic")))
        matched = by_pair.get(key)
        if not matched:
            continue
        try:
            frequency = int(item.get("frequency", 0))
        except (TypeError, ValueError):
            continue
        if not 1 <= frequency <= 500:
            continue
        importance = str(item.get("importance", "low")).casefold()
        if importance not in {"low", "medium", "high"}:
            importance = "low"
        evidence = item.get("evidence", [])
        if not isinstance(evidence, list):
            evidence = []
        evidence = [" ".join(str(value).split())[:300] for value in evidence[:5] if str(value).strip()]
        if key in seen:
            continue
        seen.add(key)
        marks = item.get("marks")
        if not isinstance(marks, (int, float)) or marks < 0 or marks > 1000:
            marks = None
        mappings.append({**matched, "frequency": frequency, "importance": importance, "marks": marks, "evidence": evidence})
    return {
        "mappings": mappings,
        "unmappedQuestionCount": max(0, int(payload.get("unmappedQuestionCount", 0) or 0)),
        "uncertainties": [str(value)[:300] for value in payload.get("uncertainties", [])[:20]] if isinstance(payload.get("uncertainties", []), list) else [],
    }
