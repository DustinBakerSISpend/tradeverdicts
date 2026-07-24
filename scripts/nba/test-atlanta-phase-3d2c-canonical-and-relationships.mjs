#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPrivateQueryIndex } from "../../src/lib/nba/build-private-query-index.mjs";
import { buildPrivateRouteModels } from "../../src/lib/nba/build-private-route-models.mjs";
import { buildPrivateRelationshipGraph } from "../../src/lib/nba/build-private-relationship-graph.mjs";

function parseArgs(argv){const args={}; for(let i=2;i<argv.length;i+=2){const key=argv[i],value=argv[i+1]; if(!key?.startsWith("--")||value==null) throw new Error(`Invalid argument near ${key}`); args[key.slice(2)]=value;} return args;}
function assert(value,message){if(!value) throw new Error(message);}
function sha256(value){return createHash("sha256").update(value).digest("hex");}
function canonicalJson(value){return Buffer.from(`${JSON.stringify(value,null,2)}\n`,"utf8");}
function normalizedTextHash(bytes){return sha256(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/u,"").replace(/\r\n?/gu,"\n"));}
function referenceKey(reference){return `${reference.canonicalTradeId}|${reference.assetId}|${reference.referenceType}`;}

const args=parseArgs(process.argv);
for(const req of ["freeze-json","phase-3b-json","phase-3c-json","players-json","trades-json","teams-json","player-receipt-json","trade-receipt-json","expected-freeze-sha256","expected-baseline-player-sha256","expected-baseline-trade-sha256","expected-player-receipt-sha256","starting-head"]){assert(args[req],`Missing --${req}`);}
const [freezeBytes,p3bBytes,p3cBytes,playerBytes,tradeBytes,teamBytes,playerReceiptBytes,tradeReceiptBytes]=await Promise.all([
  readFile(args["freeze-json"]),readFile(args["phase-3b-json"]),readFile(args["phase-3c-json"]),readFile(args["players-json"]),readFile(args["trades-json"]),readFile(args["teams-json"]),readFile(args["player-receipt-json"]),readFile(args["trade-receipt-json"]),
]);
const freeze=JSON.parse(freezeBytes), p3b=JSON.parse(p3bBytes), p3c=JSON.parse(p3cBytes), players=JSON.parse(playerBytes), trades=JSON.parse(tradeBytes), teams=JSON.parse(teamBytes), playerReceipt=JSON.parse(playerReceiptBytes), receipt=JSON.parse(tradeReceiptBytes);
const freezeSha=args["expected-freeze-sha256"].toLowerCase();
assert(sha256(freezeBytes)===freezeSha,"Freeze SHA mismatch.");
assert(normalizedTextHash(p3bBytes)===freeze.inputHashes.phase3bPreviewSha256,"Phase 3B preview drifted.");
assert(normalizedTextHash(p3cBytes)===freeze.inputHashes.phase3cPreviewSha256,"Phase 3C preview drifted.");
assert(sha256(playerReceiptBytes)===args["expected-player-receipt-sha256"].toLowerCase(),"Phase 3D2B receipt changed.");
assert(Array.isArray(trades)&&trades.length===256,`Expected 256 trades, found ${trades.length}.`);
assert(Array.isArray(players)&&players.length===509,`Expected 509 players, found ${players.length}.`);

const baselineTrades=trades.filter(trade=>trade.importMetadata?.phase!=="3D2C");
const importedTrades=trades.filter(trade=>trade.importMetadata?.phase==="3D2C");
assert(baselineTrades.length===27,"Baseline trade count changed.");
assert(importedTrades.length===229,"Imported trade count mismatch.");
assert(sha256(canonicalJson(baselineTrades))===args["expected-baseline-trade-sha256"].toLowerCase(),"Baseline trade records changed.");
const importedPlayerShells=players.filter(player=>player.importMetadata?.phase==="3D2B");
const baselinePlayers=players.filter(player=>player.importMetadata?.phase!=="3D2B").map(player=>{
  if(player.importMetadata?.relationshipActivationPhase!=="3D2C") return player;
  return player;
});
assert(importedPlayerShells.length===442,"Phase 3D2B player-shell count changed.");
assert(playerReceipt.result==="PASS"&&playerReceipt.phase==="3D2B","Unexpected player receipt.");
assert(playerReceipt.playerStoreSha256===args["expected-baseline-player-sha256"].toLowerCase(),"Phase 3D2B receipt player-store hash mismatch.");

const manifest=freeze.tradeManifest.filter(entry=>entry.importAction==="create-canonical");
const manifestById=new Map(manifest.map(entry=>[entry.canonicalTradeId,entry]));
assert(manifestById.size===229,"Freeze create manifest mismatch.");
const previewById=new Map(p3b.records.map(record=>[record.provisionalCanonicalId,record]));
const importedIds=new Set();
const importedSlugs=new Set();
let importedAssets=0;
for(const trade of importedTrades){
  const entry=manifestById.get(trade.id), preview=previewById.get(trade.id);
  assert(entry&&preview,`${trade.id}: not authorized by freeze/preview.`);
  importedIds.add(trade.id); importedSlugs.add(trade.slug);
  assert(trade.sourceTradeId===entry.sourceTradeId,`${trade.id}: source ID mismatch.`);
  assert(trade.tradeDate===entry.tradeDate,`${trade.id}: date mismatch.`);
  assert(JSON.stringify(trade.teams)===JSON.stringify(entry.teams),`${trade.id}: teams mismatch.`);
  assert(trade.teams.length===2,`${trade.id}: non-two-team trade imported.`);
  assert(trade.canonicalKey===entry.provisionalCanonicalKey,`${trade.id}: canonical key mismatch.`);
  assert(trade.dateTeamsKey===entry.dateTeamsKey,`${trade.id}: date/team key mismatch.`);
  assert(trade.importMetadata?.sourceTradeFreezeSha256===entry.freezeSha256,`${trade.id}: trade freeze hash mismatch.`);
  assert(trade.importMetadata?.transactionFingerprint===entry.transactionFingerprint,`${trade.id}: fingerprint mismatch.`);
  assert(trade.importMetadata?.sourcePerspectiveKey===entry.sourcePerspectiveKey,`${trade.id}: perspective key mismatch.`);
  assert(trade.publishStatus==="private"&&trade.indexEligible===false&&trade.adEligible===false&&trade.publicationReady===false,`${trade.id}: privacy mismatch.`);
  assert(trade.automaticMerge===false&&trade.canonicalImportPerformed===true,`${trade.id}: import/merge policy mismatch.`);
  assert(trade.routingCompleteness==="complete"&&(trade.unresolvedAssetRouting??[]).length===0,`${trade.id}: routing incomplete.`);
  assert(Object.keys(trade.perspectives??{}).length===1&&trade.perspectives[entry.sourceTeam],`${trade.id}: source perspective mismatch.`);
  assert((trade.sourceTeams??[]).length===1&&trade.sourceTeams[0]===entry.sourceTeam,`${trade.id}: source team mismatch.`);
  assert(trade.assetLedger.length===entry.assetIds.length,`${trade.id}: asset count mismatch.`);
  importedAssets+=trade.assetLedger.length;
  const assetIds=trade.assetLedger.map(asset=>asset.assetId).sort();
  assert(JSON.stringify(assetIds)===JSON.stringify(entry.assetIds.slice().sort()),`${trade.id}: asset IDs mismatch.`);
  for(const asset of trade.assetLedger){
    assert(asset.fromTeam&&asset.toTeam&&asset.fromTeam!==asset.toTeam,`${trade.id}/${asset.assetId}: explicit route missing.`);
    assert(asset.routingStatus==="resolved"&&asset.auditStatus==="frozen-atlanta-phase-3d2c",`${trade.id}/${asset.assetId}: route audit mismatch.`);
    assert(asset.previewOnly===undefined,`${trade.id}/${asset.assetId}: preview marker retained.`);
  }
}
assert(importedIds.size===229&&importedSlugs.size===229,"Imported trade ID/slug collision.");
assert(importedAssets===690,"Imported asset count mismatch.");
assert([...manifestById.keys()].every(id=>importedIds.has(id)),"A frozen canonical ID was not imported.");

const trae=trades.find(trade=>trade.id==="nba-trade-20260109-e1724a128785");
assert(trae,"Existing Trae Young canonical missing.");
assert(Object.keys(trae.perspectives??{}).length===1&&trae.perspectives["washington-wizards"],"Trae perspective was reconciled too early.");
assert(!trae.perspectives["atlanta-hawks"],"Atlanta Trae perspective was added in Phase 3D2C.");
assert(trae.importMetadata?.phase==="2K","Existing Trae canonical metadata changed.");

const edgeByKey=new Map();
for(const edge of freeze.relationships.playerTradeEdges){
  const key=`${edge.canonicalTradeId}|${edge.assetId}|${edge.referenceType}`;
  assert(!edgeByKey.has(key),`Duplicate frozen player edge ${key}`);
  edgeByKey.set(key,edge);
}
assert(edgeByKey.size===556,"Frozen player edge count mismatch.");
let activeAtlantaEdges=0;
const activeKeys=new Set();
for(const player of players){
  assert(player.publishStatus==="private"&&player.indexEligible===false&&player.adEligible===false&&player.publicationReady===false,`${player.id}: player privacy mismatch.`);
  for(const reference of player.sourceReferences??[]){
    const key=referenceKey(reference);
    if(!edgeByKey.has(key)) continue;
    const edge=edgeByKey.get(key);
    assert(reference.edgeId===edge.edgeId&&reference.edgeFreezeSha256===edge.freezeSha256,`${player.id}/${key}: frozen edge provenance mismatch.`);
    assert(reference.relationshipStatus==="active-frozen-canonical-import",`${player.id}/${key}: relationship status mismatch.`);
    assert(!activeKeys.has(key),`Duplicate active relationship ownership ${key}`);
    activeKeys.add(key); activeAtlantaEdges++;
  }
  if(player.importMetadata?.phase==="3D2B"){
    assert(player.pendingRelationshipCount===0,`${player.id}: pending count not cleared.`);
    assert((player.pendingSourceReferences??[]).length===0,`${player.id}: pending references not cleared.`);
    assert(player.reviewStatus==="manual-review"&&player.identityStatus==="source-derived-accepted",`${player.id}: shell activation status mismatch.`);
  }
}
assert(activeAtlantaEdges===556&&activeKeys.size===556,"Active frozen player-edge count mismatch.");

assert(receipt.result==="PASS"&&receipt.phase==="3D2C","Unexpected 3D2C receipt.");
assert(receipt.startingHead===args["starting-head"],"Receipt starting checkpoint mismatch.");
assert(receipt.sourceFreezeSha256===freezeSha,"Receipt freeze mismatch.");
assert(receipt.importedCanonicalTrades===229&&receipt.postImportCanonicalTrades===256,"Receipt trade counts mismatch.");
assert(receipt.activatedPlayerTradeEdges===556&&receipt.activatedTeamTradeEdges===458,"Receipt relationship counts mismatch.");
assert(receipt.existingPerspectiveUpdates===0&&receipt.traePerspectiveReconciled===false,"Receipt reports premature Trae reconciliation.");
assert(receipt.automaticMerges===0&&receipt.automaticRoutes===0,"Receipt reports automatic behavior.");
assert(receipt.canonicalStoreSha256===sha256(tradeBytes)&&receipt.playerStoreSha256===sha256(playerBytes),"Receipt store hash mismatch.");
assert(new Set(receipt.canonicalTradeIds).size===229,"Receipt canonical IDs are not unique.");

const graph=buildPrivateRelationshipGraph({trades,players,teams});
assert(graph.counts.playerTradeReferenceEdges===646,"Relationship graph player-edge count mismatch.");
assert(graph.counts.teamTradeEdges===524,"Relationship graph team-edge count mismatch.");
assert(graph.counts.missingPlayerReferences===0&&graph.counts.extraPlayerReferences===0&&graph.counts.invalidPlayerReferences===0&&graph.counts.duplicateReferenceOwnership===0&&graph.counts.invalidTradeTeams===0,"Relationship graph invariant failure.");
const query=buildPrivateQueryIndex({trades,players,teams});
const routes=buildPrivateRouteModels({trades,players,teams});
assert(query.counts.canonicalTrades===256,"Query canonical count mismatch.");
assert(query.counts.players===509,"Query player count mismatch.");
assert(query.counts.representedTeams===36,"Query represented-team count mismatch.");
assert(query.counts.playerTradeReferences===646,"Query player-reference count mismatch.");
assert(query.counts.playerIdentityKeys===512&&query.counts.ambiguousExactIdentityKeys===0,"Query identity count/collision mismatch.");
assert(query.counts.sharedPerspectiveTrades===2,"Shared-perspective count changed before Trae reconciliation.");
assert(routes.counts.routeModels===805,"Route model count mismatch.");
assert(routes.counts.tradeDetailModels===256&&routes.counts.playerDetailModels===509&&routes.counts.teamDetailModels===36,"Route detail counts mismatch.");
assert(routes.counts.internalLinks===3144,"Internal-link count mismatch.");
assert(routes.counts.brokenLinks===0&&routes.counts.privacyViolations===0&&routes.counts.routeCreatedModels===0,"Route safety invariant failure.");

console.log(JSON.stringify({result:"PASS",phase:"3D2C",baselineCanonicalTrades:27,importedCanonicalTrades:229,totalCanonicalTrades:256,playerRecords:509,importedAssets:690,activatedPlayerTradeEdges:556,activatedTeamTradeEdges:458,existingPerspectiveUpdates:0,traePerspectiveReconciled:false,automaticMerges:0,automaticRoutes:0,representedTeams:36,privateRouteModels:805,privateInternalLinks:3144,canonicalStoreSha256:sha256(tradeBytes),playerStoreSha256:sha256(playerBytes),receiptSha256:sha256(tradeReceiptBytes),repositoryDataWritesValidated:3},null,2));
