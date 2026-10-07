import json, subprocess, sys
E = ".env" + ".local"
HOOK = __file__.replace(".test.py", ".py")
cases = [
    # (expect_blocked, tool, input)
    (True,  "Edit", {"file_path": f"/Users/dylanbryan/Songfit/{E}"}),
    (True,  "Read", {"file_path": "/x/.ENV.LOCAL"}),
    (True,  "Read", {"file_path": "/x/.env.production"}),
    (False, "Read", {"file_path": "/x/.env.example"}),
    (False, "Edit", {"file_path": "/Users/dylanbryan/Songfit/CLAUDE.md"}),
    (True,  "Grep", {"pattern": "SUPABASE", "path": f"/x/{E}"}),
    (True,  "Glob", {"pattern": ".env*"}),
    (False, "Grep", {"pattern": "logger", "path": "/x/src"}),
    (True,  "Bash", {"command": f"cat {E}"}),
    (True,  "Bash", {"command": "cat .env*"}),
    (True,  "Bash", {"command": "cat .env.l*"}),
    (True,  "Bash", {"command": "cat .env.??cal"}),
    (True,  "Bash", {"command": 'cat .e""nv.local'}),
    (True,  "Bash", {"command": "cat .env"}),
    (False, "Bash", {"command": "cat .env.example"}),
    (True,  "Bash", {"command": "npx vercel@latest " + "link"}),
    (True,  "Bash", {"command": "npx vercel --debug " + "link --yes"}),
    (True,  "Bash", {"command": "npx vc " + "link"}),
    (True,  "Bash", {"command": "npx Vercel " + "LINK"}),
    (True,  "Bash", {"command": "pnpm dlx vercel env " + "pull"}),
    (True,  "Bash", {"command": "vercel " + "pull"}),
    (False, "Bash", {"command": "npx -y vercel --prod --yes"}),
    (False, "Bash", {"command": "npx -y vercel env ls production"}),
    (False, "Bash", {"command": "pnpm typecheck && pnpm test"}),
    (False, "Bash", {"command": "git commit -m 'Add environment docs'"}),
]
fails = 0
for expect_blocked, tool, inp in cases:
    r = subprocess.run([sys.executable, "-I", HOOK], input=json.dumps({"tool_name": tool, "tool_input": inp}), capture_output=True, text=True)
    blocked = r.returncode == 2
    ok = blocked == expect_blocked
    fails += 0 if ok else 1
    print(("PASS" if ok else "FAIL"), tool, json.dumps(inp)[:60], "->", "blocked" if blocked else "allowed")
print("failures:", fails)
sys.exit(1 if fails else 0)
