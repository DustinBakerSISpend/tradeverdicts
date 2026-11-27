// Observation only. Returning no response lets Netlify continue its normal request chain.
export const config = {
  pattern: "^/(?:nba/team-to-team-trade-history|players/(?:clifton-geathers|keenan-robinson))/?$",
  method: "GET",
  onError: "bypass",
};

const windowsChrome = /\bWindows NT\s+[\d.]+\b.*\bChrome\/(\d+)(?:\.|\s|$)/i;
const declaredCrawler = /bot\b|crawler|spider|slurp|headlesschrome/i;
const otherChromiumBrowser = /\b(?:Edg|OPR|Vivaldi|YaBrowser)\//i;
const singaporeSourceRange = /^43\.(?:172|173)\.(?:\d{1,3})\.(?:\d{1,3})$/;

export default function monitor(request, context) {
  if (request.method !== "GET") return;

  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const country = context.geo?.country?.code;
  let candidate;

  if (
    country === "SG" &&
    path === "/nba/team-to-team-trade-history" &&
    singaporeSourceRange.test(context.ip ?? "")
  ) {
    candidate = "sg-observed-network-matchup";
  } else if (
    country === "CN" &&
    (path === "/players/clifton-geathers" || path === "/players/keenan-robinson")
  ) {
    candidate = "cn-observed-player-path";
  } else {
    return;
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const chrome = userAgent.match(windowsChrome);
  if (!chrome || declaredCrawler.test(userAgent) || otherChromiumBrowser.test(userAgent)) return;

  try {
    console.log(JSON.stringify({
      event: "BOT-001",
      mode: "monitor-only",
      candidate,
      path,
      chromeMajor: Number(chrome[1]),
      hasReferrer: request.headers.has("referer"),
      userActivated: request.headers.get("sec-fetch-user") === "?1",
    }));
  } catch {
    // A logging failure must never affect a request.
  }
}
