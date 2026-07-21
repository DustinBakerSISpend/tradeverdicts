import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const validSlugPattern =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const placeholderAssetPattern =
  /^(?:n\/?a|none|unknown|tbd|placeholder|not available|no asset listed(?: in raw source)?|asset unavailable)$/i;

const copyReasonCodes = new Set([
  "analysis-below-300",
  "generic-analysis",
  "exact-duplicate-analysis",
]);

const structuralReasonCodes = new Set([
  "malformed-or-composite-team",
  "missing-team-assets",
  "missing-team-grade",
  "extra-asset-team",
  "extra-grade-team",
]);

const uniqueSorted = (values) =>
  [...new Set(values)].sort();

const sortedKeys = (value) =>
  Object.keys(value || {}).sort();

const sameStringSet = (left, right) =>
  JSON.stringify(
    uniqueSorted(left)
  ) ===
  JSON.stringify(
    uniqueSorted(right)
  );

const flattenStrings = (value) => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(flattenStrings);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.values(value)
      .flatMap(flattenStrings);
  }

  return [];
};

const usableAsset = (item) => {
  if (
    !item ||
    typeof item !== "object"
  ) {
    return false;
  }

  const asset = String(
    item.asset || ""
  ).trim();

  return (
    asset.length > 0 &&
    !placeholderAssetPattern.test(asset)
  );
};

const getPerspectiveIssues = (trade) => {
  const issues = [];
  const grades = trade.grades || {};
  const perspectives =
    Array.isArray(trade.perspectives)
      ? trade.perspectives
      : [];

  perspectives.forEach(
    (perspective, index) => {
      const number = index + 1;
      const primaryTeam =
        perspective.primaryTeam;
      const partnerTeam =
        perspective.partnerTeam;

      if (
        !primaryTeam ||
        !(primaryTeam in grades)
      ) {
        issues.push(
          `${number}:invalid-primary-team`
        );
      }

      if (
        !partnerTeam ||
        !(partnerTeam in grades)
      ) {
        issues.push(
          `${number}:invalid-partner-team`
        );
      }

      if (
        perspective.primaryGrade !==
        grades[primaryTeam]
      ) {
        issues.push(
          `${number}:primary-grade-mismatch`
        );
      }

      if (
        perspective.partnerGrade !==
        grades[partnerTeam]
      ) {
        issues.push(
          `${number}:partner-grade-mismatch`
        );
      }

      if (
        perspective.verdict !==
        trade.verdict
      ) {
        issues.push(
          `${number}:verdict-mismatch`
        );
      }
    }
  );

  return uniqueSorted(issues);
};

export async function validateStrictPublicRecords({
  repo,
  tradesFile,
} = {}) {
  const resolvedRepo =
    path.resolve(repo || process.cwd());
  const resolvedTradesFile =
    path.resolve(
      tradesFile ||
      path.join(
        resolvedRepo,
        "src",
        "data",
        "nfl",
        "trades.json"
      )
    );

  const importFromRepo = async (
    relativePath
  ) =>
    import(
      pathToFileURL(
        path.join(
          resolvedRepo,
          relativePath
        )
      ).href
    );

  const eligibilityModule =
    await importFromRepo(
      "src/utils/eligibility.js"
    );
  const publicRecordsModule =
    await importFromRepo(
      "src/utils/publicRecords.js"
    );
  const marqueeModule =
    await importFromRepo(
      "src/utils/marqueeTradeSlugs.js"
    );
  const adsModule =
    await importFromRepo(
      "src/config/ads.js"
    );

  const {
    createEligibilityContext,
    getTradeEligibility,
  } = eligibilityModule;
  const {
    getPublicTrades,
  } = publicRecordsModule;
  const {
    ADS_SERVING_ENABLED,
  } = adsModule;

  const marqueeSlugs = new Set(
    flattenStrings(marqueeModule)
      .filter((value) =>
        validSlugPattern.test(value)
      )
  );

  const trades = JSON.parse(
    fs
      .readFileSync(
        resolvedTradesFile,
        "utf8"
      )
      .replace(/^\uFEFF/, "")
  );

  const context =
    createEligibilityContext(trades);
  const slugCounts = new Map();

  for (const trade of trades) {
    const slug = String(
      trade.slug || ""
    );

    slugCounts.set(
      slug,
      (slugCounts.get(slug) || 0) + 1
    );
  }

  const strictFailures = [];
  const archivePolicyViolations = [];
  const approvedExceptions = [];

  let indexEligibleTrades = 0;
  let adEligibleTrades = 0;
  let factualArchiveRecords = 0;

  for (
    let sourceIndex = 0;
    sourceIndex < trades.length;
    sourceIndex += 1
  ) {
    const trade = trades[sourceIndex];
    const eligibility =
      getTradeEligibility(
        trade,
        context
      );
    const slug = String(
      trade.slug || ""
    );
    const archiveReasons =
      uniqueSorted(
        eligibility.archiveReasons || []
      );
    const gradeTeams =
      sortedKeys(trade.grades);
    const assetTeams =
      sortedKeys(
        trade.assetsReceived
      );
    const perspectiveCount =
      Array.isArray(
        trade.perspectives
      )
        ? trade.perspectives.length
        : 0;
    const perspectiveIssues =
      getPerspectiveIssues(trade);
    const copyReasons =
      archiveReasons.filter(
        (reason) =>
          copyReasonCodes.has(reason)
      );
    const structuralReasons =
      archiveReasons.filter(
        (reason) =>
          structuralReasonCodes.has(
            reason
          )
      );
    const missingAssetTeams =
      gradeTeams.filter((team) => {
        const items =
          trade.assetsReceived?.[team];

        return (
          !Array.isArray(items) ||
          items.length === 0 ||
          !items.some(usableAsset)
        );
      });
    const placeholderAssets = [];

    for (
      const [team, items] of
      Object.entries(
        trade.assetsReceived || {}
      )
    ) {
      if (!Array.isArray(items)) {
        placeholderAssets.push(
          `${team}:non-array`
        );
        continue;
      }

      items.forEach(
        (item, index) => {
          if (!usableAsset(item)) {
            placeholderAssets.push(
              `${team}:${index + 1}`
            );
          }
        }
      );
    }

    const approvedPerspectiveException =
      eligibility.classification ===
        "editorial-verdict" &&
      archiveReasons.includes(
        "insufficient-perspectives"
      ) &&
      marqueeSlugs.has(slug);

    const approvedHistoricalException =
      eligibility.classification ===
        "editorial-verdict" &&
      archiveReasons.includes(
        "historically-incomplete-consideration"
      ) &&
      marqueeSlugs.has(slug);

    if (
      approvedPerspectiveException ||
      approvedHistoricalException
    ) {
      approvedExceptions.push({
        sourceIndex,
        slug,
        approvedPerspectiveException,
        approvedHistoricalException,
        archiveReasons,
      });
    }

    if (
      eligibility.indexEligible === true
    ) {
      indexEligibleTrades += 1;
      const issues = [];

      if (
        !validSlugPattern.test(slug)
      ) {
        issues.push(
          "invalid-canonical-slug"
        );
      }

      if (
        (slugCounts.get(slug) || 0) !==
        1
      ) {
        issues.push(
          "non-unique-canonical-slug"
        );
      }

      if (
        eligibility.publicRoute !== true
      ) {
        issues.push(
          "indexable-without-public-route"
        );
      }

      if (gradeTeams.length < 2) {
        issues.push(
          "fewer-than-two-graded-teams"
        );
      }

      if (
        !sameStringSet(
          gradeTeams,
          assetTeams
        ) &&
        !approvedHistoricalException
      ) {
        issues.push(
          "grade-asset-team-set-mismatch"
        );
      }

      if (
        missingAssetTeams.length > 0 &&
        !approvedHistoricalException
      ) {
        issues.push(
          "missing-usable-team-assets"
        );
      }

      if (
        placeholderAssets.length > 0 &&
        !approvedHistoricalException
      ) {
        issues.push(
          "placeholder-or-invalid-asset"
        );
      }

      if (
        !String(
          trade.verdict || ""
        ).trim()
      ) {
        issues.push(
          "missing-verdict"
        );
      }

      if (
        !String(
          trade.analysis || ""
        ).trim()
      ) {
        issues.push(
          "missing-analysis"
        );
      }

      if (copyReasons.length > 0) {
        issues.push(
          "editorial-copy-defect"
        );
      }

      if (
        perspectiveCount < 2 &&
        !approvedPerspectiveException
      ) {
        issues.push(
          "insufficient-perspectives"
        );
      }

      if (
        perspectiveIssues.length > 0
      ) {
        issues.push(
          "grade-verdict-perspective-mismatch"
        );
      }

      if (
        structuralReasons.length > 0 &&
        !approvedHistoricalException
      ) {
        issues.push(
          "structural-reason-code-present"
        );
      }

      if (issues.length > 0) {
        strictFailures.push({
          sourceIndex,
          id:
            trade.id || "",
          slug,
          classification:
            eligibility.classification,
          validationStatus:
            eligibility.validationStatus,
          issues:
            uniqueSorted(issues),
          perspectiveIssues,
          archiveReasons,
          gradeTeams,
          assetTeams,
          missingAssetTeams,
          placeholderAssets,
        });
      }
    }

    if (
      eligibility.adEligible === true
    ) {
      adEligibleTrades += 1;
    }

    if (
      eligibility.classification ===
      "factual-archive"
    ) {
      factualArchiveRecords += 1;

      if (
        eligibility.indexEligible !==
          false ||
        eligibility.adEligible !== false
      ) {
        archivePolicyViolations.push({
          sourceIndex,
          id:
            trade.id || "",
          slug,
          indexEligible:
            eligibility.indexEligible,
          adEligible:
            eligibility.adEligible,
          archiveReasons,
        });
      }
    }
  }

  const publicTradeRoutes =
    getPublicTrades(trades).length;
  const errors = [
    ...strictFailures.map(
      (row) => ({
        category:
          "strict-indexable-record",
        slug:
          row.slug,
        issues:
          row.issues,
      })
    ),
    ...archivePolicyViolations.map(
      (row) => ({
        category:
          "archive-policy",
        slug:
          row.slug,
        issues: [
          "factual-archive-index-or-ad-eligible",
        ],
      })
    ),
  ];

  return {
    generatedAt:
      new Date().toISOString(),
    status:
      errors.length === 0
        ? "PASSED"
        : "FAILED",
    counts: {
      tradeRecords:
        trades.length,
      publicTradeRoutes,
      indexEligibleTrades,
      adEligibleTrades,
      factualArchiveRecords,
      strictIndexableFailures:
        strictFailures.length,
      archivePolicyViolations:
        archivePolicyViolations.length,
      approvedEditorialExceptions:
        approvedExceptions.length,
    },
    policy: {
      adsServingEnabled:
        ADS_SERVING_ENABLED,
      strictValidationScope:
        "index-eligible editorial trade records",
      factualArchivePolicy:
        "public routes may remain available only while noindex and ad-free",
    },
    strictFailures,
    archivePolicyViolations,
    approvedExceptions,
    errors,
  };
}

const parseArgs = (argv) => {
  const parsed = {
    repo:
      process.cwd(),
    tradesFile:
      "",
    output:
      "",
  };

  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const value = argv[index];

    if (
      value === "--repo" &&
      argv[index + 1]
    ) {
      parsed.repo =
        argv[index + 1];
      index += 1;
      continue;
    }

    if (
      value === "--trades-file" &&
      argv[index + 1]
    ) {
      parsed.tradesFile =
        argv[index + 1];
      index += 1;
      continue;
    }

    if (
      value === "--output" &&
      argv[index + 1]
    ) {
      parsed.output =
        argv[index + 1];
      index += 1;
    }
  }

  return parsed;
};

const isMain =
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(
      path.resolve(process.argv[1])
    ).href;

if (isMain) {
  const args = parseArgs(
    process.argv.slice(2)
  );
  const result =
    await validateStrictPublicRecords({
      repo:
        args.repo,
      tradesFile:
        args.tradesFile || undefined,
    });
  const rendered =
    `${JSON.stringify(
      result,
      null,
      2
    )}\n`;

  if (args.output) {
    fs.writeFileSync(
      path.resolve(args.output),
      rendered,
      "utf8"
    );
  }

  process.stdout.write(rendered);

  if (result.status !== "PASSED") {
    process.exitCode = 1;
  }
}
