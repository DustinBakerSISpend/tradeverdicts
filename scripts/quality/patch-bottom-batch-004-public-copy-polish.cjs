const fs = require("fs");
const p = "scripts/quality/apply-nfl-bottom-batch-004-final-13-v1.cjs";
let s = fs.readFileSync(p, "utf8");

// Make report truncation ASCII-only so dry-run reports do not show mojibake like â€¦
s = s.replace(
  'return s.length > max ? s.slice(0, max - 1) + "…" : s;',
  'return s.length > max ? s.slice(0, max - 3) + "..." : s;'
);

// Add natural list joining instead of semicolon-separated public copy.
if (!s.includes("function listJoin(parts)")) {
  s = s.replace(
    /function assetsFor\(t, teamKey\) \{/,
    `function listJoin(parts) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + " and " + parts[1];
  return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
}

function assetsFor(t, teamKey) {`
  );
}

s = s.replace(
  'return parts.length ? parts.join("; ") : "undisclosed consideration";',
  'return parts.length ? listJoin(parts) : "undisclosed consideration";'
);

// Fix public grammar: "Colts gets" / "Broncos gets" -> "The edge goes to Colts/Broncos"
s = s.replace(
  'analysis: `${winner} gets the edge because the recorded return is stronger than what it gave up.`',
  'analysis: `The edge goes to ${winner} because the recorded return is stronger than what it gave up.`'
);

fs.writeFileSync(p, s);
console.log("Patched public-copy polish for Bottom Batch 004 final-13 script.");
