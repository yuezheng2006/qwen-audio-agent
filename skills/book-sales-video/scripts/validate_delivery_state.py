#!/usr/bin/env python3
"""Validate that task state files describe one current, reviewable OpenChatCut cut."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from validate_subtitle_cards import validate as validate_subtitle_cards


REQUIRED_FILES = {
    "timeline": "timeline-plan.json",
    "voice": "voice-timeline.json",
    "subtitles": "subtitle-pairs.json",
    "quality": "quality_check.json",
    "manifest": "asset-manifest.json",
}
READY_STATUSES = {"pass", "verified", "ready-for-review", "passed-for-editor-review"}
REQUIRED_SUPPORT_FILES = ("review_report.md",)
REQUIRED_QUALITY_CHECKS = {
    "bookFacts",
    "voiceContinuity",
    "timelineStructure",
    "carouselRhythm",
    "bookReveal",
    "bodyMotion",
    "transitions",
    "subtitles",
    "bgmMix",
    "visualStyle",
    "frameReview",
}


def nested(data: dict[str, Any], *paths: tuple[str, ...]) -> Any:
    for path in paths:
        value: Any = data
        for key in path:
            if not isinstance(value, dict) or key not in value:
                value = None
                break
            value = value[key]
        if value is not None:
            return value
    return None


def ready_status(value: Any) -> bool:
    normalized = str(value or "").strip().lower()
    return normalized in READY_STATUSES or (
        "verified" in normalized and not any(token in normalized for token in ("not", "blocked", "stale"))
    )


def validate_documents(documents: dict[str, dict[str, Any]]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    revisions = {name: data.get("stateRevision") for name, data in documents.items()}
    missing_revisions = [name for name, value in revisions.items() if not value]
    if missing_revisions:
        errors.append(f"missing stateRevision: {', '.join(sorted(missing_revisions))}")
    unique_revisions = {value for value in revisions.values() if value}
    if len(unique_revisions) > 1:
        errors.append(f"stateRevision mismatch: {revisions}")
    revision = next(iter(unique_revisions), None)

    timeline = documents["timeline"]
    voice = documents["voice"]
    subtitles = documents["subtitles"]
    quality = documents["quality"]
    manifest = documents["manifest"]

    values = {
        "timeline": {
            "projectId": timeline.get("projectId"),
            "timelineId": timeline.get("timelineId"),
            "fps": nested(timeline, ("timelineFps",), ("fps",)),
        },
        "voice": {
            "projectId": voice.get("projectId"),
            "timelineId": voice.get("timelineId"),
            "fps": voice.get("timelineFps"),
        },
        "subtitles": {
            "projectId": nested(subtitles, ("timelineBasis", "projectId")),
            "timelineId": nested(subtitles, ("timelineBasis", "timelineId")),
            "fps": nested(subtitles, ("timelineBasis", "fps")),
        },
        "quality": {
            "projectId": nested(quality, ("timelineBasis", "projectId"), ("projectId",)),
            "timelineId": nested(quality, ("timelineBasis", "timelineId"), ("timelineId",)),
            "fps": nested(quality, ("timelineBasis", "fps"), ("timelineFps",), ("fps",)),
        },
        "manifest": {
            "projectId": nested(manifest, ("openchatcut", "projectId"), ("projectId",)),
            "timelineId": nested(manifest, ("openchatcut", "timelineId"), ("timelineId",)),
            "fps": nested(manifest, ("openchatcut", "canvas", "fps"), ("timelineFps",)),
        },
    }
    for field in ("projectId", "timelineId", "fps"):
        field_values = {name: data.get(field) for name, data in values.items()}
        missing = [name for name, value in field_values.items() if value in (None, "")]
        if missing:
            errors.append(f"missing {field}: {', '.join(sorted(missing))}")
        unique = {value for value in field_values.values() if value not in (None, "")}
        if len(unique) > 1:
            errors.append(f"{field} mismatch: {field_values}")

    subtitle_result = validate_subtitle_cards(subtitles, voice, strict=True)
    if subtitle_result["status"] != "pass":
        errors.append("subtitle ledger failed strict validation")
        errors.extend(f"subtitle: {item}" for item in subtitle_result["errors"])
    warnings.extend(f"subtitle: {item}" for item in subtitle_result["warnings"])

    for name, data in (("timeline", timeline), ("voice", voice), ("subtitles", subtitles)):
        if not ready_status(data.get("status")):
            errors.append(f"{name} status is not verified: {data.get('status')!r}")

    if not ready_status(quality.get("status")):
        errors.append(f"quality status is not reviewable: {quality.get('status')!r}")
    checks = quality.get("checks")
    if not isinstance(checks, dict) or not checks:
        errors.append("quality checks must be a non-empty object")
    else:
        missing_checks = sorted(REQUIRED_QUALITY_CHECKS - set(checks))
        if missing_checks:
            errors.append(f"missing required quality checks: {', '.join(missing_checks)}")
        for check_name, check in checks.items():
            if not isinstance(check, dict):
                errors.append(f"quality check {check_name} must be an object")
                continue
            if check.get("status") != "pass":
                errors.append(f"quality check {check_name} is not pass")
            if revision and check.get("evidenceRevision") != revision:
                errors.append(f"quality check {check_name} uses stale evidenceRevision")

    if not ready_status(manifest.get("status")):
        errors.append(f"asset manifest status is not reviewable: {manifest.get('status')!r}")

    return {
        "status": "pass" if not errors else "fail",
        "stateRevision": revision,
        "errors": errors,
        "warnings": warnings,
    }


def passing_documents() -> dict[str, dict[str, Any]]:
    revision = "rev-test-1"
    project_id = "project-test"
    timeline_id = "timeline-test"
    fps = 30
    card = {
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
        "contrastMode": "white-black-stroke",
        "captionBox": {"left": 120, "top": 1250, "width": 800, "height": 240},
        "translationStatus": "verified",
        "alignmentStatus": "verified",
        "layoutStatus": "verified",
        "evidenceStatus": "verified",
        "alignmentEvidence": "read_captions-word-keys",
        "evidenceFrames": [140],
    }
    return {
        "timeline": {
            "status": "verified", "stateRevision": revision, "projectId": project_id,
            "timelineId": timeline_id, "fps": fps,
        },
        "voice": {
            "version": 1, "status": "verified", "stateRevision": revision,
            "projectId": project_id, "timelineId": timeline_id, "timelineFps": fps,
            "voiceUnits": [{"id": "voice-01", "startFrame": 100, "endFrame": 180}],
        },
        "subtitles": {
            "version": 3, "status": "verified", "stateRevision": revision,
            "canvas": {"width": 1080, "height": 1920},
            "timelineBasis": {
                "projectId": project_id, "timelineId": timeline_id, "fps": fps,
                "readAt": "2026-07-17T00:00:00+08:00", "voiceTimelineRevision": revision,
            },
            "implementation": {"route": "openchatcut-native-bilingual", "visibleLayerCount": 1},
            "cards": [card],
        },
        "quality": {
            "status": "ready-for-review", "stateRevision": revision,
            "timelineBasis": {"projectId": project_id, "timelineId": timeline_id, "fps": fps},
            "checks": {
                name: {"status": "pass", "evidenceRevision": revision}
                for name in REQUIRED_QUALITY_CHECKS
            },
        },
        "manifest": {
            "status": "verified", "stateRevision": revision,
            "openchatcut": {"projectId": project_id, "timelineId": timeline_id, "canvas": {"fps": fps}},
        },
    }


def run_self_test() -> int:
    passing = passing_documents()
    passing_result = validate_documents(passing)
    failing = json.loads(json.dumps(passing))
    failing["quality"]["status"] = "blocked-not-deliverable"
    failing["quality"]["checks"]["subtitles"]["evidenceRevision"] = "rev-old"
    failing["manifest"]["stateRevision"] = "rev-old"
    failing_result = validate_documents(failing)
    ok = passing_result["status"] == "pass" and failing_result["status"] == "fail"
    print(json.dumps({"status": "pass" if ok else "fail", "passingCase": passing_result, "failingCase": failing_result}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def load_documents(task_dir: Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    documents: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    for filename in REQUIRED_SUPPORT_FILES:
        if not (task_dir / filename).is_file():
            errors.append(f"missing required file: {filename}")
    for name, filename in REQUIRED_FILES.items():
        path = task_dir / filename
        if not path.is_file():
            errors.append(f"missing required file: {filename}")
            continue
        try:
            documents[name] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"cannot read {filename}: {exc}")
    return documents, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task_dir", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()
    if args.task_dir is None:
        parser.error("task_dir is required unless --self-test is used")

    documents, load_errors = load_documents(args.task_dir)
    if load_errors:
        result = {"status": "fail", "errors": load_errors, "warnings": []}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2
    result = validate_documents(documents)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
