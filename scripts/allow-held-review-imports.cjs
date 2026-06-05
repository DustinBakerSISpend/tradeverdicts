const fs = require("fs");
const path = require("path");

const SCRIPTS_DIR = __dirname;

const OLD_BLOCK = `.filter((trade) => trade.publishStatus !== "hold-conflict")
    .filter((trade) => trade.publishStatus !== "hold-review");`;

const NEW_BLOCK = `.filter((trade) => trade.publishStatus !== "hold-conflict");`;

function main() {
  const files = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((file) => /^import-.*\.cjs$/.test(file));

  let changed = 0;
  let alreadyUpdated = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(SCRIPTS_DIR, file);
    const original = fs.readFileSync(filePath, "utf8");

    if (original.includes(OLD_BLOCK)) {
      const updated = original.replace(OLD_BLOCK, NEW_BLOCK);
      fs.writeFileSync(filePath, updated);
      console.log(`Updated: ${file}`);
      changed++;
      continue;
    }

    if (original.includes(NEW_BLOCK)) {
      console.log(`Already updated: ${file}`);
      alreadyUpdated++;
      continue;
    }

    console.log(`Skipped, pattern not found: ${file}`);
    skipped++;
  }

  console.log("");
  console.log(`Import scripts scanned: ${files.length}`);
  console.log(`Updated: ${changed}`);
  console.log(`Already updated: ${alreadyUpdated}`);
  console.log(`Skipped: ${skipped}`);
}

main();