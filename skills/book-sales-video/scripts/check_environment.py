#!/usr/bin/env python3
"""Read-only local preflight for book-sales-video; never prints secret values."""

from __future__ import annotations
import argparse, importlib.util, json, os, platform, re, shutil, subprocess, sys
from pathlib import Path
from typing import Any

SKILL_DIR = Path(__file__).resolve().parent.parent
HOME = Path.home()
APP = Path("/Applications/OpenChatCut.app")
BRIDGE = SKILL_DIR / "scripts" / "openchatcut_mcp.py"
NARRATE = SKILL_DIR / "scripts" / "qwaudio_narrate.mjs"
RESOLVE_VOICE = SKILL_DIR / "scripts" / "resolve_author_voice.mjs"


def skill_name(path: Path) -> str | None:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")[:4096]
    except OSError:
        return None
    match = re.search(r"(?m)^name:\s*[\"']?([^\"'\n]+)", text)
    return match.group(1).strip() if match else None


def find_skill(name: str) -> str | None:
    for root in (HOME / ".codex/skills", HOME / ".agents/skills", HOME / ".claude/skills"):
        if not root.exists():
            continue
        for path in [root / name / "SKILL.md", root / "WeChatReading/skills/SKILL.md", *root.glob("*/SKILL.md")]:
            if path.is_file() and skill_name(path) == name:
                return str(path)
    return None


def secret_available(*names: str) -> bool:
    return any(bool(os.environ.get(name, "").strip()) for name in names)


def voice_profile_dir() -> Path:
    override = os.environ.get("VOICE_PROFILE_DIR", "").strip()
    if override:
        return Path(override)
    return HOME / ".config" / "qwaudio" / "voice-profiles"


def voice_profiles_status() -> dict[str, Any]:
    directory = voice_profile_dir()
    if not directory.is_dir():
        return {"status": "missing-dir", "directory": str(directory), "count": 0, "valueExposed": False}
    count = 0
    for path in directory.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload.get("profiles") if isinstance(payload, dict) else None
            if isinstance(rows, list):
                count += len(rows)
        except Exception:
            continue
    return {
        "status": "ready" if count else "empty",
        "directory": str(directory),
        "count": count,
        "valueExposed": False,
    }


def run_json(command: list[str], timeout: int = 20) -> tuple[dict[str, Any] | None, str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)
    raw = result.stdout.strip() or result.stderr.strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None, raw[-500:]
    return data, "" if result.returncode == 0 else raw[-500:]


def lark_status(profile: str, base_url: str, script_field: str) -> dict[str, Any]:
    binary = shutil.which("lark-cli")
    if not binary:
        return {"status": "missing", "valueExposed": False}
    cli = [binary, *(["--profile", profile] if profile else [])]
    whoami, error = run_json([*cli, "whoami"])
    if not whoami or not whoami.get("available") or whoami.get("tokenStatus") != "ready":
        return {
            "status": "profile-not-ready",
            "profile": profile or "default",
            "detail": error or "profile unavailable",
            "valueExposed": False,
        }
    report: dict[str, Any] = {
        "status": "ready-no-base-check" if not base_url else "checking-base",
        "profile": profile or "default",
        "identity": whoami.get("identity"),
        "valueExposed": False,
    }
    if not base_url:
        return report
    resolved, error = run_json([*cli, "base", "+url-resolve", "--url", base_url, "--as", "bot"])
    if not resolved or not resolved.get("ok"):
        return {**report, "status": "base-url-or-permission-error", "detail": error or "URL resolve failed"}
    data = resolved.get("data", {})
    base_token, table_id = data.get("base_token"), data.get("block_id")
    if not base_token or not table_id:
        return {**report, "status": "base-url-unresolved"}
    fields, error = run_json([
        *cli, "base", "+field-list",
        "--base-token", str(base_token), "--table-id", str(table_id), "--as", "bot",
    ])
    if not fields or not fields.get("ok"):
        return {**report, "status": "base-permission-error", "detail": error or "field list failed"}
    names = [item.get("name") for item in fields.get("data", {}).get("fields", [])]
    return {
        **report,
        "status": "ready" if script_field in names else "script-field-missing",
        "scriptFieldFound": script_field in names,
    }


def openchatcut_runtime() -> dict[str, Any]:
    if not APP.exists():
        return {"status": "missing", "appPath": str(APP)}
    result = subprocess.run(
        [sys.executable, str(BRIDGE), "--no-launch", "status"],
        capture_output=True, text=True, timeout=10, check=False,
    )
    data: dict[str, Any] = {"status": "installed-not-running", "appPath": str(APP)}
    if result.returncode == 0:
        try:
            data.update(json.loads(result.stdout))
        except json.JSONDecodeError:
            pass
    return data


def carousel_status() -> dict[str, Any]:
    path = SKILL_DIR / "assets/carousel/manifest.json"
    directory = "covers"
    try:
        directory = str(json.loads(path.read_text())["directory"])
    except Exception:
        pass
    folder = path.parent / directory
    exts = {".png", ".jpg", ".jpeg", ".webp", ".avif"}
    files = sorted(
        p.name for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts
    ) if folder.is_dir() else []
    return {"status": "available" if files else "empty", "directory": str(folder), "count": len(files), "files": files}


def qwaudio_repo_status() -> dict[str, Any]:
    node = shutil.which("node")
    if not node:
        return {"status": "node-missing", "narrateScript": str(NARRATE)}
    if not NARRATE.is_file() or not RESOLVE_VOICE.is_file():
        return {"status": "scripts-missing", "narrateScript": str(NARRATE)}
    # Walk up from skill dir for package.json name=qwen-audio-agent (symlink-friendly).
    cursor = SKILL_DIR
    for _ in range(8):
        pkg = cursor / "package.json"
        if pkg.is_file():
            try:
                name = json.loads(pkg.read_text(encoding="utf-8")).get("name")
            except Exception:
                name = None
            if name == "qwen-audio-agent":
                return {"status": "ok", "root": str(cursor), "narrateScript": str(NARRATE)}
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    if os.environ.get("QWAUDIO_ROOT", "").strip():
        root = Path(os.environ["QWAUDIO_ROOT"].strip())
        if (root / "package.json").is_file():
            return {"status": "ok", "root": str(root), "narrateScript": str(NARRATE), "via": "QWAUDIO_ROOT"}
    return {"status": "repo-not-found", "hint": "从本仓 symlink 安装 Skill，或设置 QWAUDIO_ROOT"}


def build_report(base_url: str = "", lark_profile: str = "", script_field: str = "文案仿写.输出结果") -> dict[str, Any]:
    weread = find_skill("weread-skills")
    runtime = openchatcut_runtime()
    requests_ok = importlib.util.find_spec("requests") is not None
    profiles = voice_profiles_status()
    dashscope_ok = secret_available("DASHSCOPE_API_KEY", "CASCADE_TTS_API_KEY", "QWEN_AUDIO_REALTIME_API_KEY")
    repo = qwaudio_repo_status()
    voice_ok = (
        dashscope_ok
        and profiles["status"] == "ready"
        and repo["status"] == "ok"
        and bool(shutil.which("node"))
    )
    lark = lark_status(lark_profile, base_url, script_field)
    actions = []
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        actions.append("安装 FFmpeg：macOS 可运行 brew install ffmpeg；其他系统使用系统包管理器")
    if not requests_ok:
        actions.append("安装 Python requests：python3 -m pip install requests")
    if not shutil.which("node"):
        actions.append("安装 Node.js（配音脚本 qwaudio_narrate.mjs 需要）")
    if not weread:
        actions.append("安装微信读书 Skill: npx skills add Tencent/WeChatReading -g")
    if not os.getenv("WEREAD_API_KEY"):
        actions.append("按 weread-skills 的说明申请并安全配置 WEREAD_API_KEY")
    if not os.getenv("PEXELS_API_KEY"):
        actions.append("从 https://www.pexels.com/api/ 申请并配置 PEXELS_API_KEY")
    if runtime["status"] == "missing":
        actions.append("从 https://github.com/0xsline/OpenChatCut/releases 安装 OpenChatCut Desktop；macOS 放入 /Applications")
    elif runtime["status"] != "ready":
        actions.append("运行装配命令时由本地桥接脚本自动启动 OpenChatCut")
    if not dashscope_ok:
        actions.append("配置 DASHSCOPE_API_KEY（或 CASCADE_TTS_API_KEY）；密钥不要写入任务目录")
    if profiles["status"] != "ready":
        actions.append(
            f"在 Voice Studio 准备可用音色（目录 {profiles['directory']}）。名人示例：刘震云·北大·降噪"
        )
    if repo["status"] != "ok":
        actions.append(
            "将本仓 skills/book-sales-video symlink 到 $CODEX_HOME/skills/book-sales-video，或设置 QWAUDIO_ROOT"
        )
    if not voice_ok:
        actions.append("配音 gate 未就绪：需要 Node + DashScope Key + Voice Studio profiles + qwen-audio-agent 仓库")
    if lark["status"] == "missing":
        actions.append("安装飞书官方 CLI：npx @larksuite/cli@latest install")
    elif lark["status"] == "profile-not-ready":
        actions.append("配置飞书应用：lark-cli config init --new；如使用命名配置，再通过 --lark-profile 指定")
    elif lark["status"] in {"base-permission-error", "base-url-or-permission-error"}:
        actions.append("为企业应用开通 base:field:read、base:record:read、base:table:read、base:view:read，并把机器人加入目标 Base 协作者")
    elif lark["status"] == "script-field-missing":
        actions.append(f"确认目标表存在文案字段：{script_field}")
    return {
        "skill": "book-sales-video",
        "checks": {
            "openchatcut": runtime,
            "wereadSkill": {"status": "ok" if weread else "missing", "path": weread},
            "wereadApiKey": {"status": "configured" if os.getenv("WEREAD_API_KEY") else "missing", "valueExposed": False},
            "pexels": {"apiKey": "configured" if os.getenv("PEXELS_API_KEY") else "missing", "valueExposed": False},
            "voiceover": {
                "route": "qwen-audio-agent Voice Studio (DashScope clone) then local OpenChatCut import",
                "status": "ready" if voice_ok else "missing-configuration",
                "dashscopeApiKey": "configured" if dashscope_ok else "missing",
                "profiles": profiles,
                "qwaudio": repo,
                "valueExposed": False,
            },
            "larkBase": lark,
            "carouselAssets": carousel_status(),
            "localMediaTools": {"ffmpeg": shutil.which("ffmpeg"), "ffprobe": shutil.which("ffprobe"), "node": shutil.which("node")},
        },
        "gates": {
            "researchReady": bool(weread and os.getenv("WEREAD_API_KEY")),
            "openchatcutReady": runtime["status"] in {"ready", "installed-not-running"},
            "qwaudioVoiceReady": voice_ok,
            "larkReady": lark["status"] in {"ready", "ready-no-base-check"},
            "runtimeChecksPending": ["OpenChatCut required tool surface", "Codex image_gen"],
        },
        "actions": actions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--base-url", default="", help="可选：实测飞书 Base URL 与字段读取权限")
    parser.add_argument("--lark-profile", default="")
    parser.add_argument("--script-field", default="文案仿写.输出结果")
    args = parser.parse_args()
    report = build_report(args.base_url, args.lark_profile, args.script_field)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("图书带货视频 Skill 环境检查（qwen-audio-agent 作者配音）")
        for key, value in report["checks"].items():
            print(f"- {key}: {value.get('status', '已检查') if isinstance(value, dict) else value}")
        for action in report["actions"]:
            print(f"  - {action}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
