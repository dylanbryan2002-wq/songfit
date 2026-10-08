/* Check that Supabase Storage accepts an object larger than the old 50 MB cap.
   Uploads a 60 MB zero-filled object to the videos bucket with the service role, then deletes it.
   Run: pnpm local scripts/probe-upload-limit.ts */
import { createServiceClient } from "../src/db/client";

async function main() {
  const supabase = createServiceClient();
  const path = `probe/limit-${Date.now()}.bin`;
  const body = Buffer.alloc(60 * 1024 * 1024);
  const t0 = Date.now();
  const { error } = await supabase.storage.from("videos").upload(path, body, { contentType: "application/octet-stream" });
  console.log(error ? `REJECTED: ${error.message}` : `ACCEPTED 60 MB in ${Math.round((Date.now() - t0) / 1000)} s`);
  if (!error) await supabase.storage.from("videos").remove([path]);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
