#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEAM="new-orleans-pelicans";
function parseArgs(argv){const a={};for(let i=2;i<argv.length;i+=2){const k=argv[i],v=argv[i+1];if(!k?.startsWith("--")||v===undefined)throw new Error(`Invalid argument near ${k??"<end>"}`);a[k.slice(2)]=v;}return a;}
function assert(v,m){if(!v)throw new Error(m);}
function clean(v){return String(v??"").trim();}
function sha256(v){return createHash("sha256").update(v).digest("hex").toUpperCase();}
function asArrayDocument(raw,p){if(Array.isArray(raw))return raw;if(raw&&Array.isArray(raw[p]))return raw[p];if(raw&&Array.isArray(raw.records))return raw.records;throw new Error(`JSON input does not contain ${p} array.`);}
function tradeId(t){return clean(t?.id??t?.tradeId);}
function playerId(p){return clean(p?.id??p?.playerId??p?.slug??p?.identity?.id);}
function teamSlug(t){return clean(t?.slug??t?.id??t?.teamId);}
function sourcePerspectives(trade,team){
  const p=trade?.perspectives;
  if(Array.isArray(p))return p.filter((x)=>clean(x?.sourceTeam??x?.teamId??x?.team??x?.perspectiveTeam)===team);
  if(p&&typeof p==="object")return Object.prototype.hasOwnProperty.call(p,team)?[p[team]]:[];
  return[];
}
function assertPrivateSafe(record,label){
  if(!record||typeof record!=="object")return;
  assert(record.privateOnly!==false,`${label}: explicitly public privateOnly flag.`);
  assert(record.publishStatus!=="public",`${label}: public publish status.`);
  assert(record.indexEligible!==true,`${label}: index eligibility.`);
  assert(record.adEligible!==true,`${label}: ad eligibility.`);
  assert(record.publicationReady!==true,`${label}: publication readiness.`);
}
function assertPrivateExplicit(record,label){
  assert(record&&typeof record==="object",`${label}: missing record.`);
  assert(record.privateOnly===true,`${label}: privateOnly drifted.`);
  assert(record.publishStatus==="private",`${label}: publishStatus drifted.`);
  assert(record.indexEligible===false,`${label}: indexEligible drifted.`);
  assert(record.adEligible===false,`${label}: adEligible drifted.`);
  assert(record.publicationReady===false,`${label}: publicationReady drifted.`);
}
const ALLOWED=new Set(["referenceTypes","tradeIds","tradeSlugs","relationshipReferences","sourceReferences","privateOnly","updatedAt","publishStatus","indexEligible","adEligible","publicationReady"]);
function coreProjection(p){return Object.fromEntries(Object.entries(p??{}).filter(([k])=>!ALLOWED.has(k)));}
function changedKeys(a,b){return [...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].filter((k)=>JSON.stringify(a?.[k])!==JSON.stringify(b?.[k])).sort();}
function assertStringSuperset(cur,base,label){const c=new Set(Array.isArray(cur)?cur.map(clean):[]);for(const v of Array.isArray(base)?base.map(clean):[])assert(c.has(v),`${label}: baseline value disappeared: ${v}`);}
function assertObjectSuperset(cur,base,label){const c=new Set((Array.isArray(cur)?cur:[]).map((x)=>JSON.stringify(x)));for(const v of Array.isArray(base)?base:[])assert(c.has(JSON.stringify(v)),`${label}: baseline object disappeared.`);}
function countEntries(players,key){return players.reduce((s,p)=>s+(Array.isArray(p?.[key])?p[key].length:0),0);}
async function repoImport(root,rel){return import(pathToFileURL(path.join(root,rel)).href);}

const args=parseArgs(process.argv);
for(const k of ["repo-root","trades-json","players-json","teams-json","receipt-json","output-json","expected-canonical-store-sha256","expected-player-store-sha256","expected-team-store-sha256","baseline-players-json"])assert(args[k],`Missing --${k}`);

const tradeBytes=await readFile(args["trades-json"]),playerBytes=await readFile(args["players-json"]),teamBytes=await readFile(args["teams-json"]),receiptBytes=await readFile(args["receipt-json"]),baselineBytes=await readFile(args["baseline-players-json"]);
assert(sha256(baselineBytes)==="94275A62C1C5A17C3FBD3DBD49AB6E6D22BFA43D6B040518A632BA3069793DA4","Baseline pre-import player store hash drifted.");
assert(sha256(tradeBytes)===args["expected-canonical-store-sha256"],"Canonical store hash drifted.");
assert(sha256(playerBytes)===args["expected-player-store-sha256"],"Player store hash drifted.");
assert(sha256(teamBytes)===args["expected-team-store-sha256"],"Team store hash drifted.");

const trades=asArrayDocument(JSON.parse(tradeBytes.toString("utf8")),"trades");
const players=asArrayDocument(JSON.parse(playerBytes.toString("utf8")),"players");
const teams=asArrayDocument(JSON.parse(teamBytes.toString("utf8")),"teams");
const baselinePlayers=asArrayDocument(JSON.parse(baselineBytes.toString("utf8")),"players");
const receipt=JSON.parse(receiptBytes.toString("utf8"));

assert(receipt.result==="PASS"&&receipt.phase==="21H"&&receipt.team===TEAM,"Receipt metadata invalid.");
for(const [actual,expected,label] of [
  [receipt.readyPackages,78,"ready packages"],[receipt.heldPackages,19,"held packages"],[receipt.structuralEvidenceExclusions,4,"structural exclusions"],
  [receipt.canonicalTradesCreated,39,"canonical creates"],[receipt.perspectivesAppended,39,"perspective appends"],[receipt.playerShellsCreated,18,"player shells"],
  [receipt.readyShellsResolvedToExistingPlayers,0,"resolved existing shells"],[receipt.heldOnlyPlayerShellsDeferred,16,"held-only shells"],
  [receipt.relationshipReferencesAdded,182,"relationship references"],[receipt.heldRelationshipEdgesDeferred,60,"held relationships"],
  [receipt.readyTeamDependencies,166,"ready team dependencies"],[receipt.heldTeamDependencies,49,"held team dependencies"],
  [receipt.existingPerspectiveReviewHolds,0,"existing perspective holds"],[receipt.ambiguousIdentityOccurrencesDeferred,0,"ambiguous identities"],
  [receipt.postImportCanonicalTrades,2326,"post trades"],[receipt.postImportPlayers,3146,"post players"],[receipt.postImportTeams,52,"post teams"]
])assert(Number(actual)===expected,`${label} drifted: ${actual} !== ${expected}.`);

assert(receipt.canonicalTradesCreated+receipt.perspectivesAppended===receipt.readyPackages,"Imported package coverage drifted.");
assert(Object.keys(receipt.explicitPlayerTargetCorrections??{}).length===0,"Unexpected explicit player override.");
assert((receipt.readyShellsResolvedToExistingPlayerIds?.length??0)===0,"Unexpected resolved-existing player ID.");
for(const key of ["automaticIdentityMerges","automaticCanonicalMerges","automaticPlayerCreates","automaticRoutes","automaticTeamRegistrations","heldPackageImports","heldPlayerShellImports","heldRelationshipWrites"])assert(Number(receipt[key])===0,`${key} occurred.`);
assert(receipt.publicationAuthorized===false&&receipt.pushPerformed===false&&receipt.deployPerformed===false,"Safety authorization drifted.");
assert(clean(receipt.canonicalStoreSha256)===args["expected-canonical-store-sha256"],"Receipt canonical hash drifted.");
assert(clean(receipt.playerStoreSha256)===args["expected-player-store-sha256"],"Receipt player hash drifted.");
assert(clean(receipt.teamStoreSha256)===args["expected-team-store-sha256"],"Receipt team hash drifted.");

const tradeMap=new Map(trades.map((t)=>[tradeId(t),t])),playerMap=new Map(players.map((p)=>[playerId(p),p])),baselineMap=new Map(baselinePlayers.map((p)=>[playerId(p),p]));
const teamSet=new Set(teams.map(teamSlug).filter(Boolean));
assert(tradeMap.size===trades.length&&playerMap.size===players.length&&baselineMap.size===baselinePlayers.length&&teamSet.size===teams.length,"Duplicate store identity.");
assert(trades.length===2326&&players.length===3146&&baselinePlayers.length===3128&&teams.length===52,"Store count drifted.");
assert(teamSet.has("new-orleans-pelicans")&&teamSet.has("charlotte-hornets"),"Pelicans/Charlotte registry identity missing.");
assert(teamSet.has("seattle-supersonics")&&teamSet.has("oklahoma-city-thunder"),"Seattle/OKC registry identity missing.");

let changedPlayers=0,relationshipGrowthPlayers=0;
const changedFrequency=new Map();
for(const [id,base] of baselineMap){
  const cur=playerMap.get(id);assert(cur,`Pre-existing player disappeared: ${id}`);
  const keys=changedKeys(base,cur);
  for(const key of keys){assert(ALLOWED.has(key),`Pre-existing player mutated outside allowed contract: ${id} -> ${key}`);changedFrequency.set(key,(changedFrequency.get(key)??0)+1);}
  assert(JSON.stringify(coreProjection(cur))===JSON.stringify(coreProjection(base)),`Pre-existing player immutable core mutated: ${id}`);
  assertStringSuperset(cur.referenceTypes,base.referenceTypes,`${id} referenceTypes`);
  assertStringSuperset(cur.tradeIds,base.tradeIds,`${id} tradeIds`);
  assertStringSuperset(cur.tradeSlugs,base.tradeSlugs,`${id} tradeSlugs`);
  assertObjectSuperset(cur.relationshipReferences,base.relationshipReferences,`${id} relationshipReferences`);
  assertObjectSuperset(cur.sourceReferences,base.sourceReferences,`${id} sourceReferences`);
  if(base.privateOnly===true)assert(cur.privateOnly===true,`Pre-existing player privateOnly weakened: ${id}`);
  const grew=(cur.relationshipReferences?.length??0)>(base.relationshipReferences?.length??0)||(cur.sourceReferences?.length??0)>(base.sourceReferences?.length??0)||(cur.tradeIds?.length??0)>(base.tradeIds?.length??0);
  if(keys.length){changedPlayers+=1;assert(keys.includes("updatedAt"),`Changed player missing updatedAt mutation: ${id}`);}
  if(grew)relationshipGrowthPlayers+=1;
}

const baselineRel=countEntries(baselinePlayers,"relationshipReferences"),postRel=countEntries(players,"relationshipReferences");
const baselineSrc=countEntries(baselinePlayers,"sourceReferences"),postSrc=countEntries(players,"sourceReferences");
assert(postRel-baselineRel===receipt.relationshipReferencesAdded,"Relationship delta disagrees with receipt.");
assert(postSrc-baselineSrc===Number(receipt.sourceReferencesAdded),"Source-reference delta disagrees with receipt.");

const importedCanonicalIds=[...(receipt.importedCanonicalTradeIds??[])],updatedPerspectiveIds=[...(receipt.updatedPerspectiveCanonicalIds??[])];
const importedPlayerIds=[...playerMap.keys()].filter((id)=>!baselineMap.has(id)).sort((a,b)=>a.localeCompare(b,"en"));
assert(importedCanonicalIds.length===39&&new Set(importedCanonicalIds).size===39,"Imported canonical ID count drifted.");
assert(updatedPerspectiveIds.length===39&&new Set(updatedPerspectiveIds).size===39,"Updated perspective ID count drifted.");
assert(importedPlayerIds.length===18&&new Set(importedPlayerIds).size===18,"Imported player shell count drifted.");
if(Array.isArray(receipt.createdPlayerIds)){
  const a=[...receipt.createdPlayerIds].map(clean).sort(),b=[...importedPlayerIds].map(clean).sort();
  assert(JSON.stringify(a)===JSON.stringify(b),"Receipt createdPlayerIds disagree with baseline diff.");
}

for(const id of importedCanonicalIds){
  const trade=tradeMap.get(clean(id));assert(trade,`Imported canonical trade missing: ${id}`);assertPrivateSafe(trade,`imported trade ${id}`);
  const p=sourcePerspectives(trade,TEAM);assert(p.length===1,`${id}: expected one Pelicans perspective.`);assertPrivateSafe(p[0],`Pelicans perspective ${id}`);
}
for(const id of updatedPerspectiveIds){
  const trade=tradeMap.get(clean(id));assert(trade,`Updated perspective target missing: ${id}`);
  const p=sourcePerspectives(trade,TEAM);assert(p.length===1,`${id}: expected one Pelicans perspective.`);assertPrivateSafe(p[0],`Pelicans perspective ${id}`);
}
for(const id of importedPlayerIds)assertPrivateExplicit(playerMap.get(id),`imported player ${id}`);

const {buildPrivateRelationshipGraph}=await repoImport(args["repo-root"],"src/lib/nba/build-private-relationship-graph.mjs");
const {buildPrivateQueryIndex}=await repoImport(args["repo-root"],"src/lib/nba/build-private-query-index.mjs");
const {buildPrivateRouteModels}=await repoImport(args["repo-root"],"src/lib/nba/build-private-route-models.mjs");
const graph=buildPrivateRelationshipGraph({trades,players,teams});
assert(graph.counts.invalidPlayerReferences===0,"Invalid player references.");
assert(graph.counts.duplicateReferenceOwnership===0,"Duplicate relationship/source ownership.");
assert(graph.counts.extraPlayerReferences===0,"Extra player references.");
assert(graph.counts.invalidTradeTeams===0,"Invalid trade teams.");

const query=buildPrivateQueryIndex({trades,players,teams}),routes=buildPrivateRouteModels({trades,players,teams});
const qTrades=Number(query?.counts?.canonicalTrades??query?.canonicalTrades?.length),qPlayers=Number(query?.counts?.players??query?.players?.length),
  qTeams=Number(query?.counts?.representedTeams??query?.representedTeams?.length),qRefs=Number(query?.counts?.playerTradeReferences??0);
assert(qTrades===trades.length&&qPlayers===players.length&&qTeams===teams.length,"Private query count drifted.");
assert(qRefs>=receipt.relationshipReferencesAdded,"Private query player-reference count unexpectedly low.");
assert(routes.counts.routeModels>0&&routes.counts.internalLinks>0,"Private route model audit produced no graph.");

const audit={
  result:"PASS",phase:"21H",mode:"PELICANS_NATIVE_GUARDED_PRIVATE_IMPORT_AUDIT",team:TEAM,
  counts:{canonicalTrades:trades.length,players:players.length,teams:teams.length,readyPackages:receipt.readyPackages,heldPackages:receipt.heldPackages,
    structuralEvidenceExclusions:receipt.structuralEvidenceExclusions,canonicalTradesCreated:receipt.canonicalTradesCreated,
    perspectivesAppended:receipt.perspectivesAppended,playerShellsCreated:receipt.playerShellsCreated,baselinePlayers:baselinePlayers.length,
    baselineDerivedImportedPlayers:importedPlayerIds.length,existingPlayersWithAllowedMutation:changedPlayers,
    existingPlayersWithRelationshipLayerGrowth:relationshipGrowthPlayers,
    existingPlayerChangedKeyFrequency:Object.fromEntries([...changedFrequency.entries()].sort((a,b)=>a[0].localeCompare(b[0],"en"))),
    baselineRelationshipReferences:baselineRel,postRelationshipReferences:postRel,baselineSourceReferences:baselineSrc,postSourceReferences:postSrc,
    relationshipReferencesAdded:receipt.relationshipReferencesAdded,sourceReferencesAdded:receipt.sourceReferencesAdded,
    privateQueryCanonicalTrades:qTrades,privateQueryPlayers:qPlayers,privateQueryRepresentedTeams:qTeams,privateQueryPlayerReferences:qRefs,
    routeModels:routes.counts.routeModels,internalLinks:routes.counts.internalLinks},
  safety:{invalidPlayerReferences:graph.counts.invalidPlayerReferences,duplicateReferenceOwnership:graph.counts.duplicateReferenceOwnership,
    extraPlayerReferences:graph.counts.extraPlayerReferences,invalidTradeTeams:graph.counts.invalidTradeTeams,
    explicitExistingPlayerOverrides:Object.keys(receipt.explicitPlayerTargetCorrections??{}).length,
    resolvedExistingPlayerIds:receipt.readyShellsResolvedToExistingPlayerIds?.length??0,
    allowedExistingPlayerMutationKeys:[...ALLOWED].sort(),publicationAuthorized:receipt.publicationAuthorized,
    pushPerformed:receipt.pushPerformed,deployPerformed:receipt.deployPerformed}
};
await writeFile(args["output-json"],`${JSON.stringify(audit,null,2)}\n`,"utf8");
console.log(JSON.stringify(audit,null,2));
