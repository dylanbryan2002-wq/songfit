// Shape check of the Apple key variables; prints booleans and lengths, never the values.
const raw = process.env["APPLE_MUSICKIT_PRIVATE_KEY"] ?? "";
console.log(`PRIVATE_KEY set: ${!!raw}; length: ${raw.length}; lines: ${raw.split("\n").length}`);
console.log(`  starts with BEGIN line: ${raw.trimStart().startsWith("-----BEGIN PRIVATE KEY-----")}`);
console.log(`  ends with END line: ${raw.trimEnd().endsWith("-----END PRIVATE KEY-----")}`);
console.log(`  contains literal backslash-n: ${raw.includes("\\n")}`);
console.log(`  contains quote characters: ${raw.includes('"')}`);
const b64 = process.env["APPLE_MUSICKIT_PRIVATE_KEY_B64"] ?? "";
console.log(`PRIVATE_KEY_B64 set: ${!!b64}; length: ${b64.length}`);
console.log(`node: ${process.version}`);
