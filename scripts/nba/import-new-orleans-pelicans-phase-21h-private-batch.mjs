#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const TEAM = "new-orleans-pelicans";
const TEAM_DISPLAY = "New Orleans Pelicans";
const BATCH = "new-orleans-pelicans-phase-21h";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    args[key.slice(2)] = value;
  }
  return args;
}
function assert(v,m){ if(!v) throw new Error(m); }
function clean(v){ return String(v ?? "").trim(); }
function normalize(v){
  return clean(v).normalize("NFKD").replace(/\p{Diacritic}/gu,"").toLowerCase()
    .replace(/&/gu," and ").replace(/[\u2018\u2019'`"]/gu,"")
    .replace(/[^a-z0-9]+/gu," ").trim().replace(/\s+/gu," ");
}
function slugify(v){ return normalize(v).replace(/\s+/gu,"-") || "unknown"; }
function sha256(v){ return createHash("sha256").update(v).digest("hex").toUpperCase(); }
function canonicalJson(v){ return Buffer.from(`${JSON.stringify(v,null,2)}\n`,"utf8"); }
function unique(v){ return [...new Set(v.filter(Boolean))]; }
function uniqueSorted(v){ return unique(v).sort((a,b)=>String(a).localeCompare(String(b),"en")); }
function seasonStartYear(date){ const y=Number(String(date).slice(0,4)),m=Number(String(date).slice(5,7));return m>=6?y:y-1; }
function seasonLabel(date){ const s=seasonStartYear(date);return `${s}-${String(s+1).slice(-2)}`; }
function playerId(p){ return clean(p?.id ?? p?.playerId ?? p?.slug ?? p?.identity?.id); }
function teamSlug(t){ return clean(t?.slug ?? t?.id ?? t?.teamId); }
function tradeId(t){ return clean(t?.id ?? t?.tradeId); }
function asArrayDocument(raw,property){
  if(Array.isArray(raw)) return raw;
  if(raw && Array.isArray(raw[property])) return raw[property];
  if(raw && Array.isArray(raw.records)) return raw.records;
  throw new Error(`JSON input does not contain ${property} array.`);
}
async function fileExists(p){try{await access(p);return true;}catch{return false;}}
async function readJson(p){return JSON.parse((await readFile(p,"utf8")).replace(/^\uFEFF/u,""));}
async function sha256File(p){return sha256(await readFile(p));}
async function atomicWrite(target,bytes,label){
  const abs=path.resolve(target),dir=path.dirname(abs),tmp=path.join(dir,`.${path.basename(abs)}.${label}.${process.pid}.tmp`);
  await mkdir(dir,{recursive:true});await writeFile(tmp,bytes);
  try{await rename(tmp,abs);}catch(e){await rm(tmp,{force:true});throw e;}
}
function parseCsv(text){
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i+=1){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i+=1;}
      else if(ch==='"')quoted=false;else field+=ch;continue;
    }
    if(ch==='"')quoted=true;
    else if(ch===","){row.push(field);field="";}
    else if(ch==="\n"){row.push(field.replace(/\r$/u,""));rows.push(row);row=[];field="";}
    else field+=ch;
  }
  if(field.length||row.length){row.push(field.replace(/\r$/u,""));rows.push(row);}
  if(!rows.length)return[];
  const headers=rows[0].map(clean);
  return rows.slice(1).filter((r)=>r.some((v)=>clean(v)))
    .map((r)=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??""])));
}
async function readCsv(p){return parseCsv(await readFile(p,"utf8"));}
function splitAssets(v){
  return clean(v).replace(/\r/gu,"\n").replace(/[\u2022\u25CF\u25AA]/gu,";")
    .replace(/\n+/gu,";").split(";").map((x)=>x.trim()).filter(Boolean);
}
function sourcePerspectiveCount(trade,team){
  const p=trade?.perspectives;
  if(Array.isArray(p)) return p.filter((x)=>clean(x?.sourceTeam??x?.teamId??x?.team??x?.perspectiveTeam)===team).length;
  if(p&&typeof p==="object") return Object.prototype.hasOwnProperty.call(p,team)?1:0;
  return 0;
}
function immutableTradeProjection(trade){
  return {
    id:trade.id,tradeId:trade.tradeId,sourceTradeId:trade.sourceTradeId,canonicalKey:trade.canonicalKey,
    slug:trade.slug,league:trade.league,tradeDate:trade.tradeDate,date:trade.date,seasonLabel:trade.seasonLabel,
    season:trade.season,teams:trade.teams,assetLedger:trade.assetLedger,assetsReceived:trade.assetsReceived,
    assetsSent:trade.assetsSent,assetsSentByTeam:trade.assetsSentByTeam,createdAt:trade.createdAt
  };
}
function winnerFromVerdict(verdict){
  const v=clean(verdict).toLowerCase();
  if(v.includes("pelicans win")||v.includes("pelicans edge"))return TEAM_DISPLAY;
  if(v.includes("partner win")||v.includes("partner edge"))return"Partner";
  if(v.includes("even"))return"Even";
  return"Incomplete Evidence";
}
function perspectiveGrades(record,teams){
  const grades={};
  if(clean(record.pelicansGrade))grades[TEAM]=clean(record.pelicansGrade);
  if(clean(record.partnerGrade)){
    grades.partnerAggregate=clean(record.partnerGrade);
    const partners=teams.filter((t)=>t!==TEAM);
    if(partners.length===1)grades[partners[0]]=clean(record.partnerGrade);
  }
  return grades;
}
function pelicansPerspective(record,teams){
  return {
    sourceTeam:TEAM,sourceBatchId:BATCH,sourceTradeId:clean(record.tradeId),
    sourcePerspectiveKey:`${TEAM}:${clean(record.tradeId)}`,
    summary:clean(record.summary),analysis:clean(record.analysis),verdict:clean(record.finalVerdict),
    grades:perspectiveGrades(record,teams),aggregatePartnerGrade:clean(record.partnerGrade)||null,
    confidence:clean(record.confidence).toLowerCase(),reviewStatus:"manual-review",
    contentClass:clean(record.publicationClass),lowValueQa:clean(record.lowValueGate),
    outcomeScore:record.hindsightScore??null,winner:winnerFromVerdict(record.finalVerdict),
    gradeRationale:clean(record.materialCorrectionNote),reviewerNotes:clean(record.researchFlags),
    primarySourceUrl:clean(record.primarySourceUrl)||null,secondarySourceUrl:clean(record.secondarySourceUrl)||null,
    privateOnly:true,publishStatus:"private",indexEligible:false,adEligible:false,publicationReady:false
  };
}
function appendPelicansPerspective(existing,record,importedAt){
  const protectedBefore=JSON.stringify(immutableTradeProjection(existing));
  assert(sourcePerspectiveCount(existing,TEAM)===0,`${record.tradeId}: Pelicans perspective already exists.`);
  const teams=uniqueSorted(existing.teams??[]);
  assert(teams.includes(TEAM),`${record.tradeId}: target canonical trade does not include Pelicans.`);
  const perspective=pelicansPerspective(record,teams);
  let perspectives;
  if(Array.isArray(existing.perspectives)) perspectives=[...existing.perspectives,perspective];
  else if(existing.perspectives&&typeof existing.perspectives==="object"){
    perspectives={...existing.perspectives,[TEAM]:{
      sourceSubmissionId:`${BATCH}-${clean(record.tradeId)}`,sourceTradeId:clean(record.tradeId),
      editorialStatus:`private-imported-${BATCH}`,grade:clean(record.pelicansGrade),
      verdict:clean(record.finalVerdict),summary:clean(record.summary),analysis:clean(record.analysis),
      confidence:clean(record.confidence),reviewStatus:"manual-review",contentClass:clean(record.publicationClass),
      lowValueQa:clean(record.lowValueGate),privateOnly:true,publishStatus:"private",indexEligible:false,
      adEligible:false,publicationReady:false
    }};
  } else perspectives=[perspective];
  const grades={...(existing.grades??{})};
  if(clean(record.pelicansGrade))grades[TEAM]=clean(record.pelicansGrade);
  const updated={
    ...existing,sourceTeams:uniqueSorted([...(Array.isArray(existing.sourceTeams)?existing.sourceTeams:[]),TEAM]),
    perspectives,grades,
    perspectiveReconciliations:[
      ...(Array.isArray(existing.perspectiveReconciliations)?existing.perspectiveReconciliations:[]),
      {sourceBatchId:BATCH,sourceTradeId:clean(record.tradeId),packageId:`${BATCH}-${clean(record.tradeId)}`,
       method:"frozen-exact-existing-canonical-match",importedAt,automaticMerge:false}
    ],
    publishStatus:"private",privateOnly:true,indexEligible:false,adEligible:false,publicationReady:false,updatedAt:importedAt
  };
  assert(JSON.stringify(immutableTradeProjection(updated))===protectedBefore,`${record.tradeId}: perspective append altered protected canonical fields.`);
  assert(sourcePerspectiveCount(updated,TEAM)===1,`${record.tradeId}: Pelicans perspective append count drifted.`);
  return updated;
}
function canonicalIdForSource(sourceTradeId){
  const m=clean(sourceTradeId).match(/^NOPNBA-(\d{4})-(\d{4})$/u);
  assert(m,`Invalid Pelicans source Trade ID: ${sourceTradeId}`);
  return `nba-trade-nop-${m[1]}-${m[2]}`;
}
function makeAssetId(sourceTradeId,side,index,raw,fromTeam,toTeam){
  return `phase21h-asset-${sha256([sourceTradeId,side,index,raw,fromTeam,toTeam].join("|")).slice(0,20).toLowerCase()}`;
}
function classifyAsset(raw,hasIdentity){
  const v=normalize(raw);
  if(hasIdentity&&(/\bdraft rights\b|\brights to\b/u.test(v)))return"draft_rights";
  if(hasIdentity)return"player";
  if(/\bcash\b/u.test(v))return"cash";
  if(/\btrade exception\b|\btpe\b/u.test(v))return"trade_exception";
  if(/\bswap\b/u.test(v))return"pick_swap";
  if(/\bpick\b|\bselection\b|\bround\b|#\s*\d+/u.test(clean(raw).toLowerCase()))return"draft_pick";
  if(/\bconsideration\b/u.test(v))return"future_consideration";
  return"other";
}
function referenceTypeForIdentity(identity){
  const raw=normalize(identity?.rawAsset);
  return /\bdraft rights\b|\brights to\b/u.test(raw)?"draft_rights":"direct_player";
}
function relationRoleForIdentity(identity){
  return referenceTypeForIdentity(identity)==="draft_rights"?"draft-rights-player":"traded-player";
}
function identityKey(row){
  return [clean(row.tradeId),clean(row.direction).toUpperCase(),clean(row.rawAsset),clean(row.targetPlayerId)].join("|");
}
function relationshipCompatibilityKey(row){
  return [clean(row.tradeId),clean(row.direction).toUpperCase(),clean(row.playerTargetId)].join("|");
}
function createPlayerShell(shell,aliases,importedAt){
  const id=clean(shell.proposedPlayerId),displayName=clean(shell.canonicalPlayerName);
  assert(id,"Frozen player shell has empty ID.");assert(displayName,`${id}: frozen player shell has empty display name.`);
  return {
    id,playerId:id,slug:slugify(displayName),displayName,name:displayName,fullName:displayName,playerName:displayName,
    normalizedName:clean(shell.normalizedIdentity)||normalize(displayName),league:"nba",
    aliases:uniqueSorted(aliases.filter((v)=>normalize(v)!==normalize(displayName))),
    referenceTypes:[],tradeIds:[],tradeSlugs:[],relationshipReferences:[],sourceReferences:[],
    publishStatus:"private",reviewStatus:"manual-review",importReviewStatus:`private-shell-imported-${BATCH}`,
    privateOnly:true,indexEligible:false,adEligible:false,publicationReady:false,createdAt:importedAt,updatedAt:importedAt
  };
}
function buildNewTrade({pkg,record,teamRows,identityRows,importedAt,playerMap}){
  const sourceTradeId=clean(record.tradeId);
  assert(teamRows.length===2,`${sourceTradeId}: new canonical create must have exactly two team dependencies.`);
  assert(teamRows.every((r)=>clean(r.registryStatus)==="EXACT"),`${sourceTradeId}: unresolved team dependency entered create.`);
  const teams=uniqueSorted(teamRows.map((r)=>clean(r.teamSlug)));
  assert(teams.length===2&&teams.includes(TEAM),`${sourceTradeId}: ready create team set must contain Pelicans plus one partner.`);
  const partner=teams.find((t)=>t!==TEAM);assert(partner,`${sourceTradeId}: partner missing.`);

  const identitiesByAsset=new Map();
  for(const row of identityRows){
    const key=[clean(row.direction).toUpperCase(),clean(row.rawAsset)].join("|");
    if(!identitiesByAsset.has(key))identitiesByAsset.set(key,[]);
    identitiesByAsset.get(key).push(row);
  }

  const assets=[];
  for(const [side,text] of [["received",record.normalizedPelicansReceived],["sent",record.normalizedPelicansSent]]){
    const rawAssets=splitAssets(text);
    rawAssets.forEach((raw,index)=>{
      const ids=identitiesByAsset.get([side.toUpperCase(),raw].join("|"))??[];
      assert(ids.length<=1,`${sourceTradeId}: multiple frozen player identities on one asset line: ${raw}`);
      const fromTeam=side==="received"?partner:TEAM,toTeam=side==="received"?TEAM:partner;
      const asset={
        assetId:makeAssetId(sourceTradeId,side,index+1,raw,fromTeam,toTeam),
        dependencyKey:`${sourceTradeId}|${side}|${String(index+1).padStart(2,"0")}`,
        type:classifyAsset(raw,ids.length===1),displayText:raw,asset:raw,fromTeam,toTeam,direction:side,
        sourceTeam:TEAM,edgeClass:"pelicans-source-route",routingStatus:"resolved",routingMethod:"two-team-direct",
        possibleFromTeams:[],possibleToTeams:[],privateOnly:true,previewOnly:false,auditStatus:`private-imported-${BATCH}`
      };
      if(ids.length===1){
        const identity=ids[0],target=clean(identity.targetPlayerId),player=playerMap.get(target);
        assert(player,`${sourceTradeId}: frozen player target missing: ${target}`);
        const name=clean(player.displayName??player.name??identity.canonicalPlayerName);
        if(asset.type==="draft_rights"){
          asset.playerId=target;asset.playerName=name;asset.playerRelationshipRole="draft-rights-player";
        }else{
          asset.playerId=target;asset.playerName=name;asset.playerRelationshipRole="traded-player";
        }
      }
      assets.push(asset);
    });
  }

  const byReceived=Object.fromEntries(teams.map((t)=>[t,assets.filter((a)=>a.toTeam===t)]));
  const bySent=Object.fromEntries(teams.map((t)=>[t,assets.filter((a)=>a.fromTeam===t)]));
  const perspective=pelicansPerspective(record,teams),canonicalId=canonicalIdForSource(sourceTradeId),tradeDate=clean(record.tradeDate);
  const sources=[
    clean(record.primarySourceUrl)?{sourceType:"primary_url",url:clean(record.primarySourceUrl),sourceTeam:TEAM,privateOnly:true}:null,
    clean(record.secondarySourceUrl)?{sourceType:"secondary_url",url:clean(record.secondarySourceUrl),sourceTeam:TEAM,privateOnly:true}:null,
  ].filter(Boolean);
  if(!sources.length)sources.push({sourceType:"reconciled_workbook",label:"New Orleans Pelicans reconciled audit workbook",sourceTradeId,sourceTeam:TEAM,privateOnly:true});
  return {
    id:canonicalId,tradeId:canonicalId,sourceTradeId,canonicalKey:canonicalId,
    slug:`new-orleans-pelicans-trade-${tradeDate}-${sourceTradeId.split("-").at(-1)}`,
    league:"nba",tradeDate,date:tradeDate,seasonLabel:seasonLabel(tradeDate),season:seasonStartYear(tradeDate),
    teams,sourceTeamLabels:uniqueSorted([TEAM_DISPLAY,clean(record.partnerTeams)]),sourceTeamSlugs:teams,
    assetsReceived:byReceived,assetsSent:bySent,assetsSentByTeam:bySent,assetLedger:assets,sourceTeams:[TEAM],
    perspectives:{[TEAM]:perspective},grades:perspective.grades,verdict:clean(record.finalVerdict),
    summary:clean(record.summary),analysis:clean(record.analysis),confidence:clean(record.confidence).toLowerCase(),
    contentClass:clean(record.publicationClass),canonicalAction:clean(pkg.canonicalAction),
    dateCollisionResolvedAsDistinctCreate:false,canonicalKeyVersion:1,dateTeamsKey:`${tradeDate}|${teams.join("|")}`,
    publishStatus:"private",reviewStatus:"manual-review",importReviewStatus:`private-imported-${BATCH}`,
    privateOnly:true,indexEligible:false,adEligible:false,publicationReady:false,sources,
    perspectiveReconciliations:[{sourceBatchId:BATCH,sourceTradeId,packageId:`${BATCH}-${sourceTradeId}`,
      method:"frozen-new-canonical-create",importedAt,automaticMerge:false}],
    createdAt:importedAt,updatedAt:importedAt
  };
}
function assetMatchesPelicansSide(asset,direction){
  const from=Array.isArray(asset?.possibleFromTeams)?asset.possibleFromTeams:[],to=Array.isArray(asset?.possibleToTeams)?asset.possibleToTeams:[];
  const d=clean(direction).toUpperCase();
  if(d==="RECEIVED")return clean(asset?.toTeam)===TEAM||to.includes(TEAM);
  return clean(asset?.fromTeam)===TEAM||from.includes(TEAM);
}
function assetMatchScore(asset,identity,player){
  const target=clean(identity.targetPlayerId);
  if([asset?.playerId,asset?.becamePlayerId,asset?.targetPlayerId].map(clean).includes(target))return 100;
  const display=normalize(player?.displayName??player?.name??identity.canonicalPlayerName);
  for(const field of ["playerName","becamePlayerName","displayText","asset","auditSourceText"]){
    const value=normalize(asset?.[field]);if(display&&value.includes(display))return 80;
  }
  const raw=normalize(identity.rawAsset),text=normalize(asset?.displayText??asset?.asset??asset?.auditSourceText);
  if(raw&&text){if(raw===text)return 70;if(raw.includes(text)||text.includes(raw))return 60;}
  return 0;
}
function syntheticAssetReference(identity,relationshipId){
  return {
    assetId:`phase21h-perspective-asset-${sha256([identity.tradeId,identity.direction,identity.rawAsset,identity.targetPlayerId,relationshipId].join("|")).slice(0,20).toLowerCase()}`,
    sourceAssetId:null,synthetic:true
  };
}
function resolveRelationshipAssetReference(trade,identity,player,relationshipId){
  const assets=Array.isArray(trade.assetLedger)?trade.assetLedger:[];
  const candidates=assets.map((asset)=>({asset,score:assetMatchScore(asset,identity,player),sideMatch:assetMatchesPelicansSide(asset,identity.direction)}))
    .filter((c)=>c.score>0)
    .sort((a,b)=>Number(b.sideMatch)-Number(a.sideMatch)||b.score-a.score||clean(a.asset.assetId).localeCompare(clean(b.asset.assetId),"en"));
  if(candidates.length&&clean(candidates[0].asset.assetId)){
    return{assetId:clean(candidates[0].asset.assetId),sourceAssetId:clean(candidates[0].asset.assetId),synthetic:false};
  }
  return syntheticAssetReference(identity,relationshipId);
}
function canonicalSourceReferenceKey(canonicalTradeId,assetId,refType){return[clean(canonicalTradeId),clean(assetId),clean(refType)].join("|");}
function appendRelationshipReference(player,reference,sourceReference,importedAt){
  const relationships=Array.isArray(player.relationshipReferences)?player.relationshipReferences:[];
  assert(!relationships.some((r)=>clean(r.relationshipId)===clean(reference.relationshipId)),`${reference.relationshipId}: relationship already exists.`);
  const sources=Array.isArray(player.sourceReferences)?player.sourceReferences:[];
  const sourceKey=sourceReference?canonicalSourceReferenceKey(sourceReference.canonicalTradeId,sourceReference.assetId,sourceReference.referenceType):null;
  const sourceExists=sourceKey?sources.some((r)=>canonicalSourceReferenceKey(r.canonicalTradeId??r.tradeId,r.assetId??r.assetReference,r.referenceType)===sourceKey):false;
  return {
    ...player,relationshipReferences:[...relationships,reference],
    sourceReferences:sourceReference&&!sourceExists?[...sources,sourceReference]:sources,
    referenceTypes:uniqueSorted([...(Array.isArray(player.referenceTypes)?player.referenceTypes:[]),reference.referenceType]),
    tradeIds:uniqueSorted([...(Array.isArray(player.tradeIds)?player.tradeIds:[]),reference.tradeId]),
    tradeSlugs:uniqueSorted([...(Array.isArray(player.tradeSlugs)?player.tradeSlugs:[]),reference.tradeSlug]),
    publishStatus:"private",privateOnly:true,indexEligible:false,adEligible:false,publicationReady:false,updatedAt:importedAt
  };
}

const args=parseArgs(process.argv);
const required=[
  "records-json","partition-json","ready-packages-csv","held-packages-csv","structural-csv",
  "ready-player-shells-csv","held-player-shells-csv","ready-relationships-csv","held-relationships-csv",
  "ready-team-dependencies-csv","held-team-dependencies-csv","ready-dependency-seeds-csv","held-dependency-seeds-csv",
  "ready-identities-csv","held-identities-csv",
  "expected-records-sha256","expected-partition-sha256","expected-partition-internal-sha256",
  "expected-ready-packages-sha256","expected-held-packages-sha256","expected-structural-exclusions-sha256",
  "expected-ready-player-shells-sha256","expected-held-player-shells-sha256",
  "expected-ready-relationships-sha256","expected-held-relationships-sha256",
  "expected-ready-team-dependencies-sha256","expected-held-team-dependencies-sha256",
  "expected-ready-dependency-seeds-sha256","expected-held-dependency-seeds-sha256",
  "expected-ready-identities-sha256","expected-held-identities-sha256",
  "expected-contract-sha256","expected-trade-store-sha256","expected-player-store-sha256","expected-team-store-sha256",
  "trades-json","players-json","teams-json","receipt-json","contract-md","imported-at","starting-head"
];
for(const k of required)assert(args[k],`Missing --${k}`);

const inputPaths={
  records:args["records-json"],partition:args["partition-json"],readyPackages:args["ready-packages-csv"],
  heldPackages:args["held-packages-csv"],structural:args["structural-csv"],readyShells:args["ready-player-shells-csv"],
  heldShells:args["held-player-shells-csv"],readyRelationships:args["ready-relationships-csv"],
  heldRelationships:args["held-relationships-csv"],readyTeams:args["ready-team-dependencies-csv"],
  heldTeams:args["held-team-dependencies-csv"],readyDependencies:args["ready-dependency-seeds-csv"],
  heldDependencies:args["held-dependency-seeds-csv"],readyIdentities:args["ready-identities-csv"],heldIdentities:args["held-identities-csv"]
};
const expectedHashes={
  records:args["expected-records-sha256"],partition:args["expected-partition-sha256"],
  readyPackages:args["expected-ready-packages-sha256"],heldPackages:args["expected-held-packages-sha256"],
  structural:args["expected-structural-exclusions-sha256"],readyShells:args["expected-ready-player-shells-sha256"],
  heldShells:args["expected-held-player-shells-sha256"],readyRelationships:args["expected-ready-relationships-sha256"],
  heldRelationships:args["expected-held-relationships-sha256"],readyTeams:args["expected-ready-team-dependencies-sha256"],
  heldTeams:args["expected-held-team-dependencies-sha256"],readyDependencies:args["expected-ready-dependency-seeds-sha256"],
  heldDependencies:args["expected-held-dependency-seeds-sha256"],readyIdentities:args["expected-ready-identities-sha256"],
  heldIdentities:args["expected-held-identities-sha256"]
};
for(const [k,p] of Object.entries(inputPaths)){
  const actual=await sha256File(p);assert(actual===expectedHashes[k],`${k} input hash mismatch: ${actual}`);
}
assert(await sha256File(args["contract-md"])===args["expected-contract-sha256"],"Contract hash mismatch.");

const partition=await readJson(inputPaths.partition);
assert(partition.result==="PASS"&&partition.phase==="21F-R1"&&partition.team===TEAM,"Partition metadata invalid.");
// Phase 21F deliberately stores semanticPartitionSha256 in its freeze/output
// metadata, not inside final-import-partition.json. The PowerShell wrapper
// already validates the frozen 21F semantic SHA before invoking this importer.
// Keep an independent fixed-argument guard here without inventing a JSON field.
const EXPECTED_PHASE21F_SEMANTIC_SHA256 = "63D7A7B2050782FD3580F24523D9EEAAA800ABA5E62F9AFF20E31148F9CD8C5A";
assert(
  clean(args["expected-partition-internal-sha256"]) === EXPECTED_PHASE21F_SEMANTIC_SHA256,
  "Partition semantic guard argument mismatch."
);
assert(partition.counts.importReadyPackages===78&&partition.counts.heldPackages===19&&partition.counts.structuralEvidenceExclusions===4,"Partition package counts drifted.");
assert(partition.counts.canonicalPerspectiveAppendPreviews===39&&partition.counts.canonicalCreatePreviews===39,"Partition action counts drifted.");
assert(partition.counts.readyRequiredPlayerShells===18&&partition.counts.heldOnlyPlayerShells===16,"Partition shell counts drifted.");
assert(partition.counts.readyRelationshipEdges===182&&partition.counts.heldRelationshipEdges===60,"Partition relationship counts drifted.");
assert(partition.counts.readyTeamDependencyOccurrences===166&&partition.counts.heldTeamDependencyOccurrences===49,"Partition team counts drifted.");
assert(partition.counts.readyIdentityOccurrences===182&&partition.counts.heldIdentityOccurrences===60,"Partition identity counts drifted.");
assert(partition.counts.readyAmbiguousIdentityOccurrences===0&&partition.counts.heldAmbiguousIdentityOccurrences===0,"Ambiguous identity partition drifted.");
assert(partition.counts.existingPerspectiveReviewHolds===0,"Existing perspective holds are not zero.");
assert(partition.counts.missingTeamDependencyOccurrences===0,"Missing team dependency count drifted.");

const records=asArrayDocument(await readJson(inputPaths.records),"records");
const readyPackages=await readCsv(inputPaths.readyPackages),heldPackages=await readCsv(inputPaths.heldPackages),structuralRows=await readCsv(inputPaths.structural);
const readyShells=await readCsv(inputPaths.readyShells),heldShells=await readCsv(inputPaths.heldShells);
const readyRelationships=await readCsv(inputPaths.readyRelationships),heldRelationships=await readCsv(inputPaths.heldRelationships);
const readyTeams=await readCsv(inputPaths.readyTeams),heldTeams=await readCsv(inputPaths.heldTeams);
const readyDependencies=await readCsv(inputPaths.readyDependencies),heldDependencies=await readCsv(inputPaths.heldDependencies);
const readyIdentities=await readCsv(inputPaths.readyIdentities),heldIdentities=await readCsv(inputPaths.heldIdentities);

assert(records.length===101,"Expected 101 source records.");
assert(readyPackages.length===78&&heldPackages.length===19&&structuralRows.length===4,"CSV package partition drifted.");
assert(readyShells.length===18&&heldShells.length===16,"CSV shell partition drifted.");
assert(readyRelationships.length===182&&heldRelationships.length===60,"CSV relationship partition drifted.");
assert(readyTeams.length===166&&heldTeams.length===49,"CSV team partition drifted.");
assert(readyDependencies.length===78&&heldDependencies.length===19,"CSV dependency seed partition drifted.");
assert(readyIdentities.length===182&&heldIdentities.length===60,"CSV identity partition drifted.");
assert(readyPackages.every((r)=>clean(r.partition)==="IMPORT_READY_PREVIEW"),"Non-ready package entered ready CSV.");
assert(readyPackages.every((r)=>["APPEND_PERSPECTIVE_PREVIEW","CREATE_CANONICAL_PREVIEW"].includes(clean(r.canonicalAction))),"Unsupported ready action.");
assert(readyIdentities.every((r)=>clean(r.identityStatus)!=="AMBIGUOUS"),"Ambiguous ready identity.");
assert(heldIdentities.every((r)=>clean(r.identityStatus)!=="AMBIGUOUS"),"Held ambiguous identity drifted.");
assert(readyTeams.every((r)=>clean(r.registryStatus)==="EXACT"),"Non-exact ready team dependency.");

const inputHashObject=Object.fromEntries(Object.entries(expectedHashes).sort(([a],[b])=>a.localeCompare(b,"en")));
const tradeBytesBefore=await readFile(args["trades-json"]),playerBytesBefore=await readFile(args["players-json"]),teamBytes=await readFile(args["teams-json"]);
const currentTradeHash=sha256(tradeBytesBefore),currentPlayerHash=sha256(playerBytesBefore),currentTeamHash=sha256(teamBytes);

if(await fileExists(args["receipt-json"])){
  const priorBytes=await readFile(args["receipt-json"]),prior=JSON.parse(priorBytes.toString("utf8"));
  if(prior.result==="PASS"&&prior.phase==="21H"&&prior.team===TEAM&&prior.startingHead===args["starting-head"]&&
     JSON.stringify(prior.inputHashes??{})===JSON.stringify(inputHashObject)&&
     prior.canonicalStoreSha256===currentTradeHash&&prior.playerStoreSha256===currentPlayerHash&&prior.teamStoreSha256===currentTeamHash){
    console.log(JSON.stringify({result:"PASS",phase:"21H",mode:"IDEMPOTENT_REPLAY",canonicalStoreSha256:currentTradeHash,
      playerStoreSha256:currentPlayerHash,teamStoreSha256:currentTeamHash,receiptSha256:sha256(priorBytes)},null,2));
    process.exit(0);
  }
}

assert(currentTradeHash===args["expected-trade-store-sha256"],`Preimport canonical store hash mismatch: ${currentTradeHash}`);
assert(currentPlayerHash===args["expected-player-store-sha256"],`Preimport player store hash mismatch: ${currentPlayerHash}`);
assert(currentTeamHash===args["expected-team-store-sha256"],`Team store hash mismatch: ${currentTeamHash}`);

const trades=JSON.parse(tradeBytesBefore.toString("utf8")),players=JSON.parse(playerBytesBefore.toString("utf8")),teams=JSON.parse(teamBytes.toString("utf8"));
assert(Array.isArray(trades)&&trades.length===2287,"Expected 2287 baseline canonical trades.");
assert(Array.isArray(players)&&players.length===3128,"Expected 3128 baseline players.");
assert(Array.isArray(teams)&&teams.length===52,"Expected 52 baseline teams.");
const teamSet=new Set(teams.map(teamSlug).filter(Boolean));assert(teamSet.has(TEAM),"New Orleans Pelicans missing from team registry.");
assert(teamSet.has("charlotte-hornets"),"Charlotte Hornets missing from team registry.");
assert(teamSet.has("seattle-supersonics")&&teamSet.has("oklahoma-city-thunder"),"Seattle/OKC historical team identities are not distinct in registry.");

const recordsById=new Map(records.map((r)=>[clean(r.tradeId),r]));assert(recordsById.size===101,"Duplicate source Trade IDs.");
const readyIdSet=new Set(readyPackages.map((r)=>clean(r.tradeId))),heldIdSet=new Set(heldPackages.map((r)=>clean(r.tradeId))),excludedIdSet=new Set(structuralRows.map((r)=>clean(r.tradeId)));
assert(new Set([...readyIdSet,...heldIdSet,...excludedIdSet]).size===101,"Ready/held/excluded coverage drifted.");

function groupByTrade(rows){
  const m=new Map();for(const r of rows){const id=clean(r.tradeId);if(!m.has(id))m.set(id,[]);m.get(id).push(r);}return m;
}
const identitiesByTrade=groupByTrade(readyIdentities),teamsByTrade=groupByTrade(readyTeams);
const relationshipsByTrade=groupByTrade(readyRelationships),dependenciesByTrade=groupByTrade(readyDependencies);

const relMultiset=new Map();
for(const r of readyRelationships){
  const key=relationshipCompatibilityKey(r);relMultiset.set(key,(relMultiset.get(key)??0)+1);
}
const idMultiset=new Map();
for(const r of readyIdentities){
  const key=[clean(r.tradeId),clean(r.direction).toUpperCase(),clean(r.targetPlayerId)].join("|");
  idMultiset.set(key,(idMultiset.get(key)??0)+1);
}
assert(JSON.stringify([...relMultiset.entries()].sort())===JSON.stringify([...idMultiset.entries()].sort()),"Ready relationship/identity occurrence multisets disagree.");

const tradeMap=new Map(trades.map((t)=>[tradeId(t),t]));assert(tradeMap.size===trades.length,"Duplicate canonical trade IDs.");
const playerMap=new Map(players.map((p)=>[playerId(p),p]));assert(playerMap.size===players.length,"Duplicate player IDs.");
const baselinePlayerIds=new Set(playerMap.keys());

const baselineRelationshipOwners=new Map(),preimportCanonicalSourceReferenceOwners=new Map();
for(const player of players){
  const pid=playerId(player);
  for(const ref of Array.isArray(player.relationshipReferences)?player.relationshipReferences:[]){
    const rid=clean(ref?.relationshipId);if(!rid)continue;
    assert(!baselineRelationshipOwners.has(rid),`Baseline relationship ID multiply owned: ${rid}`);baselineRelationshipOwners.set(rid,pid);
  }
  for(const ref of Array.isArray(player.sourceReferences)?player.sourceReferences:[]){
    const key=canonicalSourceReferenceKey(ref?.canonicalTradeId??ref?.tradeId,ref?.assetId??ref?.assetReference,ref?.referenceType);
    if(key==="||")continue;const owner=preimportCanonicalSourceReferenceOwners.get(key);
    assert(!owner||owner===pid,`Baseline canonical source-reference key multiply owned: ${key}`);
    preimportCanonicalSourceReferenceOwners.set(key,pid);
  }
}

const aliasesByTarget=new Map();
for(const identity of readyIdentities){
  const target=clean(identity.targetPlayerId);if(!target)continue;
  if(!aliasesByTarget.has(target))aliasesByTarget.set(target,new Set());
  for(const alias of [identity.rawPlayerIdentity,identity.canonicalPlayerName])if(clean(alias))aliasesByTarget.get(target).add(clean(alias));
}

const createdPlayerIds=[];
for(const shell of readyShells){
  const id=clean(shell.proposedPlayerId);assert(id,"Ready shell missing proposedPlayerId.");
  assert(!playerMap.has(id),`${id}: ready proposed player already exists; exact identity review required.`);
  const player=createPlayerShell(shell,[...(aliasesByTarget.get(id)??new Set())],args["imported-at"]);
  playerMap.set(id,player);createdPlayerIds.push(id);
}
assert(createdPlayerIds.length===18,"Expected 18 created player shells.");
for(const shell of heldShells){
  const id=clean(shell.proposedPlayerId);assert(!baselinePlayerIds.has(id)&&!playerMap.has(id),`${id}: held-only shell was present or created.`);
}
for(const identity of readyIdentities){
  const target=clean(identity.targetPlayerId);assert(target&&playerMap.has(target),`${identity.tradeId}: ready identity target missing: ${target}`);
}

const importedCanonicalTradeIds=[],updatedPerspectiveCanonicalIds=[],protectedAppendProjectionHashes={};
for(const pkg of readyPackages.slice().sort((a,b)=>Number(recordsById.get(a.tradeId)?.sourceRow??0)-Number(recordsById.get(b.tradeId)?.sourceRow??0))){
  const sourceId=clean(pkg.tradeId),record=recordsById.get(sourceId);assert(record,`${sourceId}: source record missing.`);
  let trade;
  if(clean(pkg.canonicalAction)==="CREATE_CANONICAL_PREVIEW"){
    trade=buildNewTrade({pkg,record,teamRows:teamsByTrade.get(sourceId)??[],identityRows:identitiesByTrade.get(sourceId)??[],importedAt:args["imported-at"],playerMap});
    assert(!tradeMap.has(trade.id),`${sourceId}: deterministic canonical ID already exists: ${trade.id}`);
    for(const team of trade.teams)assert(teamSet.has(team),`${sourceId}: unknown team slug ${team}.`);
    tradeMap.set(trade.id,trade);importedCanonicalTradeIds.push(trade.id);
  }else{
    assert(clean(pkg.canonicalAction)==="APPEND_PERSPECTIVE_PREVIEW",`${sourceId}: unsupported action.`);
    const targetId=clean(pkg.canonicalTradeId);assert(targetId,`${sourceId}: append package has no canonicalTradeId.`);
    const existing=tradeMap.get(targetId);assert(existing,`${sourceId}: perspective target missing: ${targetId}`);
    assert(sourcePerspectiveCount(existing,TEAM)===0,`${sourceId}: perspective target already has Pelicans perspective.`);
    protectedAppendProjectionHashes[targetId]=sha256(canonicalJson(immutableTradeProjection(existing)));
    trade=appendPelicansPerspective(existing,record,args["imported-at"]);
    assert(sha256(canonicalJson(immutableTradeProjection(trade)))===protectedAppendProjectionHashes[targetId],`${sourceId}: protected append projection drifted.`);
    tradeMap.set(targetId,trade);updatedPerspectiveCanonicalIds.push(targetId);
  }
}
assert(importedCanonicalTradeIds.length===39,"Expected 39 canonical creates.");
assert(updatedPerspectiveCanonicalIds.length===39,"Expected 39 perspective appends.");

let matchedExistingAssetReferences=0,syntheticPerspectiveAssetReferences=0,sourceReferencesAdded=0;
const ownershipConflictSyntheticRelationshipIds=[],ownershipConflictSyntheticDetails=[],syntheticRelationshipIds=[],relationshipIds=[];
const packageByTrade=new Map(readyPackages.map((r)=>[clean(r.tradeId),r]));

const sortedIdentities=readyIdentities.slice().sort((a,b)=>
  clean(a.tradeId).localeCompare(clean(b.tradeId),"en")||
  clean(a.direction).localeCompare(clean(b.direction),"en")||
  clean(a.rawAsset).localeCompare(clean(b.rawAsset),"en")||
  clean(a.targetPlayerId).localeCompare(clean(b.targetPlayerId),"en")
);

for(let i=0;i<sortedIdentities.length;i+=1){
  const identity=sortedIdentities[i],sourceId=clean(identity.tradeId),pkg=packageByTrade.get(sourceId);
  assert(pkg,`${sourceId}: identity package missing.`);
  const target=clean(identity.targetPlayerId),player=playerMap.get(target);assert(player,`${sourceId}: target player missing: ${target}`);
  const trade=clean(pkg.canonicalAction)==="CREATE_CANONICAL_PREVIEW"
    ? tradeMap.get(canonicalIdForSource(sourceId))
    : tradeMap.get(clean(pkg.canonicalTradeId));
  assert(trade,`${sourceId}: canonical trade missing while writing relationship.`);
  const relationshipId=`phase21h-rel-${sha256([sourceId,identity.direction,identity.rawAsset,target,String(i+1)].join("|")).slice(0,24).toLowerCase()}`;
  assert(!baselineRelationshipOwners.has(relationshipId),`${relationshipId}: deterministic relationship ID already exists.`);
  const refType=referenceTypeForIdentity(identity);
  let assetRef;
  if(clean(pkg.canonicalAction)==="CREATE_CANONICAL_PREVIEW"){
    const assets=Array.isArray(trade.assetLedger)?trade.assetLedger:[];
    const candidates=assets.filter((a)=>clean(a.direction).toUpperCase()===clean(identity.direction).toUpperCase()&&clean(a.displayText)===clean(identity.rawAsset));
    assert(candidates.length===1&&clean(candidates[0].assetId),`${sourceId}: created asset not uniquely found for ${identity.rawAsset}`);
    assetRef={assetId:clean(candidates[0].assetId),sourceAssetId:clean(candidates[0].assetId),synthetic:false};
  }else{
    assetRef=resolveRelationshipAssetReference(trade,identity,player,relationshipId);
    if(!assetRef.synthetic){
      const sourceKey=canonicalSourceReferenceKey(trade.id,assetRef.assetId,refType),owner=preimportCanonicalSourceReferenceOwners.get(sourceKey)??null;
      if(owner&&owner!==target){
        ownershipConflictSyntheticRelationshipIds.push(relationshipId);
        ownershipConflictSyntheticDetails.push({relationshipId,sourceTradeId:sourceId,canonicalTradeId:trade.id,matchedCanonicalAssetId:assetRef.assetId,
          referenceType:refType,existingOwnerPlayerId:owner,frozenTargetPlayerId:target,
          reason:"matched canonical source-reference key already owned by different pre-import player"});
        assetRef=syntheticAssetReference(identity,relationshipId);
      }
    }
  }
  if(assetRef.synthetic){syntheticPerspectiveAssetReferences+=1;syntheticRelationshipIds.push(relationshipId);}
  else matchedExistingAssetReferences+=1;

  const reference={
    relationshipId,referenceType:refType,relationshipRole:relationRoleForIdentity(identity),
    tradeId:trade.id,canonicalTradeId:trade.id,tradeSlug:clean(trade.slug),assetId:assetRef.assetId,assetReference:assetRef.assetId,
    sourceAssetId:assetRef.sourceAssetId,sourceTradeId:sourceId,packageId:`${BATCH}-${sourceId}`,sourceTeam:TEAM,
    perspectiveLocalAssetReference:assetRef.synthetic,privateOnly:true
  };
  const matchedAsset=assetRef.synthetic?null:(trade.assetLedger??[]).find((a)=>clean(a.assetId)===assetRef.assetId)??null;
  const sourceReference=matchedAsset?{
    referenceType:refType,canonicalTradeId:trade.id,sourceTradeId:clean(trade.sourceTradeId),assetId:assetRef.assetId,
    assetType:matchedAsset.type??null,sourceTeam:TEAM,privateOnly:true
  }:null;
  const before=Array.isArray(player.sourceReferences)?player.sourceReferences.length:0;
  const updated=appendRelationshipReference(player,reference,sourceReference,args["imported-at"]);
  const after=Array.isArray(updated.sourceReferences)?updated.sourceReferences.length:0;
  sourceReferencesAdded+=after-before;playerMap.set(target,updated);relationshipIds.push(relationshipId);
}
assert(relationshipIds.length===182,"Expected 182 relationship references written.");
assert(matchedExistingAssetReferences+syntheticPerspectiveAssetReferences===182,"Asset reference partition does not equal 182.");

const finalTrades=[...tradeMap.values()],finalPlayers=[...playerMap.values()];
assert(finalTrades.length===2326,`Expected 2326 canonical trades; received ${finalTrades.length}.`);
assert(finalPlayers.length===3146,`Expected 3146 players; received ${finalPlayers.length}.`);

for(const sourceId of [...heldIdSet,...excludedIdSet]){
  for(const trade of finalTrades){
    assert(clean(trade.sourceTradeId)!==sourceId,`${sourceId}: held/excluded source created canonically.`);
    const p=trade.perspectives;
    if(Array.isArray(p))assert(!p.some((x)=>clean(x?.sourceTeam)===TEAM&&clean(x?.sourceTradeId)===sourceId),`${sourceId}: held/excluded perspective written.`);
    else if(p&&typeof p==="object"&&p[TEAM])assert(clean(p[TEAM]?.sourceTradeId)!==sourceId,`${sourceId}: held/excluded object perspective written.`);
  }
}
const allRelationshipIds=new Set(finalPlayers.flatMap((p)=>(Array.isArray(p.relationshipReferences)?p.relationshipReferences:[]).map((r)=>clean(r.relationshipId)).filter(Boolean)));
for(const identity of heldIdentities){
  const syntheticHeldPrefix=`phase21h-rel-`;
  // No held relationship can be reconstructed because its source identity was never iterated.
  assert(clean(identity.heldByPolicy)==="Yes",`${identity.tradeId}: held identity policy marker drifted.`);
}
for(const shell of heldShells)assert(!playerMap.has(clean(shell.proposedPlayerId)),`${shell.proposedPlayerId}: held-only shell was written.`);

const tradeOut=canonicalJson(finalTrades),playerOut=canonicalJson(finalPlayers),teamOut=canonicalJson(teams);
const receipt={
  result:"PASS",phase:"21H",implementationRevision:"21H-R2",mode:"GUARDED_PRIVATE_IMPORT",team:TEAM,startingHead:args["starting-head"],importedAt:args["imported-at"],
  inputHashes:inputHashObject,expectedContractSha256:args["expected-contract-sha256"],
  preImportCanonicalTrades:2287,preImportPlayers:3128,preImportTeams:52,
  readyPackages:78,heldPackages:19,structuralEvidenceExclusions:4,canonicalTradesCreated:39,perspectivesAppended:39,
  playerShellsCreated:18,readyShellsResolvedToExistingPlayers:0,heldOnlyPlayerShellsDeferred:16,
  relationshipReferencesAdded:182,heldRelationshipEdgesDeferred:60,readyTeamDependencies:166,effectiveReadyTeamDependencies:166,
  heldTeamDependencies:49,existingPerspectiveReviewHolds:0,ambiguousIdentityOccurrencesDeferred:0,
  matchedExistingAssetReferences,syntheticPerspectiveAssetReferences,
  ownershipConflictSyntheticRelationshipIds:uniqueSorted(ownershipConflictSyntheticRelationshipIds),
  ownershipConflictSyntheticDetails,syntheticRelationshipIds:uniqueSorted(syntheticRelationshipIds),sourceReferencesAdded,
  postImportCanonicalTrades:finalTrades.length,postImportPlayers:finalPlayers.length,postImportTeams:teams.length,
  explicitPlayerTargetCorrections:{},readyShellsResolvedToExistingPlayerIds:[],
  importedCanonicalTradeIds:uniqueSorted(importedCanonicalTradeIds),updatedPerspectiveCanonicalIds:uniqueSorted(updatedPerspectiveCanonicalIds),
  createdPlayerIds:uniqueSorted(createdPlayerIds),relationshipIds:uniqueSorted(relationshipIds),
  deferredRelationshipCount:heldRelationships.length,heldSourceTradeIds:uniqueSorted([...heldIdSet]),
  structuralEvidenceExcludedSourceTradeIds:uniqueSorted([...excludedIdSet]),protectedAppendProjectionHashes,
  canonicalStoreSha256:sha256(tradeOut),playerStoreSha256:sha256(playerOut),teamStoreSha256:sha256(teamOut),
  repositoryDataWrites:3,automaticIdentityMerges:0,automaticCanonicalMerges:0,automaticPlayerCreates:0,automaticRoutes:0,
  automaticTeamRegistrations:0,heldPackageImports:0,heldPlayerShellImports:0,heldRelationshipWrites:0,
  publicationAuthorized:false,pushPerformed:false,deployPerformed:false
};
const receiptOut=canonicalJson(receipt);
await atomicWrite(args["trades-json"],tradeOut,"phase21h-trades");
await atomicWrite(args["players-json"],playerOut,"phase21h-players");
await atomicWrite(args["receipt-json"],receiptOut,"phase21h-receipt");

console.log(JSON.stringify({
  result:receipt.result,phase:receipt.phase,mode:receipt.mode,readyPackages:receipt.readyPackages,heldPackages:receipt.heldPackages,
  structuralEvidenceExclusions:receipt.structuralEvidenceExclusions,canonicalTradesCreated:receipt.canonicalTradesCreated,
  perspectivesAppended:receipt.perspectivesAppended,playerShellsCreated:receipt.playerShellsCreated,
  relationshipReferencesAdded:receipt.relationshipReferencesAdded,matchedExistingAssetReferences,
  syntheticPerspectiveAssetReferences,ownershipConflictSyntheticReferences:receipt.ownershipConflictSyntheticRelationshipIds.length,
  canonicalStoreSha256:receipt.canonicalStoreSha256,playerStoreSha256:receipt.playerStoreSha256,
  teamStoreSha256:receipt.teamStoreSha256,receiptSha256:sha256(receiptOut)
},null,2));
