#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv){const args={}; for(let i=2;i<argv.length;i+=2){const key=argv[i],value=argv[i+1]; if(!key?.startsWith("--")||value==null) throw new Error(`Invalid argument near ${key}`); args[key.slice(2)]=value;} return args;}
function assert(value,message){if(!value) throw new Error(message);}
function sha256(value){return createHash("sha256").update(value).digest("hex");}
function canonicalJson(value){return Buffer.from(`${JSON.stringify(value,null,2)}\n`,"utf8");}
async function atomicWrite(filePath,bytes){await mkdir(path.dirname(filePath),{recursive:true}); const temp=`${filePath}.baseline-${process.pid}.tmp`; try{await writeFile(temp,bytes); await rename(temp,filePath);} finally{await rm(temp,{force:true}).catch(()=>{});}}

const args=parseArgs(process.argv);
for(const req of ["players-json","receipt-json","output-json","expected-current-player-sha256","expected-receipt-sha256","expected-baseline-player-sha256"]){assert(args[req],`Missing --${req}`);}
const [playerBytes,receiptBytes]=await Promise.all([readFile(args["players-json"]),readFile(args["receipt-json"])]);
assert(sha256(playerBytes)===args["expected-current-player-sha256"].toLowerCase(),"Current Phase 3D2B player-store SHA mismatch.");
assert(sha256(receiptBytes)===args["expected-receipt-sha256"].toLowerCase(),"Phase 3D2B receipt SHA mismatch.");
const players=JSON.parse(playerBytes.toString("utf8")), receipt=JSON.parse(receiptBytes.toString("utf8"));
assert(Array.isArray(players)&&players.length===509,`Expected 509 current players, found ${players.length}.`);
assert(receipt.result==="PASS"&&receipt.phase==="3D2B"&&receipt.importedPlayerShells===442,"Unexpected Phase 3D2B receipt.");
const imported=players.filter(player=>player.importMetadata?.phase==="3D2B");
const baseline=players.filter(player=>player.importMetadata?.phase!=="3D2B");
assert(imported.length===442,`Expected 442 imported shells, found ${imported.length}.`);
assert(baseline.length===67,`Expected 67 baseline players, found ${baseline.length}.`);
const baselineBytes=canonicalJson(baseline);
assert(sha256(baselineBytes)===args["expected-baseline-player-sha256"].toLowerCase(),"Reconstructed baseline player SHA mismatch.");
await atomicWrite(args["output-json"],baselineBytes);
console.log(JSON.stringify({result:"PASS",phase:"3D2C-BASELINE-RECONSTRUCTION",currentPlayerRecords:509,excludedPhase3d2bShells:442,baselinePlayerRecords:67,baselinePlayerStoreSha256:sha256(baselineBytes),repositoryDataWrites:0},null,2));
