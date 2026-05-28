import base64
import json
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def write_message(message):
    print(json.dumps(message, ensure_ascii=False, separators=(",", ":")), flush=True)


try:
    import cv2
    import numpy as np
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
except Exception as exc:
    write_message({"event": "error", "error": f"{type(exc).__name__}: {exc}"})
    sys.exit(1)


write_message({"event": "ready", "engine": "rapidocr_onnxruntime"})


def normalize_box(box):
    points = []
    for point in box or []:
        try:
            points.append([float(point[0]), float(point[1])])
        except Exception:
            continue
    return points


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        image_bytes = base64.b64decode(request.get("imageBase64") or "")
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("failed to decode image")

        started_at = time.perf_counter()
        result, _ = engine(image)
        duration_ms = (time.perf_counter() - started_at) * 1000

        items = []
        for item in result or []:
            text = str(item[1] or "") if len(item) > 1 else ""
            score = float(item[2]) if len(item) > 2 and item[2] is not None else None
            items.append({
                "box": normalize_box(item[0] if len(item) > 0 else []),
                "text": text,
                "score": score,
            })

        write_message({
            "id": request_id,
            "ok": True,
            "durationMs": duration_ms,
            "items": items,
        })
    except Exception as exc:
        write_message({
            "id": request_id,
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
        })
