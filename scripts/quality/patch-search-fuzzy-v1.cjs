const fs = require("fs");

const file = "src/pages/search.astro";
let s = fs.readFileSync(file, "utf8");

const start = s.indexOf("<script is:inline>");
const end = s.indexOf("</script>", start);

if (start < 0 || end < 0) {
  throw new Error("Could not find inline search script.");
}

const pre = s.slice(0, start);
let body = s.slice(start, end);
const post = s.slice(end);

const fuzzyBlock = `    function normalizeBasic(value) {
      return String(value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .replace(/[’']/g, "")
        .replace(/\\bj\\s+j\\b/g, "jj")
        .replace(/\\ba\\s+j\\b/g, "aj")
        .replace(/\\bc\\s+j\\b/g, "cj")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
    }

    function normalize(value) {
      return normalizeBasic(value);
    }

    const franchiseAliases = [
      ["washington redskins", "washington commanders"],
      ["washington football team", "washington commanders"],
      ["redskins", "washington commanders"],
      ["oakland raiders", "las vegas raiders"],
      ["los angeles raiders", "las vegas raiders"],
      ["st louis rams", "los angeles rams"],
      ["saint louis rams", "los angeles rams"],
      ["cleveland rams", "los angeles rams"],
      ["san diego chargers", "los angeles chargers"],
      ["houston oilers", "tennessee titans"],
      ["tennessee oilers", "tennessee titans"],
      ["baltimore colts", "indianapolis colts"],
      ["boston patriots", "new england patriots"],
      ["phoenix cardinals", "arizona cardinals"],
      ["st louis cardinals", "arizona cardinals"],
      ["new york titans", "new york jets"],
      ["vikes", "minnesota vikings"],
      ["niners", "san francisco 49ers"],
      ["bucs", "tampa bay buccaneers"],
      ["jags", "jacksonville jaguars"],
      ["pats", "new england patriots"]
    ];

    function unique(values) {
      return [...new Set(values.filter(Boolean))];
    }

    function queryVariants(value) {
      const base = normalizeBasic(value);
      if (!base) return [""];

      const variants = [base];

      franchiseAliases.forEach(([alias, canonical]) => {
        const a = normalizeBasic(alias);
        const c = normalizeBasic(canonical);
        const nick = c.split(" ").at(-1);

        if (base.includes(a)) {
          variants.push(base.replace(a, c));
          variants.push(base.replace(a, nick));
          variants.push(c);
          variants.push(nick);
        }
      });

      return unique(variants.map(normalizeBasic));
    }

    function editDistance(a, b) {
      a = String(a || "");
      b = String(b || "");

      if (a === b) return 0;
      if (!a || !b) return Math.max(a.length, b.length);
      if (Math.abs(a.length - b.length) > 3) return 99;

      const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

      for (let i = 0; i <= a.length; i++) dp[i][0] = i;
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;

      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + cost
          );
        }
      }

      return dp[a.length][b.length];
    }

    function tokenMatches(sourceTokens, sourceCompact, token) {
      if (!token) return true;
      if (sourceTokens.includes(token)) return true;

      const tokenCompact = token.replace(/\\s+/g, "");
      if (tokenCompact.length >= 2 && sourceCompact.includes(tokenCompact)) return true;

      if (token.length <= 2) return false;

      return sourceTokens.some((candidate) => {
        if (!candidate) return false;

        if (candidate.includes(token) || token.includes(candidate)) {
          return Math.min(candidate.length, token.length) >= 4;
        }

        const maxDistance = token.length >= 9 ? 2 : token.length >= 6 ? 1 : 0;
        return maxDistance > 0 && editDistance(candidate, token) <= maxDistance;
      });
    }

    function sourceMatchesQuery(source, term) {
      if (!clean(term)) return true;

      const sourceNorm = normalizeBasic(source);
      const sourceTokens = sourceNorm.split(/\\s+/).filter(Boolean);
      const sourceCompact = sourceTokens.join("");

      return queryVariants(term).some((variant) => {
        if (!variant) return true;
        if (sourceNorm.includes(variant)) return true;

        const tokens = variant
          .split(/\\s+/)
          .filter(Boolean)
          .filter((token) => !["the", "a", "an", "and", "or", "to", "for", "of", "in", "on"].includes(token));

        return tokens.length > 0 && tokens.every((token) => tokenMatches(sourceTokens, sourceCompact, token));
      });
    }

    function monthNumber`;

body = body.replace(
  /    function normalize\(value\) \{[\s\S]*?\n    \}\n\n    function monthNumber/,
  fuzzyBlock
);

body = body.replace(
  /    function includesTerm\(source, term\) \{[\s\S]*?\n    \}\n/,
  `    function includesTerm(source, term) {
      return sourceMatchesQuery(source, term);
    }
`
);

if (!body.includes("function sourceMatchesQuery")) {
  throw new Error("Fuzzy helper insert failed.");
}

if (!body.includes("return sourceMatchesQuery(source, term);")) {
  throw new Error("includesTerm replacement failed.");
}

fs.writeFileSync(file, pre + body + post);
console.log("Patched fuzzy search in src/pages/search.astro");
