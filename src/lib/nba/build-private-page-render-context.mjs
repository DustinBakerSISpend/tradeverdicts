const clean = (value = "") => String(value ?? "").trim();

const normalizedKey = (value = "") => clean(value).toLowerCase();

const assetText = (asset) =>
  clean(
    asset?.displayText ??
      asset?.asset ??
      asset?.playerName ??
      asset?.becamePlayerName ??
      asset?.description ??
      "",
  );

const isSecondaryAsset = (asset) => {
  const type = normalizedKey(asset?.type).replaceAll("-", "_");
  const text = normalizedKey(assetText(asset));

  return (
    [
      "cash",
      "trade_exception",
      "future_consideration",
      "future_considerations",
    ].includes(type) ||
    /\bcash\b|trade exception|future considerations?/u.test(text)
  );
};

const recipientKey = (asset) =>
  clean(
    asset?.toTeam ??
      asset?.destination ??
      asset?.recipient ??
      asset?.team ??
      "",
  );

const compactAssets = (assets = [], limit = 2) => {
  const rows = Array.isArray(assets) ? assets : [];
  const substantive = rows.filter((asset) => !isSecondaryAsset(asset));
  const pool = substantive.length ? substantive : rows;
  const seen = new Set();
  const labels = [];

  for (const asset of pool) {
    const text = assetText(asset);
    const key = normalizedKey(text);

    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(text);
  }

  if (!labels.length) return "";

  const visible = labels.slice(0, limit);
  const remaining = labels.length - visible.length;

  return `${visible.join(" + ")}${remaining > 0 ? ` + ${remaining} more` : ""}`;
};

const mainAssetsForTrade = (trade, model) => {
  const ledger = Array.isArray(trade?.assetLedger)
    ? trade.assetLedger
    : [];

  if (!ledger.length) return "";

  const teamNameBySlug = new Map(
    (Array.isArray(model?.teams) ? model.teams : []).map((team) => [
      clean(team?.slug),
      clean(team?.name) || clean(team?.slug),
    ]),
  );

  const grouped = new Map();
  const unscoped = [];

  for (const asset of ledger) {
    const text = assetText(asset);
    if (!text) continue;

    const recipient = recipientKey(asset);

    if (!recipient) {
      unscoped.push(asset);
      continue;
    }

    if (!grouped.has(recipient)) grouped.set(recipient, []);
    grouped.get(recipient).push(asset);
  }

  const sourceTeamOrder = Array.isArray(trade?.teams)
    ? trade.teams.map(clean).filter(Boolean)
    : [];

  const recipientOrder = [
    ...sourceTeamOrder.filter((team) => grouped.has(team)),
    ...[...grouped.keys()].filter((team) => !sourceTeamOrder.includes(team)),
  ];

  const groupSummaries = recipientOrder
    .map((team) => ({
      team,
      label: teamNameBySlug.get(team) || team,
      assets: compactAssets(grouped.get(team)),
    }))
    .filter((entry) => entry.assets);

  if (groupSummaries.length === 2) {
    return `${groupSummaries[0].assets} ↔ ${groupSummaries[1].assets}`;
  }

  if (groupSummaries.length > 2) {
    return groupSummaries
      .map((entry) => `${entry.label}: ${entry.assets}`)
      .join(" • ");
  }

  if (groupSummaries.length === 1) {
    const extra = compactAssets(unscoped);
    return extra
      ? `${groupSummaries[0].assets} ↔ ${extra}`
      : groupSummaries[0].assets;
  }

  return compactAssets(unscoped.length ? unscoped : ledger, 4);
};

const tradeSlugFromPath = (pathValue = "") => {
  const parts = clean(pathValue).split("/").filter(Boolean);
  return parts.length >= 3 && parts[0] === "nba" && parts[1] === "trades"
    ? parts.at(-1)
    : "";
};

export function buildPrivatePageRenderContext(models = [], trades = []) {
  if (!Array.isArray(models)) {
    throw new TypeError("Private page render context requires a route-model array.");
  }

  if (!Array.isArray(trades)) {
    throw new TypeError("Private page render context requires a trade array.");
  }

  const modelByPath = new Map(
    models.map((entry) => [
      entry.path,
      entry,
    ]),
  );

  const titleByPath = new Map(
    models.map((entry) => [
      entry.path,
      entry.title,
    ]),
  );

  const tradeBySlug = new Map(
    trades
      .map((trade) => [clean(trade?.slug), trade])
      .filter(([slug]) => slug),
  );

  const tradeMetaByPath = new Map(
    models
      .filter((entry) => entry.routeType === "trade_detail")
      .map((entry) => {
        const slug = tradeSlugFromPath(entry.path);
        const trade = tradeBySlug.get(slug);

        return [
          entry.path,
          {
            tradeDate: clean(entry?.tradeDate ?? trade?.tradeDate ?? trade?.date),
            mainAssets: trade ? mainAssetsForTrade(trade, entry) : "",
          },
        ];
      }),
  );

  const searchTextByPath = new Map(
    models
      .filter((entry) => entry.routeType === "trade_detail")
      .map((entry) => [
        entry.path,
        [
          entry.title,
          entry.description,
          entry.tradeDate,
          entry.verdict,
          entry.sourceTradeId,
          tradeMetaByPath.get(entry.path)?.mainAssets,
          ...(Array.isArray(entry.teams)
            ? entry.teams.flatMap((team) => [
                team.name,
                team.abbreviation,
                team.slug,
              ])
            : []),
          ...(Array.isArray(entry.players)
            ? entry.players.flatMap((player) => [
                player.name,
                ...(Array.isArray(player.aliases)
                  ? player.aliases
                  : []),
              ])
            : []),
        ]
          .filter(Boolean)
          .join(" "),
      ]),
  );

  const renderLinks = (model) => {
    const sourceLinks = Array.isArray(model?.links)
      ? model.links
      : [];

    const orderedLinks = sourceLinks
      .map((entry, originalIndex) => {
        const linkedModel = modelByPath.get(entry.path);
        const tradeMeta = tradeMetaByPath.get(entry.path);

        return {
          entry,
          originalIndex,
          linkedModel,
          isTrade: linkedModel?.routeType === "trade_detail",
          tradeDate: clean(tradeMeta?.tradeDate ?? linkedModel?.tradeDate),
        };
      })
      .sort((left, right) => {
        if (left.isTrade && right.isTrade) {
          return (
            right.tradeDate.localeCompare(left.tradeDate) ||
            String(left.linkedModel?.title ?? "").localeCompare(
              String(right.linkedModel?.title ?? ""),
            ) ||
            left.originalIndex - right.originalIndex
          );
        }

        if (left.isTrade !== right.isTrade) {
          return left.isTrade ? -1 : 1;
        }

        return left.originalIndex - right.originalIndex;
      })
      .map(({ entry }) => entry);

    return orderedLinks.map((entry) => {
      const tradeMeta = tradeMetaByPath.get(entry.path);

      return {
        ...entry,
        title: titleByPath.get(entry.path) ?? entry.path,
        tradeDate: tradeMeta?.tradeDate ?? "",
        mainAssets: tradeMeta?.mainAssets ?? "",
        searchableText: searchTextByPath.get(entry.path) ?? "",
      };
    });
  };

  return {
    renderLinks,
    counts: {
      models: models.length,
      titles: titleByPath.size,
      searchableTrades: searchTextByPath.size,
      tradeMetadata: tradeMetaByPath.size,
      tradeCardsWithMainAssets: [...tradeMetaByPath.values()].filter(
        (entry) => entry.mainAssets,
      ).length,
    },
  };
}
