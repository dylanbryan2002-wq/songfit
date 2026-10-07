// Logs whether ffmpeg/ffprobe binaries exist and are executable. Never fails the build.
import { createRequire } from "node:module";
import { accessSync, constants } from "node:fs";

const require = createRequire(import.meta.url);

function report(name, load) {
  try {
    const p = load();
    let exists = true;
    let executable = true;
    try { accessSync(p, constants.F_OK); } catch { exists = false; }
    try { accessSync(p, constants.X_OK); } catch { executable = false; }
    console.log(`[check-binaries] ${name}: path=${p} exists=${exists} executable=${executable}`);
  } catch (e) {
    console.log(`[check-binaries] ${name}: error ${e?.message}`);
  }
}

report("ffmpeg", () => require("ffmpeg-static"));
report("ffprobe", () => require("ffprobe-static").path);
