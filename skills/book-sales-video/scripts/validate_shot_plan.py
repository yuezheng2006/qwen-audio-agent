#!/usr/bin/env python3
"""Validate sequence-level camera diversity in a shot-plan.json file."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = {
    "id",
    "storyboardSegmentId",
    "narrativeFunction",
    "visualForm",
    "subject",
    "action",
    "shotScale",
    "cameraView",
    "composition",
    "subjectPlacement",
    "captionLane",
    "captionSurface",
    "captionContrastMode",
    "captionBox",
    "continuityAnchor",
    "contrastWithPrevious",
}

ROUGH_PAPER_OIL_STYLE_PREFIX = "rough-paper-oil-vignette"
ROUGH_PAPER_OIL_REQUIRED_FIELDS = {
    "paperBlankRatio",
    "paperBlankPlacement",
    "paintedScenePlacement",
    "paintedEdgeTreatment",
}

CAPTION_BOX_FIELDS = {"left", "top", "width", "height"}
ALLOWED_PAPER_BLANK_PLACEMENTS = {"top", "bottom", "top-and-bottom"}
REQUIRED_CAPTION_CONTRAST = "white-black-stroke"


def validate(plan: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    shots = plan.get("shots")
    if not isinstance(shots, list) or not shots:
        return {"status": "fail", "errors": ["shots must be a non-empty list"], "warnings": []}

    style_id = str(plan.get("styleId", ""))
    uses_rough_paper_oil_style = style_id.startswith(ROUGH_PAPER_OIL_STYLE_PREFIX)
    canvas = plan.get("canvas") or {}
    canvas_width = canvas.get("width")
    canvas_height = canvas.get("height")
    caption_plan = plan.get("captionPlan") or {}
    native_caption_plan = caption_plan.get("implementation") == "native-bilingual"

    if not isinstance(canvas_width, (int, float)) or not isinstance(canvas_height, (int, float)):
        errors.append("canvas.width and canvas.height must be positive numbers")
    elif canvas_width <= 0 or canvas_height <= 0:
        errors.append("canvas.width and canvas.height must be positive numbers")

    if not isinstance(caption_plan, dict) or not caption_plan:
        errors.append("captionPlan must be a non-empty object")
    else:
        for field in ("implementation", "lane", "surface", "contrastMode", "box"):
            if not caption_plan.get(field):
                errors.append(f"captionPlan missing field: {field}")
        if caption_plan.get("contrastMode") != REQUIRED_CAPTION_CONTRAST:
            errors.append(f"captionPlan.contrastMode must be {REQUIRED_CAPTION_CONTRAST}")

    for index, shot in enumerate(shots):
        label = f"shot[{index}]"
        if not isinstance(shot, dict):
            errors.append(f"{label} must be an object")
            continue
        missing = sorted(field for field in REQUIRED_FIELDS if not shot.get(field))
        if missing:
            errors.append(f"{label} missing fields: {', '.join(missing)}")
        if uses_rough_paper_oil_style:
            style_missing = sorted(field for field in ROUGH_PAPER_OIL_REQUIRED_FIELDS if shot.get(field) is None)
            if style_missing:
                errors.append(f"{label} missing rough-paper-oil fields: {', '.join(style_missing)}")
            ratio = shot.get("paperBlankRatio")
            if ratio is not None and (not isinstance(ratio, (int, float)) or isinstance(ratio, bool) or not 0.20 <= ratio <= 0.30):
                errors.append(f"{label} paperBlankRatio must be a number from 0.20 to 0.30")
            if shot.get("paperBlankPlacement") not in ALLOWED_PAPER_BLANK_PLACEMENTS:
                errors.append(f"{label} paperBlankPlacement must be top, bottom, or top-and-bottom")
            if shot.get("paintedScenePlacement") != "full-width":
                errors.append(f"{label} paintedScenePlacement must be full-width")
            if shot.get("captionSurface") != "unpainted-paper":
                errors.append(f"{label} captionSurface must be unpainted-paper for rough-paper-oil style")
            if shot.get("captionContrastMode") != REQUIRED_CAPTION_CONTRAST:
                errors.append(f"{label} captionContrastMode must be {REQUIRED_CAPTION_CONTRAST}")

        box = shot.get("captionBox")
        if not isinstance(box, dict):
            errors.append(f"{label} captionBox must be an object")
        else:
            missing_box = sorted(field for field in CAPTION_BOX_FIELDS if box.get(field) is None)
            if missing_box:
                errors.append(f"{label} captionBox missing fields: {', '.join(missing_box)}")
            elif all(isinstance(box.get(field), (int, float)) and not isinstance(box.get(field), bool) for field in CAPTION_BOX_FIELDS):
                if box["left"] < 0 or box["top"] < 0 or box["width"] <= 0 or box["height"] <= 0:
                    errors.append(f"{label} captionBox must use non-negative position and positive size")
                elif isinstance(canvas_width, (int, float)) and isinstance(canvas_height, (int, float)):
                    if box["left"] + box["width"] > canvas_width or box["top"] + box["height"] > canvas_height:
                        errors.append(f"{label} captionBox exceeds canvas")
            else:
                errors.append(f"{label} captionBox values must be numbers")

        if native_caption_plan:
            expected = {
                "captionLane": caption_plan.get("lane"),
                "captionSurface": caption_plan.get("surface"),
                "captionContrastMode": caption_plan.get("contrastMode"),
                "captionBox": caption_plan.get("box"),
            }
            for field, value in expected.items():
                if shot.get(field) != value:
                    errors.append(f"{label} {field} must match native captionPlan")

    valid_shots = [shot for shot in shots if isinstance(shot, dict)]
    for index in range(1, len(valid_shots)):
        previous = valid_shots[index - 1]
        current = valid_shots[index]
        pair = f"{previous.get('id', index - 1)} -> {current.get('id', index)}"
        if previous.get("shotScale") == current.get("shotScale"):
            errors.append(f"adjacent shots share shotScale: {pair}")
        if previous.get("cameraView") == current.get("cameraView"):
            errors.append(f"adjacent shots share cameraView: {pair}")
        if previous.get("visualForm") == current.get("visualForm"):
            warnings.append(f"adjacent shots share visualForm: {pair}")
        if previous.get("subjectPlacement") == current.get("subjectPlacement"):
            warnings.append(f"adjacent shots share subjectPlacement: {pair}")
        if previous.get("action") == current.get("action"):
            warnings.append(f"adjacent shots share action: {pair}")
        if uses_rough_paper_oil_style and previous.get("paperBlankPlacement") == current.get("paperBlankPlacement"):
            warnings.append(f"adjacent rough-paper-oil shots share paperBlankPlacement: {pair}")

    scale_counts = Counter(shot.get("shotScale") for shot in valid_shots if shot.get("shotScale"))
    view_counts = Counter(shot.get("cameraView") for shot in valid_shots if shot.get("cameraView"))
    painted_scene_counts = Counter(
        shot.get("paintedScenePlacement") for shot in valid_shots if shot.get("paintedScenePlacement")
    )
    if len(valid_shots) >= 6:
        if len(scale_counts) < 4:
            errors.append("sequences with 6+ shots require at least 4 distinct shotScale values")
        if len(view_counts) < 4:
            errors.append("sequences with 6+ shots require at least 4 distinct cameraView values")

    return {
        "status": "pass" if not errors else "fail",
        "shotCount": len(valid_shots),
        "distinctShotScales": sorted(scale_counts),
        "distinctCameraViews": sorted(view_counts),
        "distinctPaintedScenePlacements": sorted(painted_scene_counts),
        "errors": errors,
        "warnings": warnings,
    }


def sample_shot(index: int, scale: str, view: str, form: str) -> dict[str, Any]:
    return {
        "id": f"shot-{index:02d}",
        "storyboardSegmentId": f"body-{index:02d}",
        "narrativeFunction": "test",
        "visualForm": form,
        "subject": "person",
        "action": f"action-{index}",
        "shotScale": scale,
        "cameraView": view,
        "composition": f"composition-{index}",
        "subjectPlacement": f"placement-{index}",
        "paperBlankRatio": 0.24,
        "paperBlankPlacement": ("top", "bottom", "top-and-bottom")[(index - 1) % 3],
        "paintedScenePlacement": "full-width",
        "paintedEdgeTreatment": "dry-brush-fade",
        "captionLane": "paper-lower",
        "captionSurface": "unpainted-paper",
        "captionContrastMode": REQUIRED_CAPTION_CONTRAST,
        "captionBox": {"left": 120, "top": 1250, "width": 800, "height": 240},
        "continuityAnchor": "same-person",
        "contrastWithPrevious": "different-scale-and-view",
    }


def run_self_test() -> int:
    passing = {
        "canvas": {"width": 1080, "height": 1920},
        "styleId": "rough-paper-oil-vignette-v3",
        "captionPlan": {
            "implementation": "native-bilingual",
            "lane": "paper-lower",
            "surface": "unpainted-paper",
            "contrastMode": REQUIRED_CAPTION_CONTRAST,
            "box": {"left": 120, "top": 1250, "width": 800, "height": 240},
        },
        "shots": [
            sample_shot(1, "extreme-wide-shot", "high-angle", "environment"),
            sample_shot(2, "close-up", "eye-level-profile", "character-action"),
            sample_shot(3, "extreme-close-up", "top-down", "object-detail"),
            sample_shot(4, "full-shot", "low-angle", "conceptual-tableau"),
            sample_shot(5, "medium-shot", "over-shoulder", "over-shoulder"),
            sample_shot(6, "wide-shot", "eye-level-front", "empty-space"),
        ]
    }
    failing = {
        "canvas": {"width": 1080, "height": 1920},
        "styleId": "rough-paper-oil-vignette-v3",
        "captionPlan": {
            "implementation": "native-bilingual",
            "lane": "paper-lower",
            "surface": "unpainted-paper",
            "contrastMode": REQUIRED_CAPTION_CONTRAST,
            "box": {"left": 120, "top": 1250, "width": 800, "height": 240},
        },
        "shots": [
            sample_shot(1, "medium-shot", "eye-level-front", "character-action"),
            sample_shot(2, "medium-shot", "eye-level-front", "character-action"),
        ]
    }
    pass_result = validate(passing)
    fail_result = validate(failing)
    ok = pass_result["status"] == "pass" and fail_result["status"] == "fail"
    print(json.dumps({"status": "pass" if ok else "fail", "passingCase": pass_result, "failingCase": fail_result}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()
    if args.path is None:
        parser.error("path is required unless --self-test is used")

    try:
        plan = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "fail", "errors": [str(exc)], "warnings": []}, ensure_ascii=False, indent=2))
        return 2

    result = validate(plan)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
