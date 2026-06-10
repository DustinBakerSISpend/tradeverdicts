const GRADE_POINTS = {
  "A+": 12,
  "A": 11,
  "A-": 10,
  "B+": 9,
  "B": 8,
  "B-": 7,
  "C+": 6,
  "C": 5,
  "C-": 4,
  "D+": 3,
  "D": 2,
  "D-": 1,
  "F": 0
};

export function gradeValue(grade) {
  const clean = String(grade || "").trim();
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, clean)
    ? GRADE_POINTS[clean]
    : null;
}

export function getTeamTradeOutcome(trade, teamSlug) {
  const grades = trade?.grades || {};
  const teamGrade = gradeValue(grades[teamSlug]);

  if (teamGrade === null) return "unknown";

  const opponentGrades = Object.entries(grades)
    .filter(([slug]) => slug !== teamSlug)
    .map(([, grade]) => gradeValue(grade))
    .filter((value) => value !== null);

  if (!opponentGrades.length) return "unknown";

  const bestOpponentGrade = Math.max(...opponentGrades);

  if (teamGrade > bestOpponentGrade) return "win";
  if (teamGrade < bestOpponentGrade) return "loss";
  return "even";
}

export function getTeamStats(trades, teamSlug) {
  const teamTrades = trades
    .filter((trade) => trade.publishStatus !== "hold-conflict")
    .filter((trade) => trade.teams?.includes(teamSlug));

  let wins = 0;
  let losses = 0;
  let even = 0;
  let unknown = 0;

  for (const trade of teamTrades) {
    const outcome = getTeamTradeOutcome(trade, teamSlug);

    if (outcome === "win") wins += 1;
    else if (outcome === "loss") losses += 1;
    else if (outcome === "even") even += 1;
    else unknown += 1;
  }

  return {
    total: teamTrades.length,
    wins,
    losses,
    even,
    unknown
  };
}
