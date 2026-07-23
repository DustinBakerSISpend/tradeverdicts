import { readFile } from "node:fs/promises";

const teamsUrl = new URL("../../data/nba/teams.json", import.meta.url);

export async function loadNbaTeams() {
  const text = (await readFile(teamsUrl, "utf8")).replace(/^\uFEFF/, "");
  const teams = JSON.parse(text);

  if (!Array.isArray(teams)) {
    throw new TypeError("NBA team registry must be a JSON array.");
  }

  return teams;
}

export function createNbaTeamRegistry(teams) {
  if (!Array.isArray(teams)) {
    throw new TypeError("createNbaTeamRegistry requires an array.");
  }

  const bySlug = new Map();
  const byAbbreviation = new Map();

  for (const team of teams) {
    if (!team || typeof team !== "object") {
      throw new TypeError("Every NBA team entry must be an object.");
    }

    const slug = String(team.slug ?? "").trim();
    const abbreviation = String(team.abbreviation ?? "").trim().toUpperCase();

    if (!slug || !abbreviation) {
      throw new Error("Every NBA team requires a slug and abbreviation.");
    }

    if (bySlug.has(slug)) {
      throw new Error(`Duplicate NBA team slug: ${slug}`);
    }

    if (byAbbreviation.has(abbreviation)) {
      throw new Error(`Duplicate NBA abbreviation: ${abbreviation}`);
    }

    bySlug.set(slug, Object.freeze({ ...team, abbreviation }));
    byAbbreviation.set(abbreviation, bySlug.get(slug));
  }

  return Object.freeze({
    teams: Object.freeze([...bySlug.values()]),
    bySlug,
    byAbbreviation,
    hasSlug(slug) {
      return bySlug.has(String(slug ?? "").trim());
    },
    getBySlug(slug) {
      return bySlug.get(String(slug ?? "").trim()) ?? null;
    },
    getByAbbreviation(abbreviation) {
      return byAbbreviation.get(
        String(abbreviation ?? "").trim().toUpperCase(),
      ) ?? null;
    },
  });
}
