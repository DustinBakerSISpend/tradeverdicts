# New York Knicks Phase 22H-R3 Cleanroom Private Import Contract

Status: guarded private import
Team: new-york-knicks
Starting HEAD: b9c97bf2aa7cc489600354182c267631b813f562

## Frozen cleanroom plan

Plan SHA256: 288FAE6125473B2474AFA170FF155104B6C59A640DACC93BC72D3CCA5F63162B

Ready / held / excluded: 190 / 22 / 6
Canonical creates / perspective appends: 80 / 110
Routed multi-team canonical creates: 12

Sanitized ready player shells: 75
Sanitized ready relationship references: 446
Ready team dependencies: 403
Held team dependencies: 51

Suppressed pseudo identities: 11
Suppressed ready pseudo-player shells: 7

## Verified post-import state

Trades: 2406
Players: 3221
Teams: 52

Trades SHA256: 6678B688B06F2B692762C41F7F9A10CDF60B25FF5EEF9904D93E2CE83077E6B2
Players SHA256: 6793BE4585853F94D355CA5FE6DDB176B006ABA739788E6C578B3011DC0CF205
Teams SHA256: 26B17E87B6AAA97B28162078701850274A895E49197422B77CA3CE32BF262C90

Matched canonical asset references: 422
Synthetic perspective-local asset references: 24
Source references added: 313

## Safety policy

- Private/noindex import only.
- Held packages remain held.
- Structural exclusions remain excluded.
- No automatic canonical/player/team merges.
- No automatic reciprocal/routing-grade propagation.
- No Charlotte/New Orleans lineage collapse.
- No Seattle/Oklahoma City lineage collapse.
- No historical Baltimore/Washington lineage collapse.
- teams.json is immutable in this phase.
- No push, deploy, public/index, or ads action is authorized by this commit.

## Verification

The frozen cleanroom shadow import passed:
1. fresh import;
2. independent verification;
3. idempotent NOOP replay.

The guarded live replay must reproduce the exact verified store hashes above and must change exactly the six authorized repository paths.