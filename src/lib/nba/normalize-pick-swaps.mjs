function resolveTeamLabel(resolver, label) {
  const normalized = String(label ?? "").trim();
  if (!normalized) return null;
  return resolver.resolve(normalized);
}

export function enrichNbaPickSwapAsset(asset, resolver) {
  if (!asset || asset.type !== "pick_swap") {
    return { ...asset };
  }

  const enriched = { ...asset };
  const holderMatch = asset.displayText.match(
    /^(.+?)\s+option\s+to\s+swap\b/i,
  );
  const subjectMatch = asset.displayText.match(
    /\bwith\s+([^()]+?)(?=\s*\(|$)/i,
  );

  if (holderMatch) {
    enriched.holderTeam = resolveTeamLabel(resolver, holderMatch[1]);
  }

  if (subjectMatch) {
    enriched.subjectTeam = resolveTeamLabel(resolver, subjectMatch[1]);
  }

  enriched.contractDirectionResolved = Boolean(
    enriched.holderTeam && enriched.subjectTeam,
  );

  return enriched;
}

export function buildNbaPickSwapContracts(record) {
  const contracts = new Map();

  for (const asset of [...record.assetsReceived, ...record.assetsSent]) {
    if (asset.type !== "pick_swap") continue;

    const key = [
      asset.holderTeam ?? "unknown-holder",
      asset.subjectTeam ?? "unknown-subject",
      asset.draftYear ?? "unknown-year",
      asset.round ?? "unknown-round",
      asset.exerciseStatus ?? "unknown",
    ].join("|");

    const representation = {
      direction: asset.direction,
      assetIndex: asset.assetIndex,
      displayText: asset.displayText,
    };

    if (!contracts.has(key)) {
      contracts.set(key, {
        type: "pick_swap_contract",
        contractKey: key,
        holderTeam: asset.holderTeam ?? null,
        subjectTeam: asset.subjectTeam ?? null,
        draftYear: asset.draftYear ?? null,
        round: asset.round ?? null,
        exerciseStatus: asset.exerciseStatus ?? "unknown",
        sourceRepresentations: [representation],
      });
    } else {
      contracts.get(key).sourceRepresentations.push(representation);
    }
  }

  return [...contracts.values()].map((contract) => ({
    ...contract,
    sourceRepresentationCount: contract.sourceRepresentations.length,
    duplicateSourceRepresentation:
      contract.sourceRepresentations.length > 1,
  }));
}
