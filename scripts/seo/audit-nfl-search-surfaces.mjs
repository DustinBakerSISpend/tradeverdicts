import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const dist=path.join(repo,"dist");
const site="https://tradeverdicts.com";
const eligibility=await import(pathToFileURL(path.join(repo,"src/utils/eligibility.js")).href);
const publicRecords=await import(pathToFileURL(path.join(repo,"src/utils/publicRecords.js")).href);
const playerEligibility=await import(pathToFileURL(path.join(repo,"src/utils/playerEligibility.js")).href);
const teamPairs=await import(pathToFileURL(path.join(repo,"src/utils/teamPairHistory.js")).href);
const teamRegistry=await import(pathToFileURL(path.join(repo,"src/utils/teamRegistry.js")).href);

const trades=JSON.parse(fs.readFileSync(path.join(repo,"src/data/nfl/trades.json"),"utf8").replace(/^\uFEFF/,""));
const players=JSON.parse(fs.readFileSync(path.join(repo,"src/data/nfl/players.json"),"utf8").replace(/^\uFEFF/,""));
const tc=eligibility.createEligibilityContext(trades);
const publicTrades=publicRecords.getPublicTrades(trades);
const publicPlayers=publicRecords.getPublicPlayerRecords(players,publicTrades);
const pc=playerEligibility.createPlayerEligibilityContext(publicPlayers,publicTrades,tc);

const groups={
 trades: publicTrades.filter(t=>eligibility.getTradeEligibility(t,tc).indexEligible).map(t=>"/trades/"+t.slug+"/"),
 players: playerEligibility.getIndexEligiblePlayers(publicPlayers,publicTrades,pc).map(p=>"/players/"+p.slug+"/"),
 teams: teamRegistry.CURRENT_NFL_TEAM_SLUGS.map(slug=>"/teams/"+slug+"/"),
 pairs: teamPairs.getTeamPairEntries(publicTrades).map(x=>x.path),
};
const heldPlayers=publicPlayers.filter(p=>!playerEligibility.getPlayerEligibility(p,publicTrades,pc).indexEligible);
const sitemapFiles={
 trades:"sitemap-nfl-trades.xml",
 players:"sitemap-nfl-players.xml",
 teams:"sitemap-nfl-teams.xml",
 pairs:"sitemap-nfl-team-pairs.xml",
};
const sitemapText=Object.fromEntries(Object.entries(sitemapFiles).map(([k,name])=>[k,fs.readFileSync(path.join(dist,name),"utf8")]));
const genericText=fs.readdirSync(dist).filter(n=>/^sitemap-\d+\.xml$/i.test(n)).map(n=>fs.readFileSync(path.join(dist,n),"utf8")).join("\n");
const indexXml=fs.readFileSync(path.join(dist,"sitemap-index.xml"),"utf8");
const robots=fs.readFileSync(path.join(dist,"robots.txt"),"utf8");
const errors=[];
const titleOwners=new Map();

const htmlFor=route=>{
  const file=path.join(dist,...route.split("/").filter(Boolean),"index.html");
  if(!fs.existsSync(file)){errors.push({route,issue:"missing-built-html"});return null;}
  return fs.readFileSync(file,"utf8");
};
const attr=(tag,name)=>{
  const m=tag.match(new RegExp(name+'=["\\\']([^"\\\']+)["\\\']',"i"));
  return m?m[1]:"";
};
const metadata=html=>{
  const title=(html.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||"";
  const h1=((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  const canonicalTag=(html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)||html.match(/<link[^>]+href=["'][^"']+["'][^>]+rel=["']canonical["'][^>]*>/i)||[])[0]||"";
  const robotsTag=(html.match(/<meta[^>]+name=["']robots["'][^>]*>/i)||html.match(/<meta[^>]+content=["'][^"']+["'][^>]+name=["']robots["'][^>]*>/i)||[])[0]||"";
  return {title:title.trim(),h1,canonical:attr(canonicalTag,"href"),robots:attr(robotsTag,"content").toLowerCase()};
};
for(const [kind,routes] of Object.entries(groups)){
  for(const route of routes){
    const html=htmlFor(route); if(!html) continue;
    const meta=metadata(html);
    const url=site+route;
    if(!meta.robots.includes("index")) errors.push({route,issue:"indexable-route-missing-index-robots",robots:meta.robots});
    if(meta.robots.includes("noindex")) errors.push({route,issue:"indexable-route-has-noindex",robots:meta.robots});
    if(meta.canonical!==url) errors.push({route,issue:"canonical-mismatch",canonical:meta.canonical,expected:url});
    if(!meta.title) errors.push({route,issue:"missing-title"});
    if(!meta.h1) errors.push({route,issue:"missing-h1"});
    if(!sitemapText[kind].includes("<loc>"+url+"</loc>")) errors.push({route,issue:"missing-dedicated-sitemap",kind});
    if(genericText.includes("<loc>"+url+"</loc>")) errors.push({route,issue:"duplicate-in-generic-sitemap",kind});
    if(meta.title){const owners=titleOwners.get(meta.title)||[]; owners.push(route); titleOwners.set(meta.title,owners);}
  }
}
for(const player of heldPlayers){
  const route="/players/"+player.slug+"/";
  const html=htmlFor(route); if(!html) continue;
  const meta=metadata(html);
  const url=site+route;
  if(!meta.robots.includes("noindex")) errors.push({route,issue:"held-player-not-noindex",robots:meta.robots});
  if(sitemapText.players.includes("<loc>"+url+"</loc>")) errors.push({route,issue:"held-player-in-player-sitemap"});
}
const duplicateTitles=[...titleOwners.entries()].filter(([,owners])=>owners.length>1).map(([title,owners])=>({title,owners}));
for(const row of duplicateTitles) errors.push({issue:"duplicate-indexable-title",...row});

for(const name of Object.values(sitemapFiles)){
  const loc=site+"/"+name;
  if(!indexXml.includes("<loc>"+loc+"</loc>")) errors.push({issue:"dedicated-sitemap-missing-from-index",loc});
}
if(!/User-agent:\s*Googlebot[\s\S]*?Allow:\s*\//i.test(robots)) errors.push({issue:"googlebot-not-explicitly-allowed"});
if(!robots.includes("Sitemap: "+site+"/sitemap-index.xml")) errors.push({issue:"robots-missing-sitemap-index"});

for(const route of ["/trades/","/players/","/teams/"]){
  const html=htmlFor(route); if(!html) continue;
  const meta=metadata(html);
  if(meta.robots.includes("noindex")||!meta.robots.includes("index")) errors.push({route,issue:"hub-not-indexable",robots:meta.robots});
  if(meta.canonical!==site+route) errors.push({route,issue:"hub-canonical-mismatch",canonical:meta.canonical});
  if(!genericText.includes("<loc>"+site+route+"</loc>")) errors.push({route,issue:"hub-missing-generic-sitemap"});
}

const result={
 status:errors.length?"FAILED":"PASSED",
 counts:{trades:groups.trades.length,players:groups.players.length,teams:groups.teams.length,teamPairs:groups.pairs.length,heldPlayers:heldPlayers.length},
 duplicateTitleCount:duplicateTitles.length,
 errors,
};
fs.writeFileSync(path.join(dist,"nfl-search-surface-audit.json"),JSON.stringify(result,null,2)+"\n","utf8");
console.log(JSON.stringify({...result,errors:errors.slice(0,50)},null,2));
process.exitCode=errors.length?1:0;
