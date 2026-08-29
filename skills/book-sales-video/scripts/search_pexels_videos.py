#!/usr/bin/env python3
"""Search portrait book videos through the official Pexels API.

The search query is intentionally fixed to ``book`` for the opening shot of
the book-sales-video skill. The script reads ``PEXELS_API_KEY`` from the
environment and never prints the credential value.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


API_URL = "https://api.pexels.com/v1/videos/search"
QUERY = "book"


def best_video_file(files: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [
        item
        for item in files
        if item.get("link") and item.get("file_type") in {None, "video/mp4"}
    ]
    if not candidates:
        return None

    def score(item: dict[str, Any]) -> tuple[int, int, float, int, int]:
        width = int(item.get("width") or 0)
        height = int(item.get("height") or 0)
        portrait = 1 if height > width else 0
        ratio = width / height if height else 1.0
        ratio_fit = -abs(ratio - 9 / 16)
        enough_resolution = 1 if width >= 720 and height >= 1280 else 0
        target_distance = -(abs(width - 1080) + abs(height - 1920))
        area = width * height
        return (portrait, enough_resolution, ratio_fit, target_distance, area)

    selected = max(candidates, key=score)
    return {
        "id": selected.get("id"),
        "quality": selected.get("quality"),
        "fileType": selected.get("file_type"),
        "width": selected.get("width"),
        "height": selected.get("height"),
        "fps": selected.get("fps"),
        "link": selected.get("link"),
    }


def normalize_video(video: dict[str, Any]) -> dict[str, Any]:
    creator = video.get("user") or {}
    return {
        "id": video.get("id"),
        "durationSeconds": video.get("duration"),
        "width": video.get("width"),
        "height": video.get("height"),
        "pexelsUrl": video.get("url"),
        "previewImage": video.get("image"),
        "creator": {
            "name": creator.get("name"),
            "url": creator.get("url"),
        },
        "bestFile": best_video_file(video.get("video_files") or []),
    }


def search(page: int, per_page: int, timeout: float) -> dict[str, Any]:
    api_key = os.environ.get("PEXELS_API_KEY")
    if not api_key:
        raise RuntimeError(
            "PEXELS_API_KEY is missing. Configure it from https://www.pexels.com/api/."
        )

    params = urllib.parse.urlencode(
        {
            "query": QUERY,
            "orientation": "portrait",
            "size": "medium",
            "page": page,
            "per_page": per_page,
        }
    )
    request = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={
            "Authorization": api_key,
            "Accept": "application/json",
            "User-Agent": "book-sales-video-skill/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
        rate_limit = {
            "limit": response.headers.get("X-Ratelimit-Limit"),
            "remaining": response.headers.get("X-Ratelimit-Remaining"),
            "reset": response.headers.get("X-Ratelimit-Reset"),
        }

    return {
        "source": "Pexels API",
        "endpoint": API_URL,
        "query": QUERY,
        "orientation": "portrait",
        "size": "medium",
        "page": payload.get("page", page),
        "perPage": payload.get("per_page", per_page),
        "totalResults": payload.get("total_results"),
        "hasNextPage": bool(payload.get("next_page")),
        "nextPageNumber": page + 1 if payload.get("next_page") else None,
        "rateLimit": rate_limit,
        "attribution": {
            "linkBack": "https://www.pexels.com",
            "rule": "Save the Pexels page and credit the creator when possible.",
        },
        "candidates": [normalize_video(video) for video in payload.get("videos") or []],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per-page", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args()

    if args.page < 1:
        parser.error("--page must be at least 1")
    if not 1 <= args.per_page <= 80:
        parser.error("--per-page must be between 1 and 80")

    try:
        report = search(args.page, args.per_page, args.timeout)
    except RuntimeError as exc:
        print(json.dumps({"status": "missing-config", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    except urllib.error.HTTPError as exc:
        messages = {
            401: "PEXELS_API_KEY is missing or invalid.",
            403: "The Pexels account cannot access this API resource.",
            429: "The Pexels API rate limit has been exceeded.",
        }
        message = messages.get(exc.code, f"Pexels API returned HTTP {exc.code}.")
        print(json.dumps({"status": "api-error", "httpStatus": exc.code, "error": message}, ensure_ascii=False), file=sys.stderr)
        return 3
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "network-error", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 4

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
