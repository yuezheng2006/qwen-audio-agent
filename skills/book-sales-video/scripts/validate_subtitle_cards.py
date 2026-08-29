#!/usr/bin/env python3
"""Validate final bilingual caption cards against their voice timeline."""

from __future__ import annotations

import argparse
import json
import unicodedata
from pathlib import Path
from typing import Any


STATUS_FIELDS = (
    "translationStatus",
    "alignmentStatus",
    "layoutStatus",
    "evidenceStatus",
)
BOX_FIELDS = ("left", "top", "width", "height")
TAIL_RISK_TOKENS = (
    "因为",
    "所以",
    "很",
    "还",
    "只",
    "也",
    "都",
    "就",
    "才",
    "把",
    "被",
    "的",
    "地",
    "得",
    "和",
    "但",
)
REQUIRED_CONTRAST_MODE = "white-black-stroke"


def effective_character_count(text: str) -> int:
    """Count visible semantic characters, excluding punctuation and spaces."""
    return sum(
        1
        for char in text
        if not unicodedata.category(char).startswith(("P", "Z", "C"))
    )


def semantic_tail(text: str) -> str:
    return "".join(
        char
        for char in text.strip()
        if not unicodedata.category(char).startswith(("P", "Z", "C"))
    )


def frame_value(item: dict[str, Any], *names: str) -> int | None:
    for name in names:
        value = item.get(name)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def voice_unit_index(voice_timeline: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not voice_timeline:
        return {}
    units = voice_timeline.get("voiceUnits")
    if not isinstance(units, list):
        return {}
    return {
        str(unit.get("id")): unit
        for unit in units
        if isinstance(unit, dict) and unit.get("id")
    }


def validate_box(
    box: Any,
    label: str,
    canvas: dict[str, Any],
    errors: list[str],
) -> None:
    if not isinstance(box, dict):
        errors.append(f"{label} captionBox must be an object")
        return
    missing = [field for field in BOX_FIELDS if box.get(field) is None]
    if missing:
        errors.append(f"{label} captionBox missing fields: {', '.join(missing)}")
        return
    if not all(
        isinstance(box[field], (int, float)) and not isinstance(box[field], bool)
        for field in BOX_FIELDS
    ):
        errors.append(f"{label} captionBox values must be numbers")
        return
    if box["left"] < 0 or box["top"] < 0 or box["width"] <= 0 or box["height"] <= 0:
        errors.append(f"{label} captionBox must use non-negative position and positive size")
        return
    width = canvas.get("width")
    height = canvas.get("height")
    if isinstance(width, (int, float)) and isinstance(height, (int, float)):
        if box["left"] + box["width"] > width or box["top"] + box["height"] > height:
            errors.append(f"{label} captionBox exceeds canvas")


def validate(
    ledger: dict[str, Any],
    voice_timeline: dict[str, Any] | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    if "pairs" in ledger and "cards" not in ledger:
        errors.append("legacy pairs array found; migrate subtitle-pairs.json to version 3 cards")
        cards: list[Any] = []
    else:
        raw_cards = ledger.get("cards")
        cards = raw_cards if isinstance(raw_cards, list) else []
        if not cards:
            errors.append("cards must be a non-empty list")

    if ledger.get("version") != 3:
        errors.append("version must be 3")
    if strict and ledger.get("status") != "verified":
        errors.append("strict validation requires top-level status=verified")

    revision = ledger.get("stateRevision")
    basis = ledger.get("timelineBasis") or {}
    implementation = ledger.get("implementation") or {}
    canvas = ledger.get("canvas") or {"width": 1080, "height": 1920}

    if not revision:
        errors.append("stateRevision is required")
    for field in ("projectId", "timelineId", "fps", "readAt", "voiceTimelineRevision"):
        if not basis.get(field):
            errors.append(f"timelineBasis.{field} is required")
    if revision and basis.get("voiceTimelineRevision") != revision:
        errors.append("timelineBasis.voiceTimelineRevision must match stateRevision")
    if implementation.get("visibleLayerCount") != 1:
        errors.append("implementation.visibleLayerCount must be 1")

    if voice_timeline:
        if voice_timeline.get("stateRevision") != revision:
            errors.append("voice timeline stateRevision does not match subtitle ledger")
        comparisons = {
            "projectId": voice_timeline.get("projectId"),
            "timelineId": voice_timeline.get("timelineId"),
            "fps": voice_timeline.get("timelineFps"),
        }
        for field, value in comparisons.items():
            if value is not None and basis.get(field) != value:
                errors.append(f"timelineBasis.{field} does not match voice timeline")

    units = voice_unit_index(voice_timeline)
    seen_ids: set[str] = set()
    seen_word_keys: set[str] = set()
    valid_ranges: list[tuple[int, int, str]] = []
    route = str(implementation.get("route") or "")

    for index, card in enumerate(cards):
        label = f"card[{index}]"
        if not isinstance(card, dict):
            errors.append(f"{label} must be an object")
            continue
        card_id = str(card.get("id") or "")
        if not card_id:
            errors.append(f"{label} id is required")
        elif card_id in seen_ids:
            errors.append(f"duplicate card id: {card_id}")
        else:
            seen_ids.add(card_id)
        label = card_id or label

        for field in ("voiceUnitId", "segmentId", "captionLane", "captionSurface", "contrastMode"):
            if not card.get(field):
                errors.append(f"{label} {field} is required")
        if card.get("contrastMode") != REQUIRED_CONTRAST_MODE:
            errors.append(f"{label} contrastMode must be {REQUIRED_CONTRAST_MODE}")

        zh_text = card.get("zhText")
        en_text = card.get("enText")
        if not isinstance(zh_text, str) or not zh_text.strip():
            errors.append(f"{label} zhText is required")
            zh_text = ""
        if not isinstance(en_text, str) or not en_text.strip():
            errors.append(f"{label} enText is required")
            en_text = ""
        if "\n" in zh_text or "\r" in zh_text:
            errors.append(f"{label} Chinese caption must be single-line")
        if "\n" in en_text or "\r" in en_text:
            errors.append(f"{label} English caption must be single-line")

        zh_count = effective_character_count(zh_text)
        if zh_count > 11:
            errors.append(f"{label} Chinese caption has {zh_count} effective characters; maximum is 11")
        if 0 < zh_count <= 2 and not card.get("allowShortCard"):
            errors.append(f"{label} is a 1-2 character card without allowShortCard")
        if card.get("allowShortCard") and not card.get("shortCardReason"):
            errors.append(f"{label} allowShortCard requires shortCardReason")

        tail = semantic_tail(zh_text)
        risky_tail = next((token for token in TAIL_RISK_TOKENS if tail.endswith(token)), None)
        if risky_tail and not card.get("allowTailException"):
            errors.append(f"{label} ends with dependent token: {risky_tail}")
        if card.get("allowTailException") and not card.get("tailExceptionReason"):
            errors.append(f"{label} allowTailException requires tailExceptionReason")

        start = frame_value(card, "startFrame")
        end = frame_value(card, "endFrame")
        if start is None or end is None:
            errors.append(f"{label} startFrame and endFrame must be integers")
        elif start < 0 or end <= start:
            errors.append(f"{label} must use a positive half-open frame range")
        else:
            valid_ranges.append((start, end, label))

        shot_ids = card.get("visualShotIds")
        if not isinstance(shot_ids, list) or not shot_ids:
            errors.append(f"{label} visualShotIds must be a non-empty list")
        elif len(shot_ids) > 1 and not card.get("crossesVisualCutReason"):
            errors.append(f"{label} crosses visual cuts without crossesVisualCutReason")

        validate_box(card.get("captionBox"), label, canvas, errors)

        for field in STATUS_FIELDS:
            value = card.get(field)
            if not value:
                errors.append(f"{label} {field} is required")
            elif strict and value != "verified":
                errors.append(f"{label} {field} must be verified in strict mode")

        if not card.get("alignmentEvidence"):
            errors.append(f"{label} alignmentEvidence is required")
        evidence_frames = card.get("evidenceFrames")
        if strict and (not isinstance(evidence_frames, list) or not evidence_frames):
            errors.append(f"{label} strict mode requires evidenceFrames")
        elif isinstance(evidence_frames, list) and start is not None and end is not None:
            for frame in evidence_frames:
                if not isinstance(frame, int) or isinstance(frame, bool) or not start <= frame < end:
                    errors.append(f"{label} evidence frame {frame!r} is outside the card range")

        word_keys = card.get("sourceWordKeys")
        if word_keys is None:
            word_keys = []
        if not isinstance(word_keys, list) or not all(isinstance(key, str) and key for key in word_keys):
            errors.append(f"{label} sourceWordKeys must be a list of non-empty strings")
            word_keys = []
        if strict and route == "openchatcut-native-bilingual" and not word_keys:
            errors.append(f"{label} native captions require sourceWordKeys in strict mode")
        for key in word_keys:
            if key in seen_word_keys:
                errors.append(f"source word key reused across cards: {key}")
            seen_word_keys.add(key)

        if route == "motion-graphic" and strict and not card.get("motionGraphicItemId"):
            errors.append(f"{label} Motion Graphic route requires motionGraphicItemId")

        voice_id = str(card.get("voiceUnitId") or "")
        if voice_timeline and voice_id not in units:
            errors.append(f"{label} references unknown voiceUnitId: {voice_id}")
        elif voice_id in units and start is not None and end is not None:
            unit = units[voice_id]
            unit_start = frame_value(unit, "startFrame", "timelineStartFrame", "derivedStartFrame")
            unit_end = frame_value(unit, "endFrame", "timelineEndFrame", "derivedEndFrame")
            if unit_start is None or unit_end is None:
                errors.append(f"voice unit {voice_id} lacks derived frame boundaries")
            elif start < unit_start or end > unit_end:
                errors.append(f"{label} extends outside voice unit {voice_id}")

        if start is not None and end is not None:
            duration = end - start
            fps = basis.get("fps")
            if isinstance(fps, (int, float)) and fps > 0:
                seconds = duration / fps
                if seconds < 0.45:
                    warnings.append(f"{label} is shorter than 0.45 seconds; verify readability")
                if seconds > 4.5:
                    warnings.append(f"{label} is longer than 4.5 seconds; verify pacing")

    for previous, current in zip(sorted(valid_ranges), sorted(valid_ranges)[1:]):
        if current[0] < previous[1]:
            errors.append(f"caption overlap: {previous[2]} -> {current[2]}")

    return {
        "status": "pass" if not errors else "fail",
        "cardCount": len(cards),
        "errors": errors,
        "warnings": warnings,
    }


def sample_documents() -> tuple[dict[str, Any], dict[str, Any]]:
    revision = "rev-test-1"
    voice = {
        "version": 1,
        "status": "verified",
        "stateRevision": revision,
        "projectId": "project-test",
        "timelineId": "timeline-test",
        "timelineFps": 60,
        "voiceUnits": [
            {"id": "voice-01", "startFrame": 100, "endFrame": 260},
        ],
    }
    ledger = {
        "version": 3,
        "status": "verified",
        "stateRevision": revision,
        "canvas": {"width": 1080, "height": 1920},
        "timelineBasis": {
            "projectId": "project-test",
            "timelineId": "timeline-test",
            "fps": 30,
            "readAt": "2026-07-17T00:00:00+08:00",
            "voiceTimelineRevision": revision,
        },
        "implementation": {
            "route": "openchatcut-native-bilingual",
            "visibleLayerCount": 1,
        },
        "cards": [
            {
                "id": "caption-001",
                "voiceUnitId": "voice-01",
                "segmentId": "body-01",
                "visualShotIds": ["shot-01"],
                "zhText": "真正的长寿",
                "enText": "What longevity means",
                "sourceWordKeys": ["asset-a:word-1"],
                "startFrame": 100,
                "endFrame": 180,
                "captionLane": "paper-lower",
                "captionSurface": "unpainted-paper",
                "contrastMode": REQUIRED_CONTRAST_MODE,
                "captionBox": {"left": 120, "top": 1250, "width": 800, "height": 240},
                "translationStatus": "verified",
                "alignmentStatus": "verified",
                "layoutStatus": "verified",
                "evidenceStatus": "verified",
                "alignmentEvidence": "read_captions-word-keys",
                "evidenceFrames": [140],
            },
            {
                "id": "caption-002",
                "voiceUnitId": "voice-01",
                "segmentId": "body-01",
                "visualShotIds": ["shot-01"],
                "zhText": "是保留行动能力",
                "enText": "is keeping your agency",
                "sourceWordKeys": ["asset-a:word-2"],
                "startFrame": 180,
                "endFrame": 260,
                "captionLane": "paper-lower",
                "captionSurface": "unpainted-paper",
                "contrastMode": REQUIRED_CONTRAST_MODE,
                "captionBox": {"left": 120, "top": 1250, "width": 800, "height": 240},
                "translationStatus": "verified",
                "alignmentStatus": "verified",
                "layoutStatus": "verified",
                "evidenceStatus": "verified",
                "alignmentEvidence": "read_captions-word-keys",
                "evidenceFrames": [220],
            },
        ],
    }
    return ledger, voice


def run_self_test() -> int:
    ledger, voice = sample_documents()
    passing = validate(ledger, voice, strict=True)
    failing_ledger = json.loads(json.dumps(ledger))
    failing_ledger["cards"][0]["zhText"] = "这句话明显超过十一字而且还"
    failing_ledger["cards"][0]["endFrame"] = 210
    failing_ledger["cards"][1]["startFrame"] = 200
    failing_ledger["cards"][1]["sourceWordKeys"] = []
    failing = validate(failing_ledger, voice, strict=True)
    ok = passing["status"] == "pass" and failing["status"] == "fail"
    print(json.dumps({"status": "pass" if ok else "fail", "passingCase": passing, "failingCase": failing}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path)
    parser.add_argument("--voice-timeline", type=Path)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()
    if args.path is None:
        parser.error("path is required unless --self-test is used")

    try:
        ledger = load_json(args.path)
        voice = load_json(args.voice_timeline) if args.voice_timeline else None
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "fail", "errors": [str(exc)], "warnings": []}, ensure_ascii=False, indent=2))
        return 2

    result = validate(ledger, voice, strict=args.strict)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
