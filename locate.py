import base64
import json
import sys

import cv2
import numpy as np


def decode_data_url(value: str):
    if not value.startswith("data:image/"):
        raise ValueError("定位器只接受图片 data URL")
    _, encoded = value.split(",", 1)
    raw = base64.b64decode(encoded)
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError("无法解析图片")
    return image


def locate(image):
    height, width = image.shape[:2]
    if image.shape[2] == 4:
        mask = image[:, :, 3] > 8
    else:
        bgr = image[:, :, :3]
        # White or near-white background is common for sticker storyboard frames.
        distance = 255 - np.min(bgr, axis=2)
        mask = distance > 18
    mask = (mask.astype(np.uint8) * 255)
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"found": False, "width": width, "height": height}
    contour = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(contour)
    return {
        "found": True,
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "centerX": round((x + w / 2) / width, 5),
        "centerY": round((y + h / 2) / height, 5),
        "footY": round((y + h) / height, 5),
        "areaRatio": round(float(w * h) / (width * height), 5),
        "canvasWidth": width,
        "canvasHeight": height,
    }


def main():
    payload = json.loads(sys.stdin.read())
    frames = payload.get("frames", [])
    results = [locate(decode_data_url(frame)) for frame in frames]
    found = [item for item in results if item.get("found")]
    if found:
        target_center = round(sum(item["centerX"] for item in found) / len(found), 5)
        target_foot = round(sum(item["footY"] for item in found) / len(found), 5)
        for item in results:
            if item.get("found"):
                item["centerShift"] = round(target_center - item["centerX"], 5)
                item["footShift"] = round(target_foot - item["footY"], 5)
        summary = {"targetCenterX": target_center, "targetFootY": target_foot}
    else:
        summary = {"targetCenterX": None, "targetFootY": None}
    print(json.dumps({"frames": results, "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
