export function buildPrivatePageRenderContext(models = []) {
  if (!Array.isArray(models)) {
    throw new TypeError("Private page render context requires a route-model array.");
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

    const orderedLinks =
      model?.routeType === "trade_index"
        ? [...sourceLinks].sort((left, right) => {
            const leftModel = modelByPath.get(left.path);
            const rightModel = modelByPath.get(right.path);
            const leftDate = String(leftModel?.tradeDate ?? "");
            const rightDate = String(rightModel?.tradeDate ?? "");

            return (
              rightDate.localeCompare(leftDate) ||
              String(rightModel?.title ?? "").localeCompare(
                String(leftModel?.title ?? ""),
              )
            );
          })
        : sourceLinks;

    return orderedLinks.map((entry) => ({
      ...entry,
      title: titleByPath.get(entry.path) ?? entry.path,
      searchableText:
        searchTextByPath.get(entry.path) ?? "",
    }));
  };

  return {
    renderLinks,
    counts: {
      models: models.length,
      titles: titleByPath.size,
      searchableTrades: searchTextByPath.size,
    },
  };
}