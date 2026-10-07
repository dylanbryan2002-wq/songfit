import { getSubmission } from "../src/db/queries/submissions";
import { getSignedPlaybackUrl } from "../src/media/storage";
async function main() {
  const sub = await getSubmission(process.argv[2]!);
  const url = await getSignedPlaybackUrl(sub!.video_path);
  const res = await fetch(url, { headers: { Range: "bytes=0-1" } });
  console.log("status", res.status, "accept-ranges", res.headers.get("accept-ranges"), "content-range", res.headers.get("content-range"), "type", res.headers.get("content-type"), "cors", res.headers.get("access-control-allow-origin"));
}
main().catch((e) => { console.error(e); process.exit(1); });
