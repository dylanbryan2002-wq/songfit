#!/usr/bin/env bash
# Turns a phone screen recording of a result into the landing demo:
#   public/brand/demo.mp4 (4.5 s, silent, 9:16 at 540x960, H.264 yuv420p, faststart, at most 800 KB)
#   public/brand/demo-poster.jpg (its first frame)
# Usage: scripts/make-demo.sh <recording> [start, e.g. 3 or 00:00:03.5]
# Uses the ffmpeg/ffprobe bundled in node_modules (ffmpeg-static, ffprobe-static). Writes nothing
# when the encoded clip is over 800 KB.
set -euo pipefail

if [[ $# -lt 1 || ! -f "$1" ]]; then
  echo "usage: $0 <recording> [start]" >&2
  exit 2
fi
recording="$1"
start="${2:-0}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/public/brand"
max_bytes=$((800 * 1024))

ffmpeg="$(cd "$root" && node -e 'process.stdout.write(require("ffmpeg-static"))')"
ffprobe="$(cd "$root" && node -e 'process.stdout.write(require("ffprobe-static").path)')"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

"$ffmpeg" -hide_banner -loglevel error -y -ss "$start" -i "$recording" -t 4.5 -an \
  -vf "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1" -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart \
  "$tmp/demo.mp4"
"$ffmpeg" -hide_banner -loglevel error -y -i "$tmp/demo.mp4" -frames:v 1 -q:v 3 "$tmp/demo-poster.jpg"

bytes=$(wc -c < "$tmp/demo.mp4" | tr -d ' ')
duration=$("$ffprobe" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$tmp/demo.mp4")
echo "duration ${duration}s, ${bytes} bytes"

if (( bytes > max_bytes )); then
  echo "demo.mp4 is over 800 KB ($bytes bytes); nothing written. Try a later start or a calmer stretch." >&2
  exit 1
fi

mv "$tmp/demo.mp4" "$out/demo.mp4"
mv "$tmp/demo-poster.jpg" "$out/demo-poster.jpg"
echo "wrote $out/demo.mp4 and $out/demo-poster.jpg"
