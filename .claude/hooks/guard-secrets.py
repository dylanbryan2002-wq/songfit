#!/usr/bin/env python3
"""PreToolUse guard: no tool may touch local env files (.env.local, .env.*.local,
.env.production, .env) or run Vercel commands that overwrite them.
Exit 2 blocks the call and feeds the reason back to the model.

This is a literal-pattern guard, not a sandbox: it stops the realistic ways an
agent stumbles into a secret (direct paths, globs, symlinks, case variants,
the Grep/Glob tools, every spelling of `vercel link`). Deliberate evasion
(variable expansion, quote-splitting) is a rules violation, not a technical
boundary; CLAUDE.md says so.
"""
import json, os, re, sys

# Env file names we protect: .env, .env.local, .env.production, .env.<anything>.local
ENV_FILE = re.compile(r"\.env(\.[A-Za-z0-9_-]+)?(\.local)?\b(?!\.example)", re.IGNORECASE)
# Shell globs/quotes that could expand to an env file: .env*, .env.l*, .env?, .e""nv
ENV_GLOB = re.compile(r"\.env[\w.-]*[\*\?\[]|\.e[\"']+nv", re.IGNORECASE)
# Every spelling of the Vercel commands that write .env.local:
#   vercel link | vc link | npx vercel@latest link | vercel --debug link | vercel env pull | vercel pull
VERCEL_BAD = re.compile(
    r"\b(vercel|vc)(@\S+)?(\s+-{1,2}[\w-]+(=\S+)?)*\s+(link|pull|env\s+pull)\b",
    re.IGNORECASE,
)
ALLOWED_ENV_NAMES = {".env.example"}


def block(reason):
    print(f"BLOCKED by .claude/hooks/guard-secrets.py: {reason}", file=sys.stderr)
    sys.exit(2)


def is_env_path(path: str) -> bool:
    if not path:
        return False
    base = os.path.basename(path)
    if base.lower() in ALLOWED_ENV_NAMES:
        return False
    if ENV_FILE.search(base):
        return True
    try:
        real = os.path.realpath(path)
        rbase = os.path.basename(real)
        if rbase.lower() not in ALLOWED_ENV_NAMES and ENV_FILE.search(rbase):
            return True
    except Exception:
        pass
    return False


try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = data.get("tool_name", "")
inp = data.get("tool_input", {}) or {}

if tool in ("Edit", "Write", "MultiEdit", "Read", "NotebookEdit"):
    path = str(inp.get("file_path") or inp.get("notebook_path") or "")
    if is_env_path(path):
        block(f"{tool} on {path}: env files are off-limits to agents. Ask Dylan to edit it.")

if tool in ("Grep", "Glob"):
    for field in ("path", "pattern", "glob", "include"):
        val = str(inp.get(field) or "")
        if is_env_path(val) or ENV_GLOB.search(val):
            block(f"{tool} with {field}={val!r}: env files are off-limits to agents.")

if tool == "Bash":
    cmd = str(inp.get("command") or "")
    # Strip the one legitimate name so it never trips the guard.
    probe = cmd.replace(".env.example", "")
    if ENV_FILE.search(probe) or ENV_GLOB.search(probe):
        block("Bash command references or globs an env file: off-limits. Secrets are entered by Dylan only.")
    if VERCEL_BAD.search(cmd):
        block("Vercel link/pull commands overwrite the local env file. The project is already linked; never run these.")

sys.exit(0)
