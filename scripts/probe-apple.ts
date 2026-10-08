/* Verify the Apple Music API credentials end to end without printing any secret:
   mint a developer token (ES256) and search the US catalogue for a few songs.
   Run: pnpm local scripts/probe-apple.ts
   The key may be given as APPLE_MUSICKIT_PRIVATE_KEY_PATH (path to the .p8 file; local only),
   APPLE_MUSICKIT_PRIVATE_KEY (the .p8 text; Vercel accepts multi-line values), or
   APPLE_MUSICKIT_PRIVATE_KEY_B64 (the file base64-encoded on one line). */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function readApplePem(): string | null {
  const path = process.env["APPLE_MUSICKIT_PRIVATE_KEY_PATH"];
  if (path) {
    try {
      const pem = readFileSync(path, "utf8");
      if (pem.includes("BEGIN PRIVATE KEY")) return pem;
    } catch {
      /* fall through */
    }
  }
  const raw = process.env["APPLE_MUSICKIT_PRIVATE_KEY"];
  if (raw && raw.includes("BEGIN PRIVATE KEY")) return raw.replace(/\\n/g, "\n");
  const b64 = process.env["APPLE_MUSICKIT_PRIVATE_KEY_B64"];
  if (b64) {
    const pem = Buffer.from(b64, "base64").toString("utf8");
    if (pem.includes("BEGIN PRIVATE KEY")) return pem;
  }
  return null;
}

function developerToken(teamId: string, keyId: string, p8: string): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: teamId, iat: now, exp: now + 3600 }));
  const data = `${header}.${payload}`;
  const key = createPrivateKey({ key: p8, format: "pem" });
  const sig = sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return `${data}.${b64url(sig)}`;
}

async function main() {
  const teamId = process.env["APPLE_TEAM_ID"];
  const keyId = process.env["APPLE_MUSICKIT_KEY_ID"];
  const pem = readApplePem();
  console.log(`team set: ${!!teamId}, key id set: ${!!keyId}, private key usable: ${!!pem}`);
  if (!teamId || !keyId || !pem) process.exit(1);
  const token = developerToken(teamId, keyId, pem);
  for (const term of ["Too Sweet Hozier", "Someone Like You Adele", "Mr. Brightside The Killers", "Dancing On My Own Robyn"]) {
    const res = await fetch(`https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(term)}&types=songs&limit=3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { results?: { songs?: { data: { attributes: { name: string; artistName: string; previews?: { url: string }[]; durationInMillis: number } }[] } } };
    const songs = body.results?.songs?.data ?? [];
    console.log(`\n${res.status} ${term}`);
    for (const s of songs) console.log(`   ${s.attributes.name} / ${s.attributes.artistName} / ${Math.round(s.attributes.durationInMillis / 1000)}s / preview: ${s.attributes.previews?.[0]?.url ? "yes" : "no"}`);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
