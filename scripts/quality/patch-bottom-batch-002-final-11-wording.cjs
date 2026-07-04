const fs = require("fs");
const p = "scripts/quality/apply-nfl-bottom-batch-002-final-11-v1.mjs";
let s = fs.readFileSync(p, "utf8");

s = s.replace(
  "`${primary} earns the edge because the recorded return is stronger than what it gave up.`",
  "`${primary} gets the edge because the recorded return is stronger than what it gave up.`"
);

s = s.replace(
  "`${winner} earns the edge because the recorded return is stronger than what it gave up.`",
  "`${winner} gets the edge because the recorded return is stronger than what it gave up.`"
);

s = s.replace(/overallreturn/g, "overall return");

fs.writeFileSync(p, s);
console.log("Patched final-11 script wording.");
