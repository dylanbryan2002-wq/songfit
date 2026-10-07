#!/usr/bin/env python3
"""PreToolUse guard: no tool may touch .env.local / .env.*.local, or run Vercel
commands that overwrite them. Exit 2 blocks the call and feeds the reason back."""
import json, re, sys

ENV_FILE = re.compile(r"\.env(\.[A-Za-z0-9_-]+)?\.local\b")
BAD_CMDS = [
    re.compile(r"\bvercel\s+link\b"),
    re.compile(r"\bvercel\s+env\s+pull\b"),
    re.compile(r"\bvercel\s+pull\b"),
]

def block(reason):
    print(f"BLOCKED by .claude/hooks/guard-secrets.py: {reason}", file=sys.stderr)
    sys.exit(2)

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = data.get("tool_name", "")
inp = data.get("tool_input", {}) or {}

if tool in ("Edit", "Write", "MultiEdit", "Read", "NotebookEdit"):
    path = str(inp.get("file_path") or inp.get("notebook_path") or "")
    if ENV_FILE.search(path):
        block(f"{tool} on {path}: .env.local files are off-limits to agents. Ask Dylan to edit it.")

if tool == "Bash":
    cmd = str(inp.get("command") or "")
    if ENV_FILE.search(cmd):
        block("Bash command references .env.local: off-limits. Secrets are set by Dylan directly (file or dashboard).")
    for pat in BAD_CMDS:
        if pat.search(cmd):
            block("`vercel link` / `vercel env pull` overwrite .env.local. The project is already linked; never run these.")

sys.exit(0)
