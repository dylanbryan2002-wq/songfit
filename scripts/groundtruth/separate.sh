#!/bin/zsh
# Strip the voice from ground-truth clips so ACRCloud can hear the music bed (docs/review/18).
#   scripts/groundtruth/separate.sh [--all] [<root>]
# Default: clips whose fingerprint.json has no match or a score under 90. --all: every clip.
# Needs ~/Songfit-groundtruth/tools/venv with demucs installed. Writes work/<id>/no_vocals.wav; skips clips that have it.
set -euo pipefail
ALL=0; [[ "${1:-}" == "--all" ]] && { ALL=1; shift; }
ROOT="${1:-$HOME/Songfit-groundtruth}"
VENV="$ROOT/tools/venv"
FFMPEG="$(node -e 'console.log(require("ffmpeg-static"))')"
[[ -x "$VENV/bin/demucs" ]] || { echo "demucs not installed in $VENV" >&2; exit 1; }
ids=$(node -e '
  const fs=require("fs"),path=require("path"),os=require("os");
  const root=process.argv[1], all=process.argv[2]==="1";
  const slug=f=>path.parse(f).name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const fp=new Map((fs.existsSync(root+"/fingerprint.json")?JSON.parse(fs.readFileSync(root+"/fingerprint.json","utf8")):[]).map(r=>[r.id,r]));
  const lines=fs.readFileSync(root+"/clips.csv","utf8").split("\n").filter(Boolean).slice(1);
  for(const l of lines){const file=l.startsWith("\"")?l.slice(1,l.indexOf("\"",1)):l.split(",")[0];const id=slug(file);
    const r=fp.get(id); if(all||!r||!r.best||r.best.score<90) console.log(id+"\t"+file);}
' "$ROOT" "$ALL")
n=$(echo "$ids" | grep -c . || true); echo "separating $n clips"
echo "$ids" | while IFS=$'\t' read -r id file; do
  [[ -z "$id" ]] && continue
  work="$ROOT/work/$id"; mkdir -p "$work"
  if [[ -f "$work/no_vocals.wav" ]]; then echo "$id: already separated"; continue; fi
  "$FFMPEG" -nostdin -v error -y -i "$ROOT/videos/$file" -vn -ac 2 -ar 44100 "$work/audio.wav"
  "$VENV/bin/demucs" --two-stems=vocals -n htdemucs -d cpu -o "$work/sep" "$work/audio.wav" </dev/null >/dev/null 2>&1
  mv "$work/sep/htdemucs/audio/no_vocals.wav" "$work/no_vocals.wav"
  rm -rf "$work/sep" "$work/audio.wav"
  echo "$id: done"
done
