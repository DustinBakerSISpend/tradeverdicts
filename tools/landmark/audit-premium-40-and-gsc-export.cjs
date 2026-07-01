const fs = require("fs");

const file = "src/data/nfl/trades.json";
const reportFile = "reports/landmark-trades/premium-40-final-audit.json";
const urlFile = "reports/landmark-trades/gsc-priority-premium-40-urls.txt";

const baseUrl = "https://tradeverdicts.com/trades/";

const slugs = [
  "kenny-clark-2026-1st-round-pick-and-a-2027-1st-round-pick-green-bay-packers-2025",
  "herschel-walker-dallas-cowboys-1989",
  "1992-first-round-pick-17-kevin-smith-rey-green-bay-packers-1992",
  "rights-to-john-elway-baltimore-indianapolis-colts-1983",
  "matthew-stafford-detroit-lions-2021",
  "drew-lock-shelby-harris-noah-fant-2022-1st-roun-denver-broncos-2022",
  "myles-garrett-cleveland-browns-2026",
  "panthers-san-francisco-49ers-trade-2022-0092",
  "marshall-faulk-indianapolis-colts-1999",
  "2007-4th-round-pick-110th-overall-new-england-patriots-2007",
  "philip-rivers-2004-3rd-round-pick-65th-overall-nate-kaeding-2005-1st-round-pick",
  "2017-1st-round-pick-27th-overall-tre-davious-white-2017-3rd-round-pick-91st-over",
  "eagles-2018-04-26-baltimore-ravens-0401",
  "2018-1st-round-pick-7th-overall-josh-allen-tampa-bay-buccaneers-2018",
  "2019-1st-round-pick-24th-overall-chicago-bears-2018",
  "deshaun-watson-and-2024-6th-round-pick-203rd-overall-subsequently-traded-will-re",
  "cardinals-2020-03-16-houston-texans-deandre-hopkins-and-2020-4th-round-pick-131st-overall-rasha",
  "johnson-bademosi-texans-2019",
  "eagles-2022-04-28-tennessee-titans-0434",
  "panthers-chicago-bears-trade-2023-0093",
  "2012-1st-round-pick-6th-overall-subsequently-traded-morris-claiborne-2012-2nd-ro",
  "2020-1st-round-pick-20th-overall-los-angeles-st-louis-rams-2019",
  "jamal-adams-new-york-jets-2020",
  "greg-bell-leon-owen-gill-1988-first-round-pick-from-bills-14-gaston-green-1988-f",
  "1999-1st-round-pick-12th-overall-subsequently-traded-cade-mcnown-1999-3rd-round-pick-71st",

  "carson-wentz-philadelphia-eagles-2021",
  "2017-1st-round-pick-3rd-overall-solomon-thomas-2017-3rd-round-pick-chicago-bears-2017",
  "2014-1st-round-pick-26th-overall-subsequently-traded-marcus-smith-baltimore-indi",
  "2007-2nd-round-pick-60th-overall-patriots-2007",
  "1998-1st-round-pick-2nd-overall-ryan-leaf-arizonast-louis-cardinals-1998",
  "1996-2nd-round-pick-59th-overall-ernie-conwell-and-1997-4th-round-pick-121st-ove",
  "steve-young-tampa-bay-buccaneers-1987",
  "roy-williams-and-2009-7th-round-pick-detroit-lions-2008",
  "panthers-buffalo-bills-trade-2017-0061",
  "draft-pick-trade-buffalo-bills-2020",
  "antonio-brown-pittsburgh-steelers-2019",
  "jamie-collins-new-england-patriots-2016-404",

  "1997-1st-round-pick-11th-overall-subsequently-tra-chicago-bears-1997",
  "panthers-cincinnati-bengals-trade-1995-0001",
  "steve-largent-tennessee-titans-houston-oilers-1976"
];

function wc(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

const trades = JSON.parse(fs.readFileSync(file, "utf8"));

const report = slugs.map((slug, index) => {
  const trade = trades.find(t => t.slug === slug);

  if (!trade) {
    return {
      priority: index + 1,
      slug,
      missing: true,
      url: baseUrl + slug + "/",
      needsTopoff: true
    };
  }

  const combined = JSON.stringify({
    summary: trade.summary,
    partnerSummary: trade.partnerSummary,
    analysis: trade.analysis,
    perspectives: trade.perspectives,
    assetsReceived: trade.assetsReceived
  });

  const perspectiveProblems = (trade.perspectives || []).filter(p => {
    return !p.primaryTeam ||
      !p.partnerTeam ||
      !p.verdict ||
      !p.primaryGrade ||
      !p.partnerGrade ||
      p.publishStatus !== "ready";
  });

  const row = {
    priority: index + 1,
    slug,
    url: baseUrl + slug + "/",
    verdict: trade.verdict,
    grades: trade.grades,
    summaryWords: wc(trade.summary),
    partnerSummaryWords: wc(trade.partnerSummary),
    analysisWords: wc(trade.analysis),
    hasFinalVerdict: /Final Verdict/.test(trade.analysis || ""),
    hasStillMattersSection: /Why This Trade Still Matters/.test(trade.analysis || ""),
    weirdCharsFound: /[^\x00-\x7F]/.test(combined),
    perspectiveCount: (trade.perspectives || []).length,
    perspectiveProblemCount: perspectiveProblems.length,
    tier: trade.tier,
    publishStatus: trade.publishStatus
  };

  row.needsTopoff =
    row.summaryWords < 60 ||
    row.partnerSummaryWords < 45 ||
    row.analysisWords < 500 ||
    !row.hasFinalVerdict ||
    !row.hasStillMattersSection ||
    row.weirdCharsFound ||
    row.perspectiveProblemCount > 0;

  return row;
});

const totals = {
  expected: slugs.length,
  found: report.filter(r => !r.missing).length,
  missing: report.filter(r => r.missing).length,
  needsTopoff: report.filter(r => r.needsTopoff).length,
  weirdChars: report.filter(r => r.weirdCharsFound).length,
  missingStillMatters: report.filter(r => !r.missing && !r.hasStillMattersSection).length,
  perspectiveProblemRows: report.filter(r => (r.perspectiveProblemCount || 0) > 0).length
};

fs.mkdirSync("reports/landmark-trades", { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify({ totals, report }, null, 2) + "\n");
fs.writeFileSync(urlFile, report.filter(r => !r.missing).map(r => r.url).join("\n") + "\n");

console.log("PREMIUM 40 FINAL AUDIT");
console.log(totals);
console.table(report.map(r => ({
  slug: r.slug,
  summaryWords: r.summaryWords,
  partnerSummaryWords: r.partnerSummaryWords,
  analysisWords: r.analysisWords,
  final: r.hasFinalVerdict,
  stillMatters: r.hasStillMattersSection,
  weird: r.weirdCharsFound,
  perspectiveProblems: r.perspectiveProblemCount,
  needsTopoff: r.needsTopoff
})));

console.log("Wrote:", reportFile);
console.log("Wrote:", urlFile);
