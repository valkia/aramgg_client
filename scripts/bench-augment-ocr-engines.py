# -*- coding: utf-8 -*-
"""Benchmark OCR engines on saved ARAM augment title screenshots.

This script is intentionally diagnostic-only. It uses the same three fixed title
regions as src/main/image-analyzer.js, then compares saved Tesseract log output
with RapidOCR results for a small set of real partial screenshots.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from pathlib import Path

import cv2
import numpy as np


APPDATA = Path.home() / "AppData" / "Roaming" / "aramgg_client"
SAMPLE_DIR = APPDATA / "ocr-partial-screenshots"

SAMPLES = [
    {
        "file": "partial-ocr-2026-05-28T22-53-06-914+0800-count2-analysis1046.png",
        "expected": ["魔鬼之舞", "升级：雪球", "无休回复"],
        "tesseract": ["台所之舞", "升级: 雪球", "无体回复"],
    },
    {
        "file": "partial-ocr-2026-05-28T22-41-32-482+0800-count2-analysis40.png",
        "expected": ["物法皆修", "战争交响乐", "扳机炼狱"],
        "tesseract": ["物法江", "战争交响乐", "扳机炼狱"],
    },
    {
        "file": "partial-ocr-2026-05-28T22-41-21-507+0800-count2-analysis30.png",
        "expected": ["物法皆修", "战争交响乐", "扳机炼狱"],
        "tesseract": ["物法江", "战争交响乐", "扳机炼狱"],
    },
    {
        "file": "partial-ocr-2026-05-28T22-41-10-582+0800-count2-analysis21.png",
        "expected": ["物法皆修", "你摸不到", "扳机炼狱"],
        "tesseract": ["物法江", "你摸不到", "扳机炼狱"],
    },
    {
        "file": "partial-ocr-2026-05-28T21-03-50-492+0800-count1-analysis19.png",
        "expected": ["大地苏醒", "巨像的勇气", "舞会女王"],
        "tesseract": ["大昌闪本", "0", "振会女王"],
    },
    {
        "file": "partial-ocr-2026-05-28T21-16-31-402+0800-count2-analysis1015.png",
        "expected": ["面包和奶酪", "罪恶快感", "质变：棱彩阶"],
        "tesseract": ["面包和奶栈", "", "质变: 棱彩阶"],
    },
    {
        "file": "partial-ocr-2026-05-28T21-54-04-657+0800-count2-analysis423.png",
        "expected": ["大力", "纯粹主义者 - 术师", "升级：收集者"],
        "tesseract": ["1", "纯粹主义者 - 术师 f全", "升级: 收集者"],
    },
    {
        "file": "partial-ocr-2026-05-28T21-58-41-444+0800-count2-analysis828.png",
        "expected": ["坚韧", "咏叹奏鸣", "闪电打击"],
        "tesseract": ["坚志", "咏叹奏鸭", "闪电打击"],
    },
    {
        "file": "partial-ocr-2026-05-28T22-01-39-231+0800-count2-analysis1087.png",
        "expected": ["至高天诺言", "连拨击锤", "砍伤"],
        "tesseract": ["至高天诺言", "连氢击钵", "砍伤 GE EC"],
    },
    {
        "file": "partial-ocr-2026-05-28T22-50-06-278+0800-count1-analysis789.png",
        "expected": ["魄罗爆破手", "心灵净化", "闪电打击"],
        "tesseract": ["zjama", "他全间作", "闪电打击"],
    },
]

PUNCTUATION_RE = re.compile(r"""[\s"'“”‘’`.,，。:：;；!！?？、|｜/\\()[\]{}<>《》【】「」『』\-－_=+~·•]""")


def normalize_text(value: str) -> str:
    return PUNCTUATION_RE.sub("", str(value or ""))


def edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        for j, right_char in enumerate(right, start=1):
            cost = 0 if left_char == right_char else 1
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost,
            ))
        previous = current
    return previous[-1]


def is_match(text: str, expected: str) -> bool:
    normalized = normalize_text(text)
    target = normalize_text(expected)
    if not normalized or not target:
        return False
    if target in normalized:
        return True
    if len(target) <= 2 or len(normalized) < len(target):
        return False

    max_distance = 1 if len(target) == 3 else len(target) // 3
    for start in range(0, len(normalized) - len(target) + 1):
        window = normalized[start:start + len(target)]
        if edit_distance(window, target) <= max_distance:
            return True

    return False


def title_region(width: int, height: int, slot: int, wide: bool = False) -> tuple[int, int, int, int]:
    card_width = width * 0.168
    card_gap = width * 0.0175
    group_width = card_width * 3 + card_gap * 2
    group_left = (width - group_width) / 2

    if wide:
        left = group_left + slot * (card_width + card_gap) + card_width * 0.02
        top = height * 0.35
        region_width = card_width * 0.96
        region_height = height * 0.095
    else:
        left = group_left + slot * (card_width + card_gap) + card_width * 0.08
        top = height * 0.37
        region_width = card_width * 0.84
        region_height = height * 0.07

    x = max(0, min(width - 1, round(left)))
    y = max(0, min(height - 1, round(top)))
    x2 = max(x + 1, min(width, round(left + region_width)))
    y2 = max(y + 1, min(height, round(top + region_height)))
    return x, y, x2, y2


def sharpen(image: np.ndarray) -> np.ndarray:
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    return cv2.filter2D(image, -1, kernel)


def make_variants(image: np.ndarray, slot: int) -> dict[str, np.ndarray]:
    height, width = image.shape[:2]
    x1, y1, x2, y2 = title_region(width, height, slot, wide=False)
    wx1, wy1, wx2, wy2 = title_region(width, height, slot, wide=True)
    crop = image[y1:y2, x1:x2]
    wide_crop = image[wy1:wy2, wx1:wx2]

    raw3 = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    wide3 = cv2.resize(wide_crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(raw3, cv2.COLOR_BGR2GRAY)
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    gray = sharpen(gray)
    gray = np.clip(gray.astype(np.float32) * 1.9 - 120, 0, 255).astype(np.uint8)
    _, bw = cv2.threshold(gray, 170, 255, cv2.THRESH_BINARY)
    bw = 255 - bw
    bw3 = cv2.cvtColor(bw, cv2.COLOR_GRAY2BGR)

    return {
        "raw3": raw3,
        "wide3": wide3,
        "bw3": bw3,
    }


def make_wide_stack(image: np.ndarray) -> tuple[np.ndarray, list[tuple[int, int]]]:
    rows = []
    for slot in range(3):
        height, width = image.shape[:2]
        x1, y1, x2, y2 = title_region(width, height, slot, wide=True)
        crop = image[y1:y2, x1:x2]
        rows.append(cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC))

    gap = 28
    stack_width = max(row.shape[1] for row in rows)
    stack_height = sum(row.shape[0] for row in rows) + gap * (len(rows) - 1)
    stack = np.full((stack_height, stack_width, 3), 255, dtype=np.uint8)
    row_bounds = []

    top = 0
    for row in rows:
        left = (stack_width - row.shape[1]) // 2
        stack[top:top + row.shape[0], left:left + row.shape[1]] = row
        row_bounds.append((top, top + row.shape[0]))
        top += row.shape[0] + gap

    return stack, row_bounds


def rapidocr_text(engine, image: np.ndarray) -> str:
    result, _ = engine(image)
    if not result:
        return ""
    return " ".join(str(item[1] or "").strip() for item in result if len(item) > 1).strip()


def rapidocr_stack_texts(engine, image: np.ndarray) -> tuple[list[str], float]:
    stack, row_bounds = make_wide_stack(image)
    started = time.perf_counter()
    result, _ = engine(stack)
    duration_ms = (time.perf_counter() - started) * 1000
    texts = [[] for _ in row_bounds]

    for item in result or []:
        if len(item) < 2:
            continue
        box, text = item[0], str(item[1] or "").strip()
        if not text:
            continue
        y_values = [point[1] for point in box]
        center_y = sum(y_values) / len(y_values)
        for index, (top, bottom) in enumerate(row_bounds):
            if top <= center_y <= bottom:
                texts[index].append(text)
                break

    return [" ".join(slot_texts).strip() for slot_texts in texts], duration_ms


def score_engine(records: list[dict], engine_name: str) -> dict:
    engine_records = [record for record in records if record["engine"] == engine_name]
    correct = sum(1 for record in engine_records if record["ok"])
    total = len(engine_records)
    durations = [record["durationMs"] for record in engine_records if record["durationMs"] is not None]
    return {
        "engine": engine_name,
        "correct": correct,
        "total": total,
        "accuracy": correct / total if total else 0,
        "avgMs": statistics.mean(durations) if durations else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-dir", default=str(SAMPLE_DIR))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    sample_dir = Path(args.sample_dir)
    samples = [sample for sample in SAMPLES if (sample_dir / sample["file"]).exists()]
    if not samples:
        raise SystemExit(f"No sample screenshots found under {sample_dir}")

    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    records: list[dict] = []

    for sample in samples:
        image = cv2.imread(str(sample_dir / sample["file"]), cv2.IMREAD_COLOR)
        if image is None:
            continue

        stack_texts, stack_duration_ms = rapidocr_stack_texts(engine, image)

        for slot, expected in enumerate(sample["expected"]):
            tesseract_text = sample["tesseract"][slot] if slot < len(sample["tesseract"]) else ""
            records.append({
                "file": sample["file"],
                "slot": slot,
                "expected": expected,
                "engine": "tesseract-log",
                "text": tesseract_text,
                "ok": is_match(tesseract_text, expected),
                "durationMs": None,
            })
            stack_text = stack_texts[slot] if slot < len(stack_texts) else ""
            records.append({
                "file": sample["file"],
                "slot": slot,
                "expected": expected,
                "engine": "rapidocr-stack-wide3",
                "text": stack_text,
                "ok": is_match(stack_text, expected),
                "durationMs": round(stack_duration_ms / 3, 1),
            })

            for variant_name, variant_image in make_variants(image, slot).items():
                started = time.perf_counter()
                text = rapidocr_text(engine, variant_image)
                duration_ms = (time.perf_counter() - started) * 1000
                records.append({
                    "file": sample["file"],
                    "slot": slot,
                    "expected": expected,
                    "engine": f"rapidocr-{variant_name}",
                    "text": text,
                    "ok": is_match(text, expected),
                    "durationMs": round(duration_ms, 1),
                })

    engines = sorted({record["engine"] for record in records})
    summary = [score_engine(records, engine_name) for engine_name in engines]
    summary.sort(key=lambda item: (-item["accuracy"], item["avgMs"] or 999999))

    if args.json:
        print(json.dumps({"summary": summary, "records": records}, ensure_ascii=False, indent=2))
        return

    print("Summary")
    for item in summary:
        avg = "-" if item["avgMs"] is None else f"{item['avgMs']:.1f}ms"
        print(f"{item['engine']:<20} {item['correct']:>2}/{item['total']:<2} {item['accuracy'] * 100:>5.1f}% avg={avg}")

    print("\nMisses")
    for record in records:
        if record["ok"]:
            continue
        print(
            f"{record['engine']:<20} slot={record['slot']} "
            f"expected={record['expected']} text={record['text']!r} file={record['file']}"
        )


if __name__ == "__main__":
    main()
