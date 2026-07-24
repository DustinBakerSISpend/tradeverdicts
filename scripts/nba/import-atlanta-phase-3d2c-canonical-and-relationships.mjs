#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i=2;i<argv.length;i+=2){
    const key=argv[i], value=argv[i+1];
    if(!key?.startsWith("--")||value==null) throw new Error(`Invalid argument near ${key}`);
    args[key.slice(2)]=value;
  }
  return args;
}
function assert(value,message){if(!value) throw new Error(message);}
function sha256(value){return createHash("sha256").update(value).digest("hex");}
function normalizedTextHash(bytes){return sha256(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/u,"").replace(/\r\n?/gu,"\n"));}
function uniqueSorted(values){return [...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"en"));}
function canonicalJson(value){return Buffer.from(`${JSON.stringify(value,null,2)}\n`,"utf8");}
async function atomicWrite(filePath,bytes,suffix){await mkdir(path.dirname(filePath),{recursive:true}); const temp=`${filePath}.${suffix}-${process.pid}.tmp`; try{await writeFile(temp,bytes); await rename(temp,filePath);} finally{await rm(temp,{force:true}).catch(()=>{});}}
function slugFor(entry){return `atlanta-hawks-${entry.tradeDate}-${entry.canonicalTradeId.replace(/^nba-trade-\d{8}-/u,"")}`;}
function referenceId(reference){return `${reference.canonicalTradeId}|${reference.assetId}|${reference.referenceType}`;}
function activeReference(reference, edge){
  return {
    referenceId: referenceId(reference),
    referenceType: reference.referenceType,
    playerName: reference.playerName,
    canonicalTradeId: reference.canonicalTradeId,
    sourceTradeId: reference.sourceTradeId,
    tradeDate: reference.tradeDate,
    teams: reference.teams,
    assetId: reference.assetId,
    assetType: reference.assetType,
    displayText: reference.displayText,
    direction: reference.direction,
    fromTeam: reference.fromTeam ?? null,
    toTeam: reference.toTeam ?? null,
    possibleFromTeams: reference.possibleFromTeams ?? [],
    possibleToTeams: reference.possibleToTeams ?? [],
    overall: reference.overall ?? null,
    edgeId: edge.edgeId,
    edgeFreezeSha256: edge.freezeSha256,
    relationshipStatus: "active-frozen-canonical-import",
  };
}
function draftReference(reference){
  if(!["draft_rights","draft_outcome"].includes(reference.referenceType)) return null;
  return {
    referenceType: reference.referenceType,
    sourceTradeId: reference.sourceTradeId,
    tradeDate: reference.tradeDate,
    overall: reference.overall ?? null,
    displayText: reference.displayText,
  };
}
function updatePlayerWithReferences(player, newReferences, importedAt, startingHead, freezeSha){
  const byId=new Map((player.sourceReferences??[]).map(r=>[r.referenceId??referenceId(r),r]));
  for(const ref of newReferences){
    const id=ref.referenceId;
    if(byId.has(id)){
      const existing=byId.get(id);
      assert(JSON.stringify(existing)===JSON.stringify(ref), `${player.id}: existing relationship differs from frozen relationship ${id}`);
    } else byId.set(id,ref);
  }
  const sourceReferences=[...byId.values()].sort((a,b)=>a.referenceId.localeCompare(b.referenceId,"en"));
  const sourceTradeIds=uniqueSorted(sourceReferences.map(r=>r.sourceTradeId));
  const canonicalTradeIds=uniqueSorted(sourceReferences.map(r=>r.canonicalTradeId));
  const referenceTypes=uniqueSorted(sourceReferences.map(r=>r.referenceType));
  const teams=uniqueSorted(sourceReferences.flatMap(r=>r.teams??[]));
  const draftReferences=sourceReferences.map(draftReference).filter(Boolean).sort((a,b)=>
    a.tradeDate.localeCompare(b.tradeDate)||a.sourceTradeId.localeCompare(b.sourceTradeId)||a.referenceType.localeCompare(b.referenceType)
  );
  const importedShell=player.importMetadata?.phase==="3D2B";
  return {
    ...player,
    identityStatus: importedShell ? "source-derived-accepted" : player.identityStatus,
    referenceCount: sourceReferences.length,
    sourceTradeCount: sourceTradeIds.length,
    sourceTradeIds,
    canonicalTradeIds,
    referenceTypes,
    teams,
    draftReferences,
    sourceReferences,
    ...(importedShell ? {
      pendingRelationshipCount: 0,
      pendingSourceTradeIds: [],
      pendingCanonicalTradeIds: [],
      pendingReferenceTypes: [],
      pendingTeams: [],
      pendingSourceReferences: [],
      reviewStatus: "manual-review",
    } : {}),
    updatedAt: importedAt,
    importMetadata: {
      ...(player.importMetadata??{}),
      relationshipActivationPhase: "3D2C",
      relationshipActivatedAt: importedAt,
      relationshipSourceCheckpoint: startingHead,
      relationshipSourceFreezeSha256: freezeSha,
      relationshipPolicy: "exact-frozen-player-trade-edges-activated-with-canonical-import",
    },
  };
}

const args=parseArgs(process.argv);
for(const req of ["freeze-json","phase-3b-json","phase-3c-json","reviewed-json","players-json","trades-json","player-receipt-json","trade-receipt-json","expected-freeze-sha256","expected-player-store-sha256","expected-trade-store-sha256","expected-player-receipt-sha256","imported-at","starting-head"]){assert(args[req],`Missing --${req}`);}
const [freezeBytes,p3bBytes,p3cBytes,reviewBytes,playerBytes,tradeBytes,playerReceiptBytes]=await Promise.all([
  readFile(args["freeze-json"]),readFile(args["phase-3b-json"]),readFile(args["phase-3c-json"]),readFile(args["reviewed-json"]),readFile(args["players-json"]),readFile(args["trades-json"]),readFile(args["player-receipt-json"]),
]);
const freezeSha=args["expected-freeze-sha256"].toLowerCase();
assert(sha256(freezeBytes)===freezeSha,"Corrected freeze SHA-256 mismatch.");
assert(sha256(playerReceiptBytes)===args["expected-player-receipt-sha256"].toLowerCase(),"Phase 3D2B receipt preimage mismatch.");

const freeze=JSON.parse(freezeBytes), p3b=JSON.parse(p3bBytes), p3c=JSON.parse(p3cBytes), reviewed=JSON.parse(reviewBytes), currentPlayers=JSON.parse(playerBytes), currentTrades=JSON.parse(tradeBytes), playerReceipt=JSON.parse(playerReceiptBytes);
assert(freeze.result==="PASS"&&freeze.phase==="3D1","Unexpected freeze.");
assert(freeze.counts.createCanonical===229,"Expected 229 canonical creates.");
assert(freeze.counts.frozenPlayerTradeEdges===556,"Expected 556 frozen player edges.");
assert(freeze.counts.frozenTeamTradeEdges===458,"Expected 458 frozen team edges.");
assert(normalizedTextHash(p3bBytes)===freeze.inputHashes.phase3bPreviewSha256,"Phase 3B preview drifted.");
assert(normalizedTextHash(p3cBytes)===freeze.inputHashes.phase3cPreviewSha256,"Phase 3C preview drifted.");
const existingReceiptBytes=await readFile(args["trade-receipt-json"]).catch(error=>error.code==="ENOENT"?null:Promise.reject(error));
const baselineTrades=currentTrades.filter(trade=>trade.importMetadata?.phase!=="3D2C");
const existingImportedTrades=currentTrades.filter(trade=>trade.importMetadata?.phase==="3D2C");
assert(baselineTrades.length===27,`Expected 27 guarded baseline trades, found ${baselineTrades.length}.`);
assert(sha256(canonicalJson(baselineTrades))===args["expected-trade-store-sha256"].toLowerCase(),"Guarded baseline trade records changed.");
assert(currentPlayers.length===509,"Expected 509 players.");
assert(playerReceipt.result==="PASS"&&playerReceipt.phase==="3D2B"&&playerReceipt.importedPlayerShells===442,"Unexpected player receipt.");
if(existingReceiptBytes===null){
  assert(existingImportedTrades.length===0,"Existing 3D2C trades found without a receipt.");
  assert(sha256(playerBytes)===args["expected-player-store-sha256"].toLowerCase(),"Player store preimage mismatch.");
}else{
  assert(existingImportedTrades.length===229,`Expected 229 existing 3D2C trades on replay, found ${existingImportedTrades.length}.`);
}

const createManifest=freeze.tradeManifest.filter(e=>e.importAction==="create-canonical").sort((a,b)=>a.canonicalTradeId.localeCompare(b.canonicalTradeId,"en"));
assert(createManifest.length===229,"Create manifest count mismatch.");
const manifestById=new Map(createManifest.map(e=>[e.canonicalTradeId,e]));
assert(manifestById.size===229,"Duplicate manifest IDs.");
const p3bById=new Map(p3b.records.map(r=>[r.provisionalCanonicalId,r]));
const reviewById=new Map(reviewed.records.map(r=>[r.tradeId,r]));
const routesByTrade=new Map();
for(const route of freeze.assetRoutes){if(!routesByTrade.has(route.canonicalTradeId)) routesByTrade.set(route.canonicalTradeId,new Map()); routesByTrade.get(route.canonicalTradeId).set(route.assetId,route);}
const teamEdgesByTrade=new Map();
for(const edge of freeze.relationships.teamTradeEdges){if(!teamEdgesByTrade.has(edge.canonicalTradeId)) teamEdgesByTrade.set(edge.canonicalTradeId,[]); teamEdgesByTrade.get(edge.canonicalTradeId).push(edge);}
const playerEdgesByPlayer=new Map();
for(const edge of freeze.relationships.playerTradeEdges){if(!playerEdgesByPlayer.has(edge.playerId)) playerEdgesByPlayer.set(edge.playerId,[]); playerEdgesByPlayer.get(edge.playerId).push(edge);}
assert([...routesByTrade.values()].reduce((n,m)=>n+m.size,0)===690,"Route manifest count mismatch.");

const importedAt=args["imported-at"];
const importedTrades=createManifest.map(entry=>{
  const preview=p3bById.get(entry.canonicalTradeId), row=reviewById.get(entry.sourceTradeId);
  assert(preview&&row,`${entry.sourceTradeId}: missing source preview/review.`);
  assert(preview.canonicalDataReady===true&&preview.blockers.length===0,`${entry.sourceTradeId}: preview not ready.`);
  assert(preview.teams.length===2&&entry.teams.length===2,`${entry.sourceTradeId}: not two-team.`);
  assert(preview.sourcePerspectiveKey===entry.sourcePerspectiveKey&&preview.transactionFingerprint===entry.transactionFingerprint,`${entry.sourceTradeId}: frozen identity mismatch.`);
  const routeMap=routesByTrade.get(entry.canonicalTradeId)??new Map();
  assert(routeMap.size===preview.assetLedger.length,`${entry.sourceTradeId}: route count mismatch.`);
  const assetLedger=preview.assetLedger.map(asset=>{
    const route=routeMap.get(asset.assetId);
    assert(route&&route.routingReady===true&&route.automaticRouting===false,`${entry.sourceTradeId}/${asset.assetId}: route not frozen.`);
    assert(route.fromTeam===asset.fromTeam&&route.toTeam===asset.toTeam,`${entry.sourceTradeId}/${asset.assetId}: route drift.`);
    const {previewOnly,...clean}=asset;
    return {...clean, fromTeam:route.fromTeam, toTeam:route.toTeam, possibleFromTeams:[], possibleToTeams:[], routingStatus:"resolved", auditStatus:"frozen-atlanta-phase-3d2c"};
  });
  const assetsReceived=Object.fromEntries(entry.teams.map(team=>[team,assetLedger.filter(a=>a.toTeam===team)]));
  const assetsSentByTeam=Object.fromEntries(entry.teams.map(team=>[team,assetLedger.filter(a=>a.fromTeam===team)]));
  const teamEdges=(teamEdgesByTrade.get(entry.canonicalTradeId)??[]).sort((a,b)=>a.teamSlug.localeCompare(b.teamSlug,"en"));
  assert(teamEdges.length===2&&teamEdges.map(e=>e.teamSlug).join("|")===entry.teams.slice().sort().join("|"),`${entry.sourceTradeId}: team edge mismatch.`);
  const grade=preview.grades[entry.sourceTeam];
  return {
    id:entry.canonicalTradeId,
    league:"nba",
    slug:slugFor(entry),
    tradeDate:entry.tradeDate,
    seasonLabel:preview.seasonLabel,
    teams:entry.teams,
    sourceTeams:[entry.sourceTeam],
    assetsReceived,
    assetsSentByTeam,
    assetLedger,
    unresolvedAssetRouting:[],
    routingCompleteness:"complete",
    summary:preview.summary,
    verdict:preview.verdict,
    grades:preview.grades,
    aggregatePartnerGrade:preview.aggregatePartnerGrade??null,
    perspectives:{
      [entry.sourceTeam]:{
        sourceSubmissionId:`atlanta-hawks-phase-3a-${entry.sourceTradeId}`,
        editorialStatus:"reconciled-ready-for-private-import",
        grade,
        verdict:preview.verdict,
        summary:preview.summary,
        analysis:preview.analysis,
        confidence:preview.confidence,
        reviewStatus:preview.reviewStatus,
        tradeTier:row.tradeTier,
      }
    },
    sources:[
      {
        submissionId:`atlanta-hawks-phase-3a-${entry.sourceTradeId}`,
        batchId:"atlanta-hawks-phase-3a",
        sourceTeam:entry.sourceTeam,
        sourceRowId:entry.sourceTradeId,
        sourceFileName:"src/data/nba/raw/atlanta-hawks-phase-3a.txt",
        sourceLabel:"User-provided Atlanta Hawks trade-history batch with Meta/Grok and ChatGPT reconciliation",
        receivedAt:"2026-07-23T00:00:00.000Z",
        rawText:row.sourceRawText,
        rawFields:{tradeDate:row.tradeDate,teams:entry.teams,partnerTeams:row.partnerTeams,assetsReceived:row.assetsReceivedText,assetsSent:row.assetsSentText,relationshipText:row.relationshipText},
        contentHash:sha256(row.sourceRawText),
      },
      ...(row.externalSourceUrl?[{sourceType:"external_reference",sourceUrl:row.externalSourceUrl,sourceLabel:row.sourceBasis,reviewStatus:row.reviewStatus}]:[]),
    ],
    canonicalKey:entry.provisionalCanonicalKey,
    dateTeamsKey:entry.dateTeamsKey,
    publishStatus:"private",
    reviewStatus:"manual-review",
    indexEligible:false,
    adEligible:false,
    createdAt:importedAt,
    updatedAt:importedAt,
    candidateAction:"create-new-canonical-candidate",
    candidateId:`nba-candidate-${entry.sourceTradeId.toLowerCase()}`,
    sourceTradeId:entry.sourceTradeId,
    canonicalDataReady:true,
    publicationReady:false,
    automaticMerge:false,
    canonicalImportPerformed:true,
    auditResolution:null,
    auditMetadata:{confidence:preview.confidence,sourceReviewStatus:preview.reviewStatus,tradeTier:row.tradeTier,dataQualityFlags:row.dataQualityFlags,contentClass:row.contentClass,lowValueRisk:row.lowValueRisk,contentRationale:row.contentRationale,minimumPublicTreatment:row.minimumPublicTreatment},
    importMetadata:{phase:"3D2C",batchId:"atlanta-hawks-phase-3d2c-canonical-import",importedAt,sourceFreezeSha256:freezeSha,sourceTradeFreezeSha256:entry.freezeSha256,sourceCheckpoint:args["starting-head"],transactionFingerprint:entry.transactionFingerprint,sourcePerspectiveKey:entry.sourcePerspectiveKey,visibilityPolicy:"private-noindex-ad-free",routingPolicy:"exact-frozen-two-team-routes",relationshipPolicy:"exact-frozen-player-and-team-edges-activated-with-canonical-import"},
  };
});

const importedIds=new Set(importedTrades.map(t=>t.id)), importedSlugs=new Set(importedTrades.map(t=>t.slug));
assert(importedIds.size===229&&importedSlugs.size===229,"Imported trade ID/slug collision.");
for(const trade of baselineTrades){assert(!importedIds.has(trade.id),`Existing trade ID collision: ${trade.id}`); assert(!importedSlugs.has(trade.slug),`Existing trade slug collision: ${trade.slug}`);}
const allTrades=[...baselineTrades,...importedTrades];

const identityById=new Map();
for(const identity of p3c.playerIdentity.identities){const id=identity.provisionalPlayerId??identity.existingPlayerId; if(id) identityById.set(id,identity);}
const playerById=new Map(currentPlayers.map(p=>[p.id,p]));
let activated=0;
for(const [playerId,edgeList] of playerEdgesByPlayer){
  const player=playerById.get(playerId), identity=identityById.get(playerId);
  assert(player&&identity,`${playerId}: missing player/identity.`);
  const newReferences=[];
  for(const edge of edgeList){
    assert(manifestById.has(edge.canonicalTradeId),`${playerId}: edge points outside create manifest.`);
    const matches=(identity.sourceReferences??[]).filter(reference=>
      reference.canonicalTradeId===edge.canonicalTradeId&&
      reference.sourceTradeId===edge.sourceTradeId&&
      reference.assetId===edge.assetId&&
      reference.referenceType===edge.referenceType
    );
    assert(matches.length===1,`${playerId}: frozen identity edge match count ${matches.length}.`);
    const reference=matches[0];
    if(existingReceiptBytes===null&&player.importMetadata?.phase==="3D2B"){
      const pendingMatches=(player.pendingSourceReferences??[]).filter(item=>
        item.edgeId===edge.edgeId&&item.edgeFreezeSha256===edge.freezeSha256
      );
      assert(pendingMatches.length===1,`${playerId}: pending edge match count ${pendingMatches.length}.`);
    }
    newReferences.push(activeReference(reference,edge)); activated++;
  }
  playerById.set(playerId,updatePlayerWithReferences(player,newReferences,importedAt,args["starting-head"],freezeSha));
}
assert(activated===556,"Activated edge count mismatch.");
const allPlayers=currentPlayers.map(p=>playerById.get(p.id));
assert(allPlayers.length===509,"Player count changed.");

const tradeOut=canonicalJson(allTrades), playerOut=canonicalJson(allPlayers);
const receipt={
  result:"PASS",phase:"3D2C",mode:"FROZEN_CANONICAL_AND_RELATIONSHIP_IMPORT",startingHead:args["starting-head"],importedAt,sourceFreezeSha256:freezeSha,preImportCanonicalTrades:27,importedCanonicalTrades:229,postImportCanonicalTrades:256,preImportPlayers:509,postImportPlayers:509,activatedPlayerTradeEdges:556,activatedTeamTradeEdges:458,automaticMerges:0,automaticRoutes:0,existingPerspectiveUpdates:0,traePerspectiveReconciled:false,canonicalStoreSha256:sha256(tradeOut),playerStoreSha256:sha256(playerOut),canonicalTradeIds:importedTrades.map(t=>t.id).sort(),playerRelationshipIds:[...playerEdgesByPlayer.keys()].sort(),visibilityPolicy:"private-noindex-ad-free",pushPerformed:false,deployPerformed:false,
};
const receiptOut=canonicalJson(receipt);
if(existingReceiptBytes!==null){
  assert(Buffer.compare(tradeBytes,tradeOut)===0,"Replay trade output is not byte-identical.");
  assert(Buffer.compare(playerBytes,playerOut)===0,"Replay player output is not byte-identical.");
  assert(Buffer.compare(existingReceiptBytes,receiptOut)===0,"Replay receipt is not byte-identical.");
  console.log(JSON.stringify({result:"PASS",phase:"3D2C",mode:"IDEMPOTENT_REPLAY",canonicalTradesAdded:0,playerRelationshipsActivated:0,repositoryDataWrites:0,canonicalStoreSha256:sha256(tradeBytes),playerStoreSha256:sha256(playerBytes),receiptSha256:sha256(existingReceiptBytes)},null,2));
  process.exit(0);
}
await atomicWrite(args["trades-json"],tradeOut,"3d2c-trades");
await atomicWrite(args["players-json"],playerOut,"3d2c-players");
await atomicWrite(args["trade-receipt-json"],receiptOut,"3d2c-receipt");
console.log(JSON.stringify({result:"PASS",phase:"3D2C",mode:"FIRST_IMPORT",canonicalTradesAdded:229,playerRelationshipsActivated:556,teamRelationshipsActivated:458,repositoryDataWrites:3,canonicalStoreSha256:sha256(tradeOut),playerStoreSha256:sha256(playerOut),receiptSha256:sha256(receiptOut)},null,2));
