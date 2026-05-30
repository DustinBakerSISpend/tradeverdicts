# TradeVerdicts Data Schema v1

## Trade Object

Every trade should contain:

* id
* slug
* league
* tradeDate
* season
* teams
* assetsReceived
* verdict
* grades
* confidence
* tier
* summary
* analysis

Example:

{
"id": "nfl-min-bal-2020-ngakoue",
"slug": "yannick-ngakoue-ravens-2020",
"league": "NFL",
"tradeDate": "2020-10-22",
"season": 2020,
"teams": [
"minnesota-vikings",
"baltimore-ravens"
],
"tier": "major",
"verdict": "Ravens Win",
"confidence": "high"
}

---

## Team Object

Required:

* name
* slug
* league
* conference
* division
* founded
* logo

Example:

{
"name": "Minnesota Vikings",
"slug": "minnesota-vikings",
"league": "NFL"
}

---

## Player Object

Required:

* name
* slug
* position
* teams

Example:

{
"name": "Yannick Ngakoue",
"slug": "yannick-ngakoue",
"position": "EDGE"
}

---

## Trade Tier Definitions

major

* franchise altering
* superstar involved
* iconic trade
* receives full analysis page

standard

* meaningful trade
* normal verdict page

minor

* database record only

---

## Confidence Definitions

high
medium
low

---

## League Codes

NFL
NBA
MLB
NHL
