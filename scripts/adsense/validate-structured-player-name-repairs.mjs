import fs from "node:fs";
import path from "node:path";
import {
  getPublicPlayerRecords,
  getPublicTrades,
  getRelatedPublicTrades,
} from "../../src/utils/publicRecords.js";

const repo = process.cwd();
const outputPath = process.argv[2];
const repairs = [
  {
    "slug": "aaron-brown-lewis",
    "before": "Aaron Brown (Lewis",
    "after": "Aaron Brown (Lewis)",
    "tradeSlugs": [
      "francis-peay-green-bay-packers-1973"
    ]
  },
  {
    "slug": "ahmad-rashad-formerly-bobby-moore",
    "before": "Ahmad Rashad (formerly Bobby Moore",
    "after": "Ahmad Rashad (formerly Bobby Moore)",
    "tradeSlugs": [
      "ahmad-rashad-bobby-moore-seattle-seahawks-1976"
    ]
  },
  {
    "slug": "al-clark-a",
    "before": "Al Clark (a",
    "after": "Al Clark (a)",
    "tradeSlugs": [
      "1973-third-round-pick-75-levi-johnson-los-angeles-st-louis-rams-1972-08-22"
    ]
  },
  {
    "slug": "al-davis-a",
    "before": "Al Davis (a",
    "after": "Al Davis (a)",
    "tradeSlugs": [
      "al-davis-a-philadelphia-eagles-1973"
    ]
  },
  {
    "slug": "al-williams-a",
    "before": "Al Williams (a",
    "after": "Al Williams (a)",
    "tradeSlugs": [
      "unspecified-consideration-tampa-bay-buccaneers-1988"
    ]
  },
  {
    "slug": "allen-aldridge-sr",
    "before": "Allen Aldridge (Sr",
    "after": "Allen Aldridge (Sr.)",
    "tradeSlugs": [
      "allen-aldridge-sr-houston-oilers-tennessee-titans-1973"
    ]
  },
  {
    "slug": "alonzo-highsmith-walter",
    "before": "Alonzo Highsmith (Walter",
    "after": "Alonzo Highsmith (Walter)",
    "tradeSlugs": [
      "alonzo-highsmith-walter-houston-oilers-1990"
    ]
  },
  {
    "slug": "alvin-mitchell-a",
    "before": "Alvin Mitchell (a",
    "after": "Alvin Mitchell (a)",
    "tradeSlugs": [
      "alvin-mitchell-a-cleveland-browns-1970"
    ]
  },
  {
    "slug": "andre-anderson-a",
    "before": "Andre Anderson (a",
    "after": "Andre Anderson (a)",
    "tradeSlugs": [
      "1979-undisclosed-draft-pick-new-york-jets-1978"
    ]
  },
  {
    "slug": "andy-livingston-a",
    "before": "Andy Livingston (a",
    "after": "Andy Livingston (a)",
    "tradeSlugs": [
      "saints-1969-07-17-chicago-bears-andy-livingston-a",
      "saints-1971-05-07-philadelphia-eagles-1972-draft-pick"
    ]
  },
  {
    "slug": "art-anderson-a",
    "before": "Art Anderson (a",
    "after": "Art Anderson (a)",
    "tradeSlugs": [
      "art-anderson-a-chicago-bears-1963"
    ]
  },
  {
    "slug": "aubrey-phillips-red-phillips-a",
    "before": "Aubrey Phillips / Red Phillips (a",
    "after": "Aubrey Phillips / Red Phillips (a)",
    "tradeSlugs": [
      "les-richter-dallas-texans-1952"
    ]
  },
  {
    "slug": "ben-davis-a",
    "before": "Ben Davis (a",
    "after": "Ben Davis (a)",
    "tradeSlugs": [
      "1975-fifth-round-pick-119-jim-cope-a-detroit-lions-1974-175"
    ]
  },
  {
    "slug": "bernard-jackson-frank",
    "before": "Bernard Jackson (Frank",
    "after": "Bernard Jackson (Frank)",
    "tradeSlugs": [
      "bernard-jackson-frank-cincinnati-bengals-1977",
      "tim-kearney-bengals-1975-09-01"
    ]
  },
  {
    "slug": "bert-jones-hays",
    "before": "Bert Jones (Hays",
    "after": "Bert Jones (Hays)",
    "tradeSlugs": [
      "bert-jones-hays-indianapolis-colts-1982"
    ]
  },
  {
    "slug": "bill-anderson-a",
    "before": "Bill Anderson (a",
    "after": "Bill Anderson (a)",
    "tradeSlugs": [
      "1966-sixth-round-pick-94-earl-yates-green-bay-packers-1965"
    ]
  },
  {
    "slug": "bill-brown-dorsey",
    "before": "Bill Brown (Dorsey",
    "after": "Bill Brown (Dorsey)",
    "tradeSlugs": [
      "bill-brown-chicago-bears-1962"
    ]
  },
  {
    "slug": "bill-glass-a",
    "before": "Bill Glass (a",
    "after": "Bill Glass (a)",
    "tradeSlugs": [
      "bill-glass-a-jim-ninowski-howard-cassady-hopalong-cassady-detroit-lions-1962-87"
    ]
  },
  {
    "slug": "bill-hunter-billy-hunter-a",
    "before": "Bill Hunter / Billy Hunter (a",
    "after": "Bill Hunter / Billy Hunter (a)",
    "tradeSlugs": [
      "1967-ninth-round-pick-washington-redskins-commanders-1966"
    ]
  },
  {
    "slug": "bill-johnson-henry",
    "before": "Bill Johnson (Henry",
    "after": "Bill Johnson (Henry)",
    "tradeSlugs": [
      "bill-johnson-henry-new-york-giants-1972"
    ]
  },
  {
    "slug": "bill-lee-a",
    "before": "Bill Lee (a",
    "after": "Bill Lee (a)",
    "tradeSlugs": [
      "bill-lee-a-brooklyn-dodgers-1937"
    ]
  },
  {
    "slug": "bill-miller-joseph",
    "before": "Bill Miller (Joseph",
    "after": "Bill Miller (Joseph)",
    "tradeSlugs": [
      "bill-miller-joseph-kansas-city-chiefs-1963",
      "undisclosed-draft-pick-cash-las-vegas-raiders-1964"
    ]
  },
  {
    "slug": "bill-nelson-b",
    "before": "Bill Nelson (b",
    "after": "Bill Nelson (b)",
    "tradeSlugs": [
      "dick-shiner-cleveland-browns-1968"
    ]
  },
  {
    "slug": "bill-peterson-a",
    "before": "Bill Peterson (a",
    "after": "Bill Peterson (a)",
    "tradeSlugs": [
      "1974-fourth-round-pick-87-mike-boryla-new-england-patriots-1973"
    ]
  },
  {
    "slug": "bill-thomas-b",
    "before": "Bill Thomas (b",
    "after": "Bill Thomas (b)",
    "tradeSlugs": [
      "bill-thomas-b-houston-oilers-1974"
    ]
  },
  {
    "slug": "bill-triplett-clarence",
    "before": "Bill Triplett (Clarence",
    "after": "Bill Triplett (Clarence)",
    "tradeSlugs": [
      "undisclosed-consideration-arizona-st-louis-cardinals-1962",
      "undisclosed-consideration-arizona-st-louis-cardinals-1967",
      "undisclosed-consideration-detroit-lions-1968"
    ]
  },
  {
    "slug": "billy-wilson-b",
    "before": "Billy Wilson (b",
    "after": "Billy Wilson (b)",
    "tradeSlugs": [
      "george-hultz-arizona-st-louis-cardinals-1963"
    ]
  },
  {
    "slug": "bob-adams-b",
    "before": "Bob Adams (b",
    "after": "Bob Adams (b)",
    "tradeSlugs": [
      "1974-seventh-or-eighth-round-pick-conditional-on-adams-playing-time-165-allen-sitterle-al-sitterle-new-england-boston-patriots-1973",
      "1976-seventh-round-pick-202-perry-brooks-tennessee-titans-1975"
    ]
  },
  {
    "slug": "bob-brown-earl",
    "before": "Bob Brown (Earl",
    "after": "Bob Brown (Earl)",
    "tradeSlugs": [
      "bob-brown-earl-arizona-st-louis-cardinals-1971",
      "draft-pick-trade-new-orleans-saints-1972"
    ]
  },
  {
    "slug": "bob-brown-eddie",
    "before": "Bob Brown (Eddie",
    "after": "Bob Brown (Eddie)",
    "tradeSlugs": [
      "unspecified-consideration-green-bay-packers-1974"
    ]
  },
  {
    "slug": "bob-brown-s",
    "before": "Bob Brown (S",
    "after": "Bob Brown (S.)",
    "tradeSlugs": [
      "bob-brown-s-jim-nettles-philadelphia-eagles-1969",
      "kent-mccloughan-harry-schuh-las-vegas-raiders-1971"
    ]
  },
  {
    "slug": "bob-chandler-b",
    "before": "Bob Chandler (b",
    "after": "Bob Chandler (b)",
    "tradeSlugs": [
      "bob-chandler-b-buffalo-bills-1980"
    ]
  },
  {
    "slug": "bob-davis-c",
    "before": "Bob Davis (c",
    "after": "Bob Davis (c)",
    "tradeSlugs": [
      "saints-1973-06-05-new-york-jets-bob-davis-c-steve-oneal-1974-fourth-round-pick-8"
    ]
  },
  {
    "slug": "bob-griffin-b",
    "before": "Bob Griffin (b",
    "after": "Bob Griffin (b)",
    "tradeSlugs": [
      "steve-kiner-patriots-1972"
    ]
  },
  {
    "slug": "bob-hayes-lee",
    "before": "Bob Hayes (Lee",
    "after": "Bob Hayes (Lee)",
    "tradeSlugs": [
      "bob-hayes-lee-dallas-cowboys-1975"
    ]
  },
  {
    "slug": "bob-hudson-c",
    "before": "Bob Hudson (c",
    "after": "Bob Hudson (c)",
    "tradeSlugs": [
      "bob-hudson-c-green-bay-packers-1973"
    ]
  },
  {
    "slug": "bob-long-andrew",
    "before": "Bob Long (Andrew",
    "after": "Bob Long (Andrew)",
    "tradeSlugs": [
      "bob-long-andrew-atlanta-falcons-1969",
      "bob-long-andrew-green-bay-packers-1968",
      "undisclosed-draft-pick-los-angeles-st-louis-rams-1970"
    ]
  },
  {
    "slug": "bob-long-wendell",
    "before": "Bob Long (Wendell",
    "after": "Bob Long (Wendell)",
    "tradeSlugs": [
      "bob-long-los-angeles-rams-1962",
      "bob-long-wendell-1961-first-round-pick-10-bob-crespino-bobby-crespino-detroit-li",
      "bob-long-wendell-los-angeles-st-louis-rams-1955-10-02",
      "leon-clarke-los-angeles-st-louis-rams-1960-68"
    ]
  },
  {
    "slug": "bob-miller-b",
    "before": "Bob Miller (b",
    "after": "Bob Miller (b)",
    "tradeSlugs": [
      "unspecified-consideration-new-orleans-saints-1970-lac-1970-0042"
    ]
  },
  {
    "slug": "bob-miller-marguesse",
    "before": "Bob Miller (Marguesse",
    "after": "Bob Miller (Marguesse)",
    "tradeSlugs": [
      "eagles-1959-07-14-detroit-lions-0044"
    ]
  },
  {
    "slug": "bob-reinhard-richard",
    "before": "Bob Reinhard (Richard",
    "after": "Bob Reinhard (Richard)",
    "tradeSlugs": [
      "bob-reinhard-richard-arizona-st-louis-cardinals-1950"
    ]
  },
  {
    "slug": "bob-reynolds-a",
    "before": "Bob Reynolds (a",
    "after": "Bob Reynolds (a)",
    "tradeSlugs": [
      "lou-gordon-arizona-st-louis-cardinals-1936"
    ]
  },
  {
    "slug": "bob-rush-jeffrey",
    "before": "Bob Rush (Jeffrey",
    "after": "Bob Rush (Jeffrey)",
    "tradeSlugs": [
      "bob-rush-jeffrey-los-angeles-san-diego-chargers-1983"
    ]
  },
  {
    "slug": "bob-sanders-joe",
    "before": "Bob Sanders (Joe",
    "after": "Bob Sanders (Joe)",
    "tradeSlugs": [
      "james-wilson-a-jim-wilson-bob-sanders-joe-atlanta-falcons-1968"
    ]
  },
  {
    "slug": "bob-taylor-a",
    "before": "Bob Taylor (a",
    "after": "Bob Taylor (a)",
    "tradeSlugs": [
      "bob-taylor-a-new-york-giants-1965"
    ]
  },
  {
    "slug": "bob-thomas-lee",
    "before": "Bob Thomas (Lee",
    "after": "Bob Thomas (Lee)",
    "tradeSlugs": [
      "unspecified-consideration-los-angelesst-louis-rams-1973-lac-1973-0088"
    ]
  },
  {
    "slug": "bob-williams-a",
    "before": "Bob Williams (a",
    "after": "Bob Williams (a)",
    "tradeSlugs": [
      "dick-barwegan-dick-barwegen-chicago-bears-1953"
    ]
  },
  {
    "slug": "bobby-humphrey-b",
    "before": "Bobby Humphrey (b",
    "after": "Bobby Humphrey (b)",
    "tradeSlugs": [
      "sammie-smith-miami-dolphins-1992"
    ]
  },
  {
    "slug": "bobby-lee-d",
    "before": "Bobby Lee (D",
    "after": "Bobby Lee (D.)",
    "tradeSlugs": [
      "cardinals-1969-07-23-chicago-bears-curtiss-gentry-curtis-gentry-curt-gentry-bobby-lee-d-1970-si"
    ]
  },
  {
    "slug": "bobby-lee-johnson-bobby-johnson-lee",
    "before": "Bobby Lee Johnson / Bobby Johnson (Lee",
    "after": "Bobby Lee Johnson / Bobby Johnson (Lee)",
    "tradeSlugs": [
      "unspecified-consideration-new-york-giants-1987"
    ]
  },
  {
    "slug": "bobby-williams-a",
    "before": "Bobby Williams (a",
    "after": "Bobby Williams (a)",
    "tradeSlugs": [
      "bobby-williams-a-chicago-bears-1953"
    ]
  },
  {
    "slug": "bruce-anderson-albert",
    "before": "Bruce Anderson (Albert",
    "after": "Bruce Anderson (Albert)",
    "tradeSlugs": [
      "bruce-anderson-albert-new-york-giants-1970",
      "draft-pick-possibly-1969-67-jon-sandstron-new-york-giants-1967",
      "tom-barrington-new-orleans-saints-1971"
    ]
  },
  {
    "slug": "burl-toler-a",
    "before": "Burl Toler (a",
    "after": "Burl Toler (a)",
    "tradeSlugs": [
      "darrel-brewster-pete-brewster-arizona-st-louis-cardinals-1952-23"
    ]
  },
  {
    "slug": "carl-allen-b",
    "before": "Carl Allen (b",
    "after": "Carl Allen (b)",
    "tradeSlugs": [
      "1978-eleventh-round-pick-292-calvin-prince-cal-prince-arizona-st-louis"
    ]
  },
  {
    "slug": "charles-bryant-a-charlie-bryant-a",
    "before": "Charles Bryant (a) / Charlie Bryant (a",
    "after": "Charles Bryant (a) / Charlie Bryant (a)?",
    "tradeSlugs": [
      "charles-bryant-a-charlie-bryant-a-arizona-cardinals-1968"
    ]
  },
  {
    "slug": "charles-jackson-melvin",
    "before": "Charles Jackson (Melvin",
    "after": "Charles Jackson (Melvin)",
    "tradeSlugs": [
      "1985-seventh-round-pick-178-karl-powe-new-york-jets-1985"
    ]
  },
  {
    "slug": "charles-wood-a",
    "before": "Charles Wood (a",
    "after": "Charles Wood (a)",
    "tradeSlugs": [
      "charles-wood-a-new-orleans-saints-1967"
    ]
  },
  {
    "slug": "charley-johnson-charlie-johnson-lane",
    "before": "Charley Johnson / Charlie Johnson (Lane",
    "after": "Charley Johnson / Charlie Johnson (Lane)",
    "tradeSlugs": [
      "cardinals-1970-01-21-houston-oilers-tennessee-titans-miller-farr-pete-beathard-charley-johnson",
      "charley-johnson-charlie-johnson-lane-houston-oilers-tennessee-titans-1972"
    ]
  },
  {
    "slug": "chuck-allen-a",
    "before": "Chuck Allen (a",
    "after": "Chuck Allen (a)",
    "tradeSlugs": [
      "chuck-allen-a-los-angeles-san-diego-chargers-1970"
    ]
  },
  {
    "slug": "curtis-brown-jerome",
    "before": "Curtis Brown (Jerome",
    "after": "Curtis Brown (Jerome)",
    "tradeSlugs": [
      "curtis-brown-jerome-buffalo-bills-1983"
    ]
  },
  {
    "slug": "dan-nugent-a",
    "before": "Dan Nugent (a",
    "after": "Dan Nugent (a)",
    "tradeSlugs": [
      "1980-second-round-pick-50-irvin-pankey-irv-pankey-1980-third-round-pick-77-craig"
    ]
  },
  {
    "slug": "dave-brown-steven",
    "before": "Dave Brown (Steven",
    "after": "Dave Brown (Steven)",
    "tradeSlugs": [
      "1988-eleventh-round-pick-284-rick-mcleod-green-bay-packers-1987"
    ]
  },
  {
    "slug": "dave-costa-a",
    "before": "Dave Costa (a",
    "after": "Dave Costa (a)",
    "tradeSlugs": [
      "1967-sixth-round-pick-149-bill-wilkerson-las-vegas-raiders-1966",
      "dave-costa-a-los-angeles-chargers-1974",
      "dave-costa-third-round-pick-buffalo-bills-1967",
      "eddie-ray-san-diego-los-angeles-chargers-1972"
    ]
  },
  {
    "slug": "dave-davis-henry",
    "before": "Dave Davis (Henry",
    "after": "Dave Davis (Henry)",
    "tradeSlugs": [
      "eagles-1954-08-26-green-bay-packers-0031"
    ]
  },
  {
    "slug": "dave-little-gene",
    "before": "Dave Little (Gene",
    "after": "Dave Little (Gene)",
    "tradeSlugs": [
      "1991-eighth-round-pick-198-greg-amsler-arizona-st-louis-cardinals-1990"
    ]
  },
  {
    "slug": "dave-logan-russell",
    "before": "Dave Logan (Russell",
    "after": "Dave Logan (Russell)",
    "tradeSlugs": [
      "dave-logan-russell-cleveland-browns-1984"
    ]
  },
  {
    "slug": "dave-simmons-alan",
    "before": "Dave Simmons (Alan",
    "after": "Dave Simmons (Alan)",
    "tradeSlugs": [
      "saints-1968-08-14-dallas-cowboys-1969-fourth-round-pick-102-bob-hudspeth"
    ]
  },
  {
    "slug": "david-greenwood-dave-greenwood-b",
    "before": "David Greenwood / Dave Greenwood (b",
    "after": "David Greenwood / Dave Greenwood (b)",
    "tradeSlugs": [
      "david-greenwood-dave-greenwood-b-new-orleans-saints-1985"
    ]
  },
  {
    "slug": "david-lewis-dave-lewis-a",
    "before": "David Lewis / Dave Lewis (a",
    "after": "David Lewis / Dave Lewis (a)",
    "tradeSlugs": [
      "cash-new-england-patriots-1974",
      "david-lewis-dave-lewis-a-cincinnati-bengals-1974"
    ]
  },
  {
    "slug": "david-lewis-dave-lewis-rodney",
    "before": "David Lewis / Dave Lewis (Rodney",
    "after": "David Lewis / Dave Lewis (Rodney)",
    "tradeSlugs": [
      "unspecified-consideration-tampa-bay-buccaneers-1982-lac-1982-0207"
    ]
  },
  {
    "slug": "david-washington-dave-washington-b",
    "before": "David Washington / Dave Washington (b",
    "after": "David Washington / Dave Washington (b)",
    "tradeSlugs": [
      "1977-fifth-round-pick-127-neil-o-donoghue-san-francisco-49ers-1975",
      "1979-fifth-round-pick-119-jerry-aldridge-detroit-lions-1978",
      "al-andrews-buffalo-bills-1972"
    ]
  },
  {
    "slug": "derek-kennard-craig",
    "before": "Derek Kennard (Craig",
    "after": "Derek Kennard (Craig)",
    "tradeSlugs": [
      "saints-1991-08-19-arizona-cardinals-st-louis-cardinals-derek-kennard-craig-1992"
    ]
  },
  {
    "slug": "derrick-williams-a",
    "before": "Derrick Williams (a",
    "after": "Derrick Williams (a)",
    "tradeSlugs": [
      "undisclosed-draft-pick-new-england-patriots-1975"
    ]
  },
  {
    "slug": "dick-davis-a",
    "before": "Dick Davis (a",
    "after": "Dick Davis (a)",
    "tradeSlugs": [
      "rights-to-stone-johnson-las-vegas-oakland-raiders-1963"
    ]
  },
  {
    "slug": "dick-gordon-frederick",
    "before": "Dick Gordon (Frederick",
    "after": "Dick Gordon (Frederick)",
    "tradeSlugs": [
      "john-mosier-new-england-patriots-1974"
    ]
  },
  {
    "slug": "dick-wood-a",
    "before": "Dick Wood (a",
    "after": "Dick Wood (a)",
    "tradeSlugs": [
      "dick-wood-a-new-york-jets-1965"
    ]
  },
  {
    "slug": "dom-sigilro-sp",
    "before": "Dom Sigilro (sp",
    "after": "Dom Sigilro (sp?)",
    "tradeSlugs": [
      "johnny-schiechl-chicago-bears-1945-08-18"
    ]
  },
  {
    "slug": "don-brown-a",
    "before": "Don Brown (a",
    "after": "Don Brown (a)",
    "tradeSlugs": [
      "don-brown-a-arizona-st-louis-cardinals-1960",
      "ollie-matson-arizona-st-louis-cardinals-1959"
    ]
  },
  {
    "slug": "don-coleman-a",
    "before": "Don Coleman (a",
    "after": "Don Coleman (a)",
    "tradeSlugs": [
      "don-coleman-a-arizona-st-louis-cardinals-1954"
    ]
  },
  {
    "slug": "don-martin-a",
    "before": "Don Martin (a",
    "after": "Don Martin (a)",
    "tradeSlugs": [
      "don-martin-a-los-angeles-st-louis-rams-1969"
    ]
  },
  {
    "slug": "don-paul-b",
    "before": "Don Paul (b",
    "after": "Don Paul (b)",
    "tradeSlugs": [
      "cardinals-1954-01-30-los-angeles-st-louis-rams-washington-commanders-richard-lane-dick-lane-nig",
      "don-paul-b-cardinals-rams-1954",
      "don-paul-b-washington-redskins-commanders-1954-34"
    ]
  },
  {
    "slug": "don-perkins-anthony",
    "before": "Don Perkins (Anthony",
    "after": "Don Perkins (Anthony)",
    "tradeSlugs": [
      "1962-ninth-round-pick-116-roy-walker-dallas-cowboys-1960"
    ]
  },
  {
    "slug": "doug-goodwin-a",
    "before": "Doug Goodwin (a",
    "after": "Doug Goodwin (a)",
    "tradeSlugs": [
      "bob-long-andrew-green-bay-packers-1968"
    ]
  },
  {
    "slug": "doug-jones-a",
    "before": "Doug Jones (a",
    "after": "Doug Jones (a)",
    "tradeSlugs": [
      "doug-jones-a-kansas-city-chiefs-1975"
    ]
  },
  {
    "slug": "earl-thomas-lewis",
    "before": "Earl Thomas (Lewis",
    "after": "Earl Thomas (Lewis)",
    "tradeSlugs": [
      "cardinals-1974-08-23-chicago-bears-earl-thomas-lewis-wayne-mulligan-clifford-mcclain-cliff-mccl",
      "earl-thomas-lewis-arizona-st-louis-cardinals-1976"
    ]
  },
  {
    "slug": "ed-bell-eddie-bell-b",
    "before": "Ed Bell / Eddie Bell (b",
    "after": "Ed Bell / Eddie Bell (b)",
    "tradeSlugs": [
      "draft-pick-green-bay-packers-1976"
    ]
  },
  {
    "slug": "ed-brown-b",
    "before": "Ed Brown (b",
    "after": "Ed Brown (b)",
    "tradeSlugs": [
      "1963-first-round-pick-11-dave-behrman-chicago-bears-1962",
      "bob-wade-indianapolis-baltimore-colts-1968"
    ]
  },
  {
    "slug": "ed-cooke-grey",
    "before": "Ed Cooke (Grey",
    "after": "Ed Cooke (Grey)",
    "tradeSlugs": [
      "dick-guesman-new-york-jets-1964"
    ]
  },
  {
    "slug": "ed-hughes-d",
    "before": "Ed Hughes (D",
    "after": "Ed Hughes (D.)",
    "tradeSlugs": [
      "1957-fourth-round-pick-47-lamar-lundy-new-york-giants-1956"
    ]
  },
  {
    "slug": "ed-o-neil-b",
    "before": "Ed O'Neil (b",
    "after": "Ed O'Neil (b)",
    "tradeSlugs": [
      "1981-ninth-round-pick-240-dave-martin-b-new-england-patriots-1980-07-24"
    ]
  },
  {
    "slug": "ed-white-alvin",
    "before": "Ed White (Alvin",
    "after": "Ed White (Alvin)",
    "tradeSlugs": [
      "rickey-young-los-angeles-chargers-1978"
    ]
  },
  {
    "slug": "ed-wood-a",
    "before": "Ed Wood (a",
    "after": "Ed Wood (a)",
    "tradeSlugs": [
      "bill-schroll-chuck-schroll-charley-schroll-ed-wood-a-1952-first-round-pick-10-be"
    ]
  },
  {
    "slug": "eddie-wilson-a",
    "before": "Eddie Wilson (a",
    "after": "Eddie Wilson (a)",
    "tradeSlugs": [
      "1965-draft-pick-new-england-boston-patriots-1964",
      "n-a-patriots-1967"
    ]
  },
  {
    "slug": "eric-harris-b",
    "before": "Eric Harris (b",
    "after": "Eric Harris (b)",
    "tradeSlugs": [
      "eric-harris-b-kansas-city-chiefs-1983"
    ]
  },
  {
    "slug": "eric-williams-michael",
    "before": "Eric Williams (Michael",
    "after": "Eric Williams (Michael)",
    "tradeSlugs": [
      "james-wilder-sr-washington-redskins-commanders-1990-09-13"
    ]
  },
  {
    "slug": "eric-williams-t",
    "before": "Eric Williams (T",
    "after": "Eric Williams (T.)",
    "tradeSlugs": [
      "eric-williams-t-detroit-lions-1990"
    ]
  },
  {
    "slug": "ernie-jones-lee",
    "before": "Ernie Jones (Lee",
    "after": "Ernie Jones (Lee)",
    "tradeSlugs": [
      "ernie-jones-lee-arizona-st-louis-cardinals-1993"
    ]
  },
  {
    "slug": "ernie-wheelwright-lamour",
    "before": "Ernie Wheelwright (Lamour",
    "after": "Ernie Wheelwright (Lamour)",
    "tradeSlugs": [
      "ray-ogden-new-orleans-saints-1967"
    ]
  },
  {
    "slug": "francis-o-brien-fran-o-brien-b",
    "before": "Francis O'Brien / Fran O'Brien (b",
    "after": "Francis O'Brien / Fran O'Brien (b)",
    "tradeSlugs": [
      "cash-pittsburgh-steelers-1966",
      "sam-baker-h-washington-redskins-commanders-1960-63"
    ]
  },
  {
    "slug": "frank-patrick-b",
    "before": "Frank Patrick (b",
    "after": "Frank Patrick (b)",
    "tradeSlugs": [
      "rocky-wallace-arizona-st-louis-cardinals-1973"
    ]
  },
  {
    "slug": "fred-davis-lee",
    "before": "Fred Davis (Lee",
    "after": "Fred Davis (Lee)",
    "tradeSlugs": [
      "tom-harmon-a-chicago-bears-1946"
    ]
  },
  {
    "slug": "fred-dean-rudolph",
    "before": "Fred Dean (Rudolph",
    "after": "Fred Dean (Rudolph)",
    "tradeSlugs": [
      "fred-dean-rudolph-los-angeles-san-diego-chargers-1981"
    ]
  },
  {
    "slug": "fred-miller-david",
    "before": "Fred Miller (David",
    "after": "Fred Miller (David)",
    "tradeSlugs": [
      "1974-tenth-round-pick-pick-may-have-been-conditional-and-not-exercised-washingto"
    ]
  },
  {
    "slug": "garrard-ramsey-buster-ramsey-assistant-coach",
    "before": "Garrard Ramsey / Buster Ramsey (assistant coach",
    "after": "Garrard Ramsey / Buster Ramsey (assistant coach)",
    "tradeSlugs": [
      "garrard-ramsey-buster-ramsey-assistant-coach-arizona-st-louis-cardinals-1952-05"
    ]
  },
  {
    "slug": "gary-anderson-wayne",
    "before": "Gary Anderson (Wayne",
    "after": "Gary Anderson (Wayne)",
    "tradeSlugs": [
      "unspecified-consideration-tampa-bay-buccaneers-1990"
    ]
  },
  {
    "slug": "gary-davis-b",
    "before": "Gary Davis (b",
    "after": "Gary Davis (b)",
    "tradeSlugs": [
      "jimmy-dubose-buccaneers-1980"
    ]
  },
  {
    "slug": "gary-johnson-lynn",
    "before": "Gary Johnson (Lynn",
    "after": "Gary Johnson (Lynn)",
    "tradeSlugs": [
      "gary-johnson-lynn-los-angeles-san-diego-chargers-1984"
    ]
  },
  {
    "slug": "gene-donaldson-a",
    "before": "Gene Donaldson (a",
    "after": "Gene Donaldson (a)",
    "tradeSlugs": [
      "1957-fifth-round-pick-52-henry-jordan-green-bay-packers-1956-39"
    ]
  },
  {
    "slug": "gene-moore-a",
    "before": "Gene Moore (a",
    "after": "Gene Moore (a)",
    "tradeSlugs": [
      "gene-moore-a-brooklyn-dodgers-1939"
    ]
  },
  {
    "slug": "george-allen-robert",
    "before": "George Allen (Robert",
    "after": "George Allen (Robert)",
    "tradeSlugs": [
      "draft-pick-possibly-1969-256-bob-naponic-oakland-los-angeles-las-vegas"
    ]
  },
  {
    "slug": "george-mira-sr",
    "before": "George Mira (Sr",
    "after": "George Mira (Sr.)",
    "tradeSlugs": [
      "randy-beisler-philadelphia-eagles-1969"
    ]
  },
  {
    "slug": "george-rogers-washington",
    "before": "George Rogers (Washington",
    "after": "George Rogers (Washington)",
    "tradeSlugs": [
      "george-rogers-washington-new-orleans-saints-1985"
    ]
  },
  {
    "slug": "george-williams-b",
    "before": "George Williams (b",
    "after": "George Williams (b)",
    "tradeSlugs": [
      "rob-mcgovern-new-england-patriots-1993-296"
    ]
  },
  {
    "slug": "gerald-riggs-sr",
    "before": "Gerald Riggs (Sr",
    "after": "Gerald Riggs (Sr.)",
    "tradeSlugs": [
      "gerald-riggs-sr-atlanta-falcons-1989"
    ]
  },
  {
    "slug": "greg-boyd-earl",
    "before": "Greg Boyd (Earl",
    "after": "Greg Boyd (Earl)",
    "tradeSlugs": [
      "1984-eighth-round-pick-207-winford-hood-green-bay-packers-1983"
    ]
  },
  {
    "slug": "greg-brown-lee",
    "before": "Greg Brown (Lee",
    "after": "Greg Brown (Lee)",
    "tradeSlugs": [
      "greg-brown-lee-philadelphia-eagles-1987"
    ]
  },
  {
    "slug": "greg-roberts-a",
    "before": "Greg Roberts (a",
    "after": "Greg Roberts (a)",
    "tradeSlugs": [
      "greg-roberts-a-tennessee-titans-1976"
    ]
  },
  {
    "slug": "henry-moore-a",
    "before": "Henry Moore (a",
    "after": "Henry Moore (a)",
    "tradeSlugs": [
      "undisclosed-consideration-indianapolis-baltimore-colts-1957"
    ]
  },
  {
    "slug": "ike-hill-a",
    "before": "Ike Hill (a",
    "after": "Ike Hill (a)",
    "tradeSlugs": [
      "1-cash-chicago-bears-1973"
    ]
  },
  {
    "slug": "ike-thomas-a",
    "before": "Ike Thomas (a",
    "after": "Ike Thomas (a)",
    "tradeSlugs": [
      "1973-second-round-pick-green-bay-packers-1972"
    ]
  },
  {
    "slug": "jack-bush-a",
    "before": "Jack Bush (a",
    "after": "Jack Bush (a)",
    "tradeSlugs": [
      "undisclosed-consideration-green-bay-packers-1949"
    ]
  },
  {
    "slug": "jake-scott-e",
    "before": "Jake Scott (E",
    "after": "Jake Scott (E.)",
    "tradeSlugs": [
      "jake-scott-e-miami-dolphins-1976"
    ]
  },
  {
    "slug": "james-files-jim-files-b",
    "before": "James Files / Jim Files (b",
    "after": "James Files / Jim Files (b)",
    "tradeSlugs": [
      "1978-draft-pick-undisclosed-overall-player-new-york-giants-1977"
    ]
  },
  {
    "slug": "james-harris-larnell",
    "before": "James Harris (Larnell",
    "after": "James Harris (Larnell)",
    "tradeSlugs": [
      "unspecified-consideration-los-angelesst-louis-rams-1977-lac-1977-0160"
    ]
  },
  {
    "slug": "james-johnson-b",
    "before": "James Johnson (b",
    "after": "James Johnson (b)",
    "tradeSlugs": [
      "past-considerations-los-angeles-san-diego-chargers-1987"
    ]
  },
  {
    "slug": "james-jones-roosevelt",
    "before": "James Jones (Roosevelt",
    "after": "James Jones (Roosevelt)",
    "tradeSlugs": [
      "james-jones-roosevelt-detroit-lions-1989"
    ]
  },
  {
    "slug": "james-thaxton-jim-thaxton-ivory",
    "before": "James Thaxton / Jim Thaxton (Ivory",
    "after": "James Thaxton / Jim Thaxton (Ivory)",
    "tradeSlugs": [
      "draft-pick-las-vegas-oakland-raiders-1975-186",
      "saints-1978-08-27-arizona-cardinals-st-louis-cardinals-1979-seventh-round-pick",
      "unspecified-consideration-cleveland-browns-1974"
    ]
  },
  {
    "slug": "james-thomas-j-t-thomas-a",
    "before": "James Thomas / J.T. Thomas (a",
    "after": "James Thomas / J.T. Thomas (a)",
    "tradeSlugs": [
      "james-thomas-j-t-thomas-a-pittsburgh-steelers-1982"
    ]
  },
  {
    "slug": "james-wilder-sr",
    "before": "James Wilder (Sr",
    "after": "James Wilder (Sr.)",
    "tradeSlugs": [
      "eric-williams-t-detroit-lions-1990",
      "james-wilder-sr-washington-redskins-commanders-1990-09-13"
    ]
  },
  {
    "slug": "jeff-smith-keith",
    "before": "Jeff Smith (Keith",
    "after": "Jeff Smith (Keith)",
    "tradeSlugs": [
      "1988-eighth-round-pick-198-anthony-sim-tampa-bay-buccaneers-1987"
    ]
  },
  {
    "slug": "jerry-ellison-a",
    "before": "Jerry Ellison (a",
    "after": "Jerry Ellison (a)",
    "tradeSlugs": [
      "jerry-ellison-a-philadelphia-eagles-1973"
    ]
  },
  {
    "slug": "jerry-moore-porter",
    "before": "Jerry Moore (Porter",
    "after": "Jerry Moore (Porter)",
    "tradeSlugs": [
      "saints-1973-09-10-chicago-bears-jerry-moore-porter"
    ]
  },
  {
    "slug": "jerry-richardson-johnson",
    "before": "Jerry Richardson (Johnson",
    "after": "Jerry Richardson (Johnson)",
    "tradeSlugs": [
      "1962-undisclosed-draft-pick-philadelphia-eagles-1961",
      "jerry-richardson-johnson-new-york-giants-1961",
      "undisclosed-consideration-indianapolis-baltimore-colts-1961"
    ]
  },
  {
    "slug": "jerry-robinson-dewayne",
    "before": "Jerry Robinson (Dewayne",
    "after": "Jerry Robinson (Dewayne)",
    "tradeSlugs": [
      "jerry-robinson-dewayne-philadelphia-eagles-1985"
    ]
  },
  {
    "slug": "jerry-wilson-roscoe",
    "before": "Jerry Wilson (Roscoe",
    "after": "Jerry Wilson (Roscoe)",
    "tradeSlugs": [
      "jerry-wilson-roscoe-philadelphia-eagles-1960"
    ]
  },
  {
    "slug": "jessie-hester-lee",
    "before": "Jessie Hester (Lee",
    "after": "Jessie Hester (Lee)",
    "tradeSlugs": [
      "jessie-hester-lee-las-vegas-raiders-1988"
    ]
  },
  {
    "slug": "jim-bailey-r",
    "before": "Jim Bailey (R",
    "after": "Jim Bailey (R.)",
    "tradeSlugs": [
      "1975-fourth-round-pick-93-paul-linford-new-york-jets-1975",
      "jim-bailey-r-new-york-jets-1976-195"
    ]
  },
  {
    "slug": "jim-carter-a",
    "before": "Jim Carter (a",
    "after": "Jim Carter (a)",
    "tradeSlugs": [
      "jim-carter-a-indianapolis-baltimore-colts-1966"
    ]
  },
  {
    "slug": "jim-duncan-a",
    "before": "Jim Duncan (a",
    "after": "Jim Duncan (a)?",
    "tradeSlugs": [
      "1951-ninth-round-pick-105-burl-toler-1951-twelfth-round-pick-142-milan-seillers"
    ]
  },
  {
    "slug": "jim-duncan-b",
    "before": "Jim Duncan (b",
    "after": "Jim Duncan (b)",
    "tradeSlugs": [
      "john-shinners-new-orleans-saints-1972"
    ]
  },
  {
    "slug": "jim-ford-a",
    "before": "Jim Ford (a",
    "after": "Jim Ford (a)",
    "tradeSlugs": [
      "undisclosed-consideration-green-bay-packers-1949"
    ]
  },
  {
    "slug": "jim-harris-jimmy-harris-a",
    "before": "Jim Harris / Jimmy Harris (a",
    "after": "Jim Harris / Jimmy Harris (a)",
    "tradeSlugs": [
      "buck-lansford-jim-harris-jimmy-harris-a-1959-first-round-pick-2-dick-bass-a-phil",
      "jim-harris-jimmy-harris-los-angeles-rams-1960"
    ]
  },
  {
    "slug": "jim-jensen-douglas",
    "before": "Jim Jensen (Douglas",
    "after": "Jim Jensen (Douglas)",
    "tradeSlugs": [
      "jim-jensen-douglas-dallas-cowboys-1977"
    ]
  },
  {
    "slug": "jim-kelly-harry",
    "before": "Jim Kelly (Harry",
    "after": "Jim Kelly (Harry)",
    "tradeSlugs": [
      "jim-kelly-harry-philadelphia-eagles-1968"
    ]
  },
  {
    "slug": "jim-leo-a",
    "before": "Jim Leo (a",
    "after": "Jim Leo (a)",
    "tradeSlugs": [
      "jim-leo-a-new-york-giants-1961"
    ]
  },
  {
    "slug": "jim-marshall-lawrence",
    "before": "Jim Marshall (Lawrence",
    "after": "Jim Marshall (Lawrence)",
    "tradeSlugs": [
      "draft-picks-minnesota-vikings-1961-82",
      "jim-prestel-cleveland-browns-1961"
    ]
  },
  {
    "slug": "jim-mills-anthony",
    "before": "Jim Mills (Anthony",
    "after": "Jim Mills (Anthony)",
    "tradeSlugs": [
      "jim-mills-anthony-baltimore-indianapolis-colts-1986"
    ]
  },
  {
    "slug": "jim-o-brien-a",
    "before": "Jim O'Brien (a",
    "after": "Jim O'Brien (a)",
    "tradeSlugs": [
      "jim-o-brien-a-las-vegas-raiders-1961"
    ]
  },
  {
    "slug": "jim-o-brien-b",
    "before": "Jim O'Brien (b",
    "after": "Jim O'Brien (b)",
    "tradeSlugs": [
      "jim-o-brien-b-baltimore-indianapolis-colts-1973-07-26"
    ]
  },
  {
    "slug": "jim-phillips-red-phillips-b",
    "before": "Jim Phillips / Red Phillips (b",
    "after": "Jim Phillips / Red Phillips (b)",
    "tradeSlugs": [
      "jim-phillips-red-phillips-b-los-angeles-st-louis-rams-1964"
    ]
  },
  {
    "slug": "jim-price-bluford",
    "before": "Jim Price (Bluford",
    "after": "Jim Price (Bluford)",
    "tradeSlugs": [
      "dick-guesman-new-york-jets-1964"
    ]
  },
  {
    "slug": "jim-strong-harold",
    "before": "Jim Strong (Harold",
    "after": "Jim Strong (Harold)",
    "tradeSlugs": [
      "saints-1973-07-13-las-vegas-raiders-oakland-raiders-draft-pick-possibly-1974-71"
    ]
  },
  {
    "slug": "jim-turner-bayard",
    "before": "Jim Turner (Bayard",
    "after": "Jim Turner (Bayard)",
    "tradeSlugs": [
      "jim-turner-bayard-new-york-jets-1971"
    ]
  },
  {
    "slug": "jim-ward-edgar-harold",
    "before": "Jim Ward (Edgar Harold",
    "after": "Jim Ward (Edgar Harold)",
    "tradeSlugs": [
      "1973-draft-pick-possibly-177-jim-peterson-new-orleans-saints-1971",
      "saints-1971-08-16-detroit-lions-carl-cunningham",
      "saints-1971-08-23-philadelphia-eagles-richard-harvey-dick-harvey-a"
    ]
  },
  {
    "slug": "jimmy-williams-henry",
    "before": "Jimmy Williams (Henry",
    "after": "Jimmy Williams (Henry)",
    "tradeSlugs": [
      "draft-pick-trade-tampa-bay-buccaneers-1992"
    ]
  },
  {
    "slug": "joe-campbell-patrick",
    "before": "Joe Campbell (Patrick",
    "after": "Joe Campbell (Patrick)",
    "tradeSlugs": [
      "saints-1980-10-14-las-vegas-raiders-oakland-raiders-draft-pick-possibly-1981-166"
    ]
  },
  {
    "slug": "joe-johnson-pernell",
    "before": "Joe Johnson (Pernell",
    "after": "Joe Johnson (Pernell)",
    "tradeSlugs": [
      "george-hinkle-washington-redskins-commanders-1992"
    ]
  },
  {
    "slug": "joe-jones-willie",
    "before": "Joe Jones (Willie",
    "after": "Joe Jones (Willie)",
    "tradeSlugs": [
      "1979-twelfth-round-pick-315-dewitt-methvin-dee-methvin-washington-redskins-comma",
      "eagles-1974-09-05-cleveland-browns-0168"
    ]
  },
  {
    "slug": "joe-kelly-winston",
    "before": "Joe Kelly (Winston",
    "after": "Joe Kelly (Winston)",
    "tradeSlugs": [
      "rights-to-reggie-rembert-new-york-jets-1990"
    ]
  },
  {
    "slug": "joe-o-donnell-a",
    "before": "Joe O'Donnell (a",
    "after": "Joe O'Donnell (a)",
    "tradeSlugs": [
      "irv-goode-arizona-st-louis-cardinals-1972"
    ]
  },
  {
    "slug": "joe-spencer-emerson",
    "before": "Joe Spencer (Emerson",
    "after": "Joe Spencer (Emerson)",
    "tradeSlugs": [
      "gordon-soltau-gordy-soltau-gordie-soltau-green-bay-packers-1950-9"
    ]
  },
  {
    "slug": "joe-sullivan-b",
    "before": "Joe Sullivan (b",
    "after": "Joe Sullivan (b)",
    "tradeSlugs": [
      "joe-sullivan-b-san-diego-los-angeles-chargers-1976",
      "unspecified-consideration-denver-broncos-1976-lac-1976-0152"
    ]
  },
  {
    "slug": "joe-washington-b",
    "before": "Joe Washington (b",
    "after": "Joe Washington (b)",
    "tradeSlugs": [
      "1981-second-round-pick-52-jarvis-redwine-washington-redskins-commanders-1981",
      "joe-washington-b-los-angeles-san-diego-chargers-1978",
      "joe-washington-b-washington-commanders-1985"
    ]
  },
  {
    "slug": "joe-williams-harold",
    "before": "Joe Williams (Harold",
    "after": "Joe Williams (Harold)",
    "tradeSlugs": [
      "saints-1972-01-31-dallas-cowboys-joe-williams-harold"
    ]
  },
  {
    "slug": "john-adams-albert",
    "before": "John Adams (Albert",
    "after": "John Adams (Albert)",
    "tradeSlugs": [
      "john-adams-albert-chicago-bears-1963"
    ]
  },
  {
    "slug": "john-andrews-milton",
    "before": "John Andrews (Milton",
    "after": "John Andrews (Milton)",
    "tradeSlugs": [
      "marty-domres-los-angeles-san-diego-chargers-1972"
    ]
  },
  {
    "slug": "john-brown-calvin",
    "before": "John Brown (Calvin",
    "after": "John Brown (Calvin)",
    "tradeSlugs": [
      "john-brown-calvin-cleveland-browns-1967"
    ]
  },
  {
    "slug": "john-carroll-b",
    "before": "John Carroll (b",
    "after": "John Carroll (b)",
    "tradeSlugs": [
      "unspecified-consideration-chicago-bears-1975-lac-1975-0128"
    ]
  },
  {
    "slug": "john-clay-a",
    "before": "John Clay (a",
    "after": "John Clay (a)",
    "tradeSlugs": [
      "unspecified-consideration-las-vegasoakland-raiders-1988-lac-1988-0278"
    ]
  },
  {
    "slug": "john-dutton-owen",
    "before": "John Dutton (Owen",
    "after": "John Dutton (Owen)",
    "tradeSlugs": [
      "1980-first-round-pick-24-derrick-hatchett-dallas-cowboys-1979"
    ]
  },
  {
    "slug": "john-ford-b",
    "before": "John Ford (b",
    "after": "John Ford (b)",
    "tradeSlugs": [
      "john-ford-b-detroit-lions-1990"
    ]
  },
  {
    "slug": "john-harper-b",
    "before": "John Harper (b",
    "after": "John Harper (b)",
    "tradeSlugs": [
      "undisclosed-draft-pick-arizona-cardinals-1984"
    ]
  },
  {
    "slug": "john-harris-a",
    "before": "John Harris (a",
    "after": "John Harris (a)",
    "tradeSlugs": [
      "john-harris-seattle-seahawks-1986"
    ]
  },
  {
    "slug": "john-henderson-william",
    "before": "John Henderson (William",
    "after": "John Henderson (William)",
    "tradeSlugs": [
      "eagles-1965-07-09-detroit-lions-0083",
      "john-henderson-detroit-lions-1968"
    ]
  },
  {
    "slug": "john-hoffman-frederick",
    "before": "John Hoffman (Frederick",
    "after": "John Hoffman (Frederick)",
    "tradeSlugs": [
      "cardinals-1972-08-08-chicago-bears-steve-wright-t-john-hoffman-frederick-1973-fourth-round-pick"
    ]
  },
  {
    "slug": "john-lee-b",
    "before": "John Lee (b",
    "after": "John Lee (b)",
    "tradeSlugs": [
      "john-lee-b-new-england-patriots-1982"
    ]
  },
  {
    "slug": "john-martin-a",
    "before": "John Martin (a",
    "after": "John Martin (a)",
    "tradeSlugs": [
      "john-martin-a-los-angeles-st-louis-rams-1950"
    ]
  },
  {
    "slug": "john-sanders-b",
    "before": "John Sanders (b",
    "after": "John Sanders (b)",
    "tradeSlugs": [
      "eagles-1977-09-06-new-england-patriots-0208"
    ]
  },
  {
    "slug": "john-skibinski-a",
    "before": "John Skibinski (a",
    "after": "John Skibinski (a)",
    "tradeSlugs": [
      "undisclosed-consideration-green-bay-packers-1958"
    ]
  },
  {
    "slug": "john-smith-c",
    "before": "John Smith (c",
    "after": "John Smith (c)?",
    "tradeSlugs": [
      "john-smith-c-new-england-boston-patriots-1973"
    ]
  },
  {
    "slug": "john-thomas-f",
    "before": "John Thomas (F",
    "after": "John Thomas (F.)",
    "tradeSlugs": [
      "eagles-1952-04-28-detroit-lions-0020"
    ]
  },
  {
    "slug": "john-williams-m",
    "before": "John Williams (M",
    "after": "John Williams (M.)",
    "tradeSlugs": [
      "1974-first-round-pick-24-roger-carr-los-angeles-st-louis-rams-1972"
    ]
  },
  {
    "slug": "john-williams-johnny-williams-elliott",
    "before": "John Williams / Johnny Williams (Elliott",
    "after": "John Williams / Johnny Williams (Elliott)",
    "tradeSlugs": [
      "ray-collins-san-francisco-49ers-1954"
    ]
  },
  {
    "slug": "john-wright-w",
    "before": "John Wright (W",
    "after": "John Wright (W.)",
    "tradeSlugs": [
      "possibly-1969-seventh-round-pick-164-ted-cottrell-detroit-lions-1969"
    ]
  },
  {
    "slug": "johnny-johnson-a",
    "before": "Johnny Johnson (a",
    "after": "Johnny Johnson (a)",
    "tradeSlugs": [
      "johnny-johnson-a-arizona-st-louis-cardinals-1993"
    ]
  },
  {
    "slug": "johnny-miller-b",
    "before": "Johnny Miller (b",
    "after": "Johnny Miller (b)",
    "tradeSlugs": [
      "johnny-miller-b-tampa-bay-buccaneers-1977"
    ]
  },
  {
    "slug": "keith-browner-a",
    "before": "Keith Browner (a",
    "after": "Keith Browner (a)",
    "tradeSlugs": [
      "draft-considerations-las-vegas-oakland-raiders-1987",
      "keith-browner-a-tampa-bay-buccaneers-1987"
    ]
  },
  {
    "slug": "kevin-hardy-thomas",
    "before": "Kevin Hardy (Thomas",
    "after": "Kevin Hardy (Thomas)",
    "tradeSlugs": [
      "1971-second-round-pick-37-ernie-janet-green-bay-packers-1970",
      "unspecified-consideration-green-bay-packers-1971-lac-1971-0056"
    ]
  },
  {
    "slug": "kevin-hunt-a",
    "before": "Kevin Hunt (a",
    "after": "Kevin Hunt (a)",
    "tradeSlugs": [
      "bill-dulac-new-england-patriots-1973"
    ]
  },
  {
    "slug": "kevin-murphy-dion",
    "before": "Kevin Murphy (Dion",
    "after": "Kevin Murphy (Dion)",
    "tradeSlugs": [
      "unspecified-consideration-tampa-bay-buccaneers-1992"
    ]
  },
  {
    "slug": "larry-jones-allen",
    "before": "Larry Jones (Allen",
    "after": "Larry Jones (Allen)",
    "tradeSlugs": [
      "tom-mitchell-san-francisco-49ers-1978"
    ]
  },
  {
    "slug": "larry-lee-b",
    "before": "Larry Lee (b",
    "after": "Larry Lee (b)",
    "tradeSlugs": [
      "larry-lee-b-miami-dolphins-1987"
    ]
  },
  {
    "slug": "lawrence-johnson-a",
    "before": "Lawrence Johnson (a",
    "after": "Lawrence Johnson (a)",
    "tradeSlugs": [
      "lawrence-johnson-a-cleveland-browns-1984"
    ]
  },
  {
    "slug": "loan-of-bob-jackson-bobby-jackson-dean",
    "before": "loan of Bob Jackson / Bobby Jackson (Dean",
    "after": "loan of Bob Jackson / Bobby Jackson (Dean)",
    "tradeSlugs": [
      "loan-of-bob-jackson-bobby-jackson-dean-los-angeles-san-diego-chargers-1964"
    ]
  },
  {
    "slug": "mark-miller-b",
    "before": "Mark Miller (b",
    "after": "Mark Miller (b)",
    "tradeSlugs": [
      "1982-conditional-fourth-round-pick-green-bay-packers-1980-226"
    ]
  },
  {
    "slug": "mark-reed-b",
    "before": "Mark Reed (b",
    "after": "Mark Reed (b)?",
    "tradeSlugs": [
      "mark-reed-b-los-angeles-st-louis-rams-1983"
    ]
  },
  {
    "slug": "mark-robinson-a",
    "before": "Mark Robinson (a",
    "after": "Mark Robinson (a)",
    "tradeSlugs": [
      "steve-deberg-tampa-bay-buccaneers-1988"
    ]
  },
  {
    "slug": "marshall-harris-b",
    "before": "Marshall Harris (b",
    "after": "Marshall Harris (b)",
    "tradeSlugs": [
      "marshall-harris-b-new-york-jets-1980-220"
    ]
  },
  {
    "slug": "matt-robinson-a",
    "before": "Matt Robinson (a",
    "after": "Matt Robinson (a)",
    "tradeSlugs": [
      "matt-robinson-a-new-york-jets-1980"
    ]
  },
  {
    "slug": "mike-barber-dwayne",
    "before": "Mike Barber (Dwayne",
    "after": "Mike Barber (Dwayne)",
    "tradeSlugs": [
      "mike-barber-dwayne-1982-third-round-pick-67-bill-bechtold-1982-eighth-round-pick",
      "mike-barber-dwayne-los-angeles-st-louis-rams-1985"
    ]
  },
  {
    "slug": "mike-bass-t",
    "before": "Mike Bass (T",
    "after": "Mike Bass (T.)",
    "tradeSlugs": [
      "mike-bass-t-green-bay-packers-1967-07-01"
    ]
  },
  {
    "slug": "mike-campbell-a",
    "before": "Mike Campbell (a",
    "after": "Mike Campbell (a)",
    "tradeSlugs": [
      "mike-campbell-a-arizona-st-louis-cardinals-1968-03-09"
    ]
  },
  {
    "slug": "mike-holmes-raphael",
    "before": "Mike Holmes (Raphael",
    "after": "Mike Holmes (Raphael)",
    "tradeSlugs": [
      "mike-holmes-raphael-san-francisco-49ers-1976"
    ]
  },
  {
    "slug": "mike-hughes-a",
    "before": "Mike Hughes (a",
    "after": "Mike Hughes (a)",
    "tradeSlugs": [
      "mike-hughes-a-new-york-jets-1978"
    ]
  },
  {
    "slug": "mike-hull-bruce",
    "before": "Mike Hull (Bruce",
    "after": "Mike Hull (Bruce)",
    "tradeSlugs": [
      "mike-hull-bruce-chicago-bears-1971"
    ]
  },
  {
    "slug": "mike-mccoy-patrick",
    "before": "Mike McCoy (Patrick",
    "after": "Mike McCoy (Patrick)",
    "tradeSlugs": [
      "mike-mccoy-patrick-green-bay-packers-1977",
      "undisclosed-consideration-las-vegas-oakland-raiders-1979"
    ]
  },
  {
    "slug": "mike-morgan-lee",
    "before": "Mike Morgan (Lee",
    "after": "Mike Morgan (Lee)",
    "tradeSlugs": [
      "1969-ninth-round-pick-218-lynn-buss-philadelphia-eagles-1969",
      "dennis-hale-new-orleans-saints-1969",
      "mike-morgan-lee-philadelphia-eagles-1968"
    ]
  },
  {
    "slug": "mike-reilly-a",
    "before": "Mike Reilly (a",
    "after": "Mike Reilly (a)",
    "tradeSlugs": [
      "mike-reilly-chicago-bears-1969"
    ]
  },
  {
    "slug": "mike-taylor-ray",
    "before": "Mike Taylor (Ray",
    "after": "Mike Taylor (Ray)",
    "tradeSlugs": [
      "eagles-1973-03-10-arizona-st-louis-cardinals-0151",
      "mike-taylor-ray-new-orleans-saints-1971"
    ]
  },
  {
    "slug": "mike-wood-stephen",
    "before": "Mike Wood (Stephen",
    "after": "Mike Wood (Stephen)",
    "tradeSlugs": [
      "mike-wood-stephen-los-angeles-san-diego-chargers-1981"
    ]
  },
  {
    "slug": "myron-taliaferro-mike-taliaferro-eugene",
    "before": "Myron Taliaferro / Mike Taliaferro (Eugene",
    "after": "Myron Taliaferro / Mike Taliaferro (Eugene)",
    "tradeSlugs": [
      "vito-parilli-babe-parilli-new-england-patriots-1968"
    ]
  },
  {
    "slug": "nate-allen-s",
    "before": "Nate Allen (S",
    "after": "Nate Allen (S.)",
    "tradeSlugs": [
      "randy-beisler-san-francisco-49ers-1975",
      "windlan-hall-san-francisco-49ers-1976"
    ]
  },
  {
    "slug": "packers-first-choice-on-any-guards-released-by-redskins-uncertain",
    "before": "Packers first choice on any guards released by Redskins (uncertain",
    "after": "Packers first choice on any guards released by Redskins (uncertain)",
    "tradeSlugs": [
      "paul-lipscomb-green-bay-packers-1950"
    ]
  },
  {
    "slug": "pat-thomas-s",
    "before": "Pat Thomas (S",
    "after": "Pat Thomas (S.)",
    "tradeSlugs": [
      "monte-jackson-conditional-seventh-round-pick-not-exercised-las-vegas-raiders-198"
    ]
  },
  {
    "slug": "paul-krause-a",
    "before": "Paul Krause (a",
    "after": "Paul Krause (a)",
    "tradeSlugs": [
      "paul-krause-a-washington-redskins-commanders-1968"
    ]
  },
  {
    "slug": "paul-lea-a",
    "before": "Paul Lea (a",
    "after": "Paul Lea (a)",
    "tradeSlugs": [
      "paul-lea-a-chicago-bears-1951"
    ]
  },
  {
    "slug": "paul-white-grover",
    "before": "Paul White (Grover",
    "after": "Paul White (Grover)",
    "tradeSlugs": [
      "bob-cifers-bobby-cifers-detroit-lions-1947"
    ]
  },
  {
    "slug": "pete-johnson-b",
    "before": "Pete Johnson (b",
    "after": "Pete Johnson (b)",
    "tradeSlugs": [
      "james-brooks-los-angeles-chargers-1984",
      "pete-johnson-chargers-1984"
    ]
  },
  {
    "slug": "ralph-anderson-e",
    "before": "Ralph Anderson (E",
    "after": "Ralph Anderson (E.)",
    "tradeSlugs": [
      "1974-fourth-round-pick-82-john-stallworth-new-england-boston-patriots-1973"
    ]
  },
  {
    "slug": "ralph-davis-b",
    "before": "Ralph Davis (b",
    "after": "Ralph Davis (b)",
    "tradeSlugs": [
      "undisclosed-draft-pick-undisclosed-overall-player-buffalo-bills-1973"
    ]
  },
  {
    "slug": "ralph-wenzel-richard",
    "before": "Ralph Wenzel (Richard",
    "after": "Ralph Wenzel (Richard)",
    "tradeSlugs": [
      "ralph-wenzel-richard-green-bay-packers-1966-115"
    ]
  },
  {
    "slug": "randy-jackson-joe",
    "before": "Randy Jackson (Joe",
    "after": "Randy Jackson (Joe)",
    "tradeSlugs": [
      "1975-ninth-round-pick-223-dan-natale-philadelphia-eagles-1974",
      "earl-edwards-san-francisco-49ers-1973"
    ]
  },
  {
    "slug": "randy-johnson-k",
    "before": "Randy Johnson (K",
    "after": "Randy Johnson (K.)",
    "tradeSlugs": [
      "1973-fourth-round-pick-94-tom-geredine-new-york-giants-1971"
    ]
  },
  {
    "slug": "ray-brown-madison",
    "before": "Ray Brown (Madison",
    "after": "Ray Brown (Madison)",
    "tradeSlugs": [
      "ernie-jackson-b-1950-04-11-new-orleans-saints-1977",
      "ernie-jackson-b-1950-04-11-new-orleans-saints-1978"
    ]
  },
  {
    "slug": "richard-harvey-dick-harvey-a",
    "before": "Richard Harvey / Dick Harvey (a",
    "after": "Richard Harvey / Dick Harvey (a)",
    "tradeSlugs": [
      "saints-1971-08-23-philadelphia-eagles-richard-harvey-dick-harvey-a"
    ]
  },
  {
    "slug": "richard-smith-b",
    "before": "Richard Smith (b",
    "after": "Richard Smith (b)",
    "tradeSlugs": [
      "richard-smith-b-dallas-cowboys-1967"
    ]
  },
  {
    "slug": "richard-wood-a",
    "before": "Richard Wood (a",
    "after": "Richard Wood (a)",
    "tradeSlugs": [
      "richard-wood-a-new-york-jets-1976"
    ]
  },
  {
    "slug": "ricky-bell-l",
    "before": "Ricky Bell (L",
    "after": "Ricky Bell (L.)",
    "tradeSlugs": [
      "1982-fourth-round-pick-103-dave-barrett-los-angeles-chargers-1982"
    ]
  },
  {
    "slug": "ricky-smith-b",
    "before": "Ricky Smith (b",
    "after": "Ricky Smith (b)",
    "tradeSlugs": [
      "ricky-smith-b-new-england-boston-patriots-1984"
    ]
  },
  {
    "slug": "ricky-thompson-b",
    "before": "Ricky Thompson (b",
    "after": "Ricky Thompson (b)",
    "tradeSlugs": [
      "1979-sixth-round-pick-150-jimmy-moore-lee-washington-redskins-commanders-1978"
    ]
  },
  {
    "slug": "robert-jackson-l",
    "before": "Robert Jackson (L",
    "after": "Robert Jackson (L.)",
    "tradeSlugs": [
      "robert-jackson-l-cleveland-browns-1982"
    ]
  },
  {
    "slug": "robert-smith-lee-bob-smith-lee",
    "before": "Robert Smith (Lee) / Bob Smith (Lee",
    "after": "Robert Smith (Lee) / Bob Smith (Lee)",
    "tradeSlugs": [
      "1953-third-round-pick-37-gene-donaldson-a-detroit-lions-1952-24"
    ]
  },
  {
    "slug": "rod-jones-wayne",
    "before": "Rod Jones (Wayne",
    "after": "Rod Jones (Wayne)",
    "tradeSlugs": [
      "rod-jones-wayne-tampa-bay-buccaneers-1990"
    ]
  },
  {
    "slug": "roger-brown-a",
    "before": "Roger Brown (a",
    "after": "Roger Brown (a)",
    "tradeSlugs": [
      "roger-brown-a-detroit-lions-1967"
    ]
  },
  {
    "slug": "ron-burton-eugene",
    "before": "Ron Burton (Eugene",
    "after": "Ron Burton (Eugene)",
    "tradeSlugs": [
      "ron-burton-eugene-new-england-boston-patriots-1966"
    ]
  },
  {
    "slug": "ron-duncan-a",
    "before": "Ron Duncan (a",
    "after": "Ron Duncan (a)",
    "tradeSlugs": [
      "eagles-1967-09-11-cleveland-browns-0095"
    ]
  },
  {
    "slug": "ron-francis-b",
    "before": "Ron Francis (b",
    "after": "Ron Francis (b)",
    "tradeSlugs": [
      "1991-first-round-pick-new-england-patriots-1991"
    ]
  },
  {
    "slug": "ron-green-morris",
    "before": "Ron Green (Morris",
    "after": "Ron Green (Morris)",
    "tradeSlugs": [
      "ron-green-cleveland-browns-1969"
    ]
  },
  {
    "slug": "ron-johnson-adolphis",
    "before": "Ron Johnson (Adolphis",
    "after": "Ron Johnson (Adolphis)",
    "tradeSlugs": [
      "undisclosed-consideration-cleveland-browns-1970"
    ]
  },
  {
    "slug": "ron-jones-a",
    "before": "Ron Jones (a",
    "after": "Ron Jones (a)",
    "tradeSlugs": [
      "ron-jones-a-green-bay-packers-1970"
    ]
  },
  {
    "slug": "ron-mayo-a",
    "before": "Ron Mayo (a",
    "after": "Ron Mayo (a)",
    "tradeSlugs": [
      "1976-sixth-round-pick-los-angeles-san-diego-chargers-1975",
      "ron-mayo-a-houston-oilers-tennessee-titans-1974"
    ]
  },
  {
    "slug": "ron-smith-c",
    "before": "Ron Smith (C",
    "after": "Ron Smith (C.)",
    "tradeSlugs": [
      "ron-smith-c-green-bay-packers-1966",
      "ron-smith-c-los-angeles-rams-1966"
    ]
  },
  {
    "slug": "ron-smith-ronnie-smith-bernard",
    "before": "Ron Smith / Ronnie Smith (Bernard",
    "after": "Ron Smith / Ronnie Smith (Bernard)",
    "tradeSlugs": [
      "unspecified-consideration-los-angelesst-louis-rams-1980-lac-1980-0190"
    ]
  },
  {
    "slug": "ronnie-lee-v",
    "before": "Ronnie Lee (V",
    "after": "Ronnie Lee (V.)",
    "tradeSlugs": [
      "ronnie-lee-falcons-1984"
    ]
  },
  {
    "slug": "sam-adams-edward",
    "before": "Sam Adams (Edward",
    "after": "Sam Adams (Edward)",
    "tradeSlugs": [
      "saints-1981-04-23-new-england-patriots-sam-adams-edward"
    ]
  },
  {
    "slug": "sam-baker-h",
    "before": "Sam Baker (H",
    "after": "Sam Baker (H.)",
    "tradeSlugs": [
      "1955-second-round-pick-15-ron-waller-ronnie-waller-washington-redskins-1953",
      "sam-baker-cleveland-browns-1961",
      "sam-baker-h-washington-redskins-commanders-1960-63",
      "tommy-mcdonald-philadelphia-eagles-1964"
    ]
  },
  {
    "slug": "sam-williams-charles",
    "before": "Sam Williams (Charles",
    "after": "Sam Williams (Charles)",
    "tradeSlugs": [
      "unspecified-consideration-atlanta-falcons-1976"
    ]
  },
  {
    "slug": "sam-williams-f",
    "before": "Sam Williams (F",
    "after": "Sam Williams (F.)",
    "tradeSlugs": [
      "sam-williams-f-los-angeles-st-louis-rams-1960-03-16"
    ]
  },
  {
    "slug": "sammy-johnson-a",
    "before": "Sammy Johnson (a",
    "after": "Sammy Johnson (a)",
    "tradeSlugs": [
      "sammy-johnson-san-francisco-49ers-1976"
    ]
  },
  {
    "slug": "stan-white-ray",
    "before": "Stan White (Ray",
    "after": "Stan White (Ray)",
    "tradeSlugs": [
      "stan-white-ray-baltimore-indianapolis-colts-1980-04-24"
    ]
  },
  {
    "slug": "steve-davis-timothy",
    "before": "Steve Davis (Timothy",
    "after": "Steve Davis (Timothy)",
    "tradeSlugs": [
      "1970-third-round-pick-60-tom-beasley-new-york-jets-1975"
    ]
  },
  {
    "slug": "steve-howell-glen",
    "before": "Steve Howell (Glen",
    "after": "Steve Howell (Glen)",
    "tradeSlugs": [
      "1982-tenth-round-pick-eagles-1981"
    ]
  },
  {
    "slug": "steve-smith-conant",
    "before": "Steve Smith (Conant",
    "after": "Steve Smith (Conant)",
    "tradeSlugs": [
      "steve-smith-conant-philadelphia-eagles-1975",
      "steve-smith-conant-san-francisco-49ers-1966"
    ]
  },
  {
    "slug": "steve-smith-cot",
    "before": "Steve Smith (Cot",
    "after": "Steve Smith (Cot)",
    "tradeSlugs": [
      "norm-snead-philadelphia-eagles-1971"
    ]
  },
  {
    "slug": "steve-spurrier-sr",
    "before": "Steve Spurrier (Sr",
    "after": "Steve Spurrier (Sr.)",
    "tradeSlugs": [
      "bruce-elia-tampa-bay-buccaneers-1976"
    ]
  },
  {
    "slug": "steve-wright-h",
    "before": "Steve Wright (H",
    "after": "Steve Wright (H.)",
    "tradeSlugs": [
      "steve-wright-h-dallas-cowboys-1983"
    ]
  },
  {
    "slug": "steve-wright-t",
    "before": "Steve Wright (T",
    "after": "Steve Wright (T.)",
    "tradeSlugs": [
      "cardinals-1972-08-08-chicago-bears-steve-wright-t-john-hoffman-frederick-1973-fourth-round-pick",
      "eagles-1973-03-10-arizona-st-louis-cardinals-0151",
      "mike-hull-bruce-chicago-bears-1971",
      "undisclosed-consideration-green-bay-packers-1968"
    ]
  },
  {
    "slug": "ted-fritsch-jr-edward",
    "before": "Ted Fritsch Jr. (Edward",
    "after": "Ted Fritsch Jr. (Edward)",
    "tradeSlugs": [
      "ted-fritsch-jr-edward-atlanta-falcons-1976"
    ]
  },
  {
    "slug": "ted-karras-george-a",
    "before": "Ted Karras (George) (a",
    "after": "Ted Karras (George) (a)",
    "tradeSlugs": [
      "george-izo-washington-redskins-commanders-1965-09-14",
      "ted-karras-george-a-chicago-bears-1965"
    ]
  },
  {
    "slug": "thomas-benson-tom-benson-c",
    "before": "Thomas Benson / Tom Benson (C",
    "after": "Thomas Benson / Tom Benson (C.)",
    "tradeSlugs": [
      "unspecified-consideration-atlanta-falcons-1986-lac-1986-0255",
      "unspecified-consideration-new-england-patriots-1988"
    ]
  },
  {
    "slug": "thomas-brown-b",
    "before": "Thomas Brown (b",
    "after": "Thomas Brown (b)",
    "tradeSlugs": [
      "thomas-brown-b-philadelphia-eagles-1981-231"
    ]
  },
  {
    "slug": "thomas-howard-a",
    "before": "Thomas Howard (a",
    "after": "Thomas Howard (a)",
    "tradeSlugs": [
      "cardinals-1984-09-01-kansas-city-chiefs-thomas-howard-a-undisclosed-draft-pick-possibly-1985-18"
    ]
  },
  {
    "slug": "tim-harris-david",
    "before": "Tim Harris (David",
    "after": "Tim Harris (David)",
    "tradeSlugs": [
      "tim-harris-david-green-bay-packers-1991"
    ]
  },
  {
    "slug": "tom-beer-john",
    "before": "Tom Beer (John",
    "after": "Tom Beer (John)",
    "tradeSlugs": [
      "jim-whalen-new-england-patriots-1970"
    ]
  },
  {
    "slug": "tom-brown-william",
    "before": "Tom Brown (William",
    "after": "Tom Brown (William)",
    "tradeSlugs": [
      "tom-brown-william-green-bay-packers-1969"
    ]
  },
  {
    "slug": "tom-erlandson-a",
    "before": "Tom Erlandson (a",
    "after": "Tom Erlandson (a)",
    "tradeSlugs": [
      "unspecified-consideration-miami-dolphins-1968-lac-1968-0028"
    ]
  },
  {
    "slug": "tom-graham-lawrence",
    "before": "Tom Graham (Lawrence",
    "after": "Tom Graham (Lawrence)",
    "tradeSlugs": [
      "1975-fourth-round-pick-84-steve-taylor-a-kansas-city-chiefs-1974",
      "jim-marsalis-later-replaced-by-1975-fourth-round-pick-84-steve-taylor-a-1975-tenth-round-p",
      "tom-ehlers-philadelphia-eagles-1978",
      "unspecified-consideration-philadelphia-eagles-1978-lac-1978-0168"
    ]
  },
  {
    "slug": "tom-greene-w",
    "before": "Tom Greene (W",
    "after": "Tom Greene (W.)",
    "tradeSlugs": [
      "unspecified-consideration-new-england-patriots-1960",
      "unspecified-consideration-new-england-patriots-1961"
    ]
  },
  {
    "slug": "tom-hall-francis",
    "before": "Tom Hall (Francis",
    "after": "Tom Hall (Francis)",
    "tradeSlugs": [
      "tom-hall-detroit-lions-1964",
      "tom-hall-detroit-lions-1964-2",
      "tom-hall-new-orleans-saints-1968"
    ]
  },
  {
    "slug": "tom-harmon-a",
    "before": "Tom Harmon (a",
    "after": "Tom Harmon (a)",
    "tradeSlugs": [
      "tom-harmon-a-chicago-bears-1946"
    ]
  },
  {
    "slug": "tom-mccormick-a",
    "before": "Tom McCormick (a",
    "after": "Tom McCormick (a)",
    "tradeSlugs": [
      "1957-fourth-round-pick-47-lamar-lundy-new-york-giants-1956"
    ]
  },
  {
    "slug": "tom-moore-a",
    "before": "Tom Moore (a",
    "after": "Tom Moore (a)",
    "tradeSlugs": [
      "ron-smith-c-los-angeles-rams-1966",
      "tom-moore-a-los-angeles-rams-1967"
    ]
  },
  {
    "slug": "tom-myers-b-tommy-myers-b",
    "before": "Tom Myers (b) / Tommy Myers (b",
    "after": "Tom Myers (b) / Tommy Myers (b)",
    "tradeSlugs": [
      "tom-myers-b-tommy-myers-b-new-orleans-saints-1983"
    ]
  },
  {
    "slug": "tom-nash-a",
    "before": "Tom Nash (a",
    "after": "Tom Nash (a)",
    "tradeSlugs": [
      "ernie-pinckert-boston-washington-braves-1933"
    ]
  },
  {
    "slug": "tom-o-malley-a",
    "before": "Tom O'Malley (a",
    "after": "Tom O'Malley (a)",
    "tradeSlugs": [
      "1951-eighth-round-pick-88-art-spinney-green-bay-packers-1950-12"
    ]
  },
  {
    "slug": "tom-scott-coster",
    "before": "Tom Scott (Coster",
    "after": "Tom Scott (Coster)",
    "tradeSlugs": [
      "eagles-1953-09-21-los-angeles-st-louis-rams-0029"
    ]
  },
  {
    "slug": "tony-baker-a",
    "before": "Tony Baker (a",
    "after": "Tony Baker (a)",
    "tradeSlugs": [
      "harold-jackson-tony-baker-a-1974-first-round-pick-11-john-cappelletti-1975-first",
      "jim-butler-jimmy-butler-jack-butler-cannonball-butler-eagles-voided-by-falcons-a",
      "saints-1971-10-27-philadelphia-eagles-1972-fourth-round-pick-99-joe-federspiel",
      "tony-baker-a-philadelphia-eagles-1972",
      "unspecified-consideration-los-angelesst-louis-rams-1975-lac-1975-0134"
    ]
  },
  {
    "slug": "tony-davis-b",
    "before": "Tony Davis (b",
    "after": "Tony Davis (b)",
    "tradeSlugs": [
      "1980-sixth-round-pick-159-andrew-melontree-tampa-bay-buccaneers-1979"
    ]
  },
  {
    "slug": "tony-franklin-a",
    "before": "Tony Franklin (a",
    "after": "Tony Franklin (a)",
    "tradeSlugs": [
      "tony-franklin-a-philadelphia-eagles-1984"
    ]
  },
  {
    "slug": "tony-mcgee-eugene",
    "before": "Tony McGee (Eugene",
    "after": "Tony McGee (Eugene)",
    "tradeSlugs": [
      "tony-mcgee-eugene-chicago-bears-1974",
      "tony-mcgee-eugene-new-england-boston-patriots-1982"
    ]
  },
  {
    "slug": "tony-peters-a",
    "before": "Tony Peters (a",
    "after": "Tony Peters (a)",
    "tradeSlugs": [
      "1980-fifth-round-pick-136-laval-short-1981-fourth-round-pick-92-mike-robinson-b"
    ]
  },
  {
    "slug": "tracy-porter-randolph",
    "before": "Tracy Porter (Randolph",
    "after": "Tracy Porter (Randolph)",
    "tradeSlugs": [
      "tracy-porter-randolph-detroit-lions-1983"
    ]
  },
  {
    "slug": "walter-barnes-walt-barnes-c",
    "before": "Walter Barnes / Walt Barnes (C",
    "after": "Walter Barnes / Walt Barnes (C.)",
    "tradeSlugs": [
      "draft-pick-kansas-city-chiefs-1969",
      "walter-barnes-walt-barnes-c-kansas-city-chiefs-1969"
    ]
  },
  {
    "slug": "walter-johnson-clarke",
    "before": "Walter Johnson (Clarke",
    "after": "Walter Johnson (Clarke)",
    "tradeSlugs": [
      "cardinals-1968-08-28-san-francisco-49ers-wayne-trimble-cash",
      "cardinals-1968-09-04-san-francisco-49ers-walter-johnson-clarke-cash"
    ]
  },
  {
    "slug": "wayne-davis-e",
    "before": "Wayne Davis (E",
    "after": "Wayne Davis (E.)",
    "tradeSlugs": [
      "unspecified-consideration-buffalo-bills-1987-lac-1987-0264"
    ]
  },
  {
    "slug": "wayne-wilson-macarthur",
    "before": "Wayne Wilson (MacArthur",
    "after": "Wayne Wilson (MacArthur)",
    "tradeSlugs": [
      "wayne-wilson-new-orleans-saints-1986"
    ]
  },
  {
    "slug": "wes-miller-a",
    "before": "Wes Miller (a",
    "after": "Wes Miller (a)",
    "tradeSlugs": [
      "wes-miller-a-arizona-st-louis-cardinals-1975"
    ]
  },
  {
    "slug": "will-sherman-a",
    "before": "Will Sherman (a",
    "after": "Will Sherman (a)",
    "tradeSlugs": [
      "will-sherman-a-los-angeles-st-louis-rams-1961"
    ]
  },
  {
    "slug": "william-west-bill-west-b",
    "before": "William West / Bill West (b",
    "after": "William West / Bill West (b)",
    "tradeSlugs": [
      "lloyd-edwards-indianapolis-baltimore-colts-1972",
      "lloyd-edwards-new-york-jets-1972"
    ]
  },
  {
    "slug": "willie-davis-delford",
    "before": "Willie Davis (Delford",
    "after": "Willie Davis (Delford)",
    "tradeSlugs": [
      "a-d-williams-green-bay-packers-1960-66"
    ]
  },
  {
    "slug": "willie-parker-b",
    "before": "Willie Parker (b",
    "after": "Willie Parker (b)?",
    "tradeSlugs": [
      "willie-parker-b-los-angeles-rams-1973"
    ]
  }
];

const players = JSON.parse(
  fs
    .readFileSync(
      path.join(repo, "src/data/nfl/players.json"),
      "utf8"
    )
    .replace(/^\uFEFF/, "")
);
const trades = JSON.parse(
  fs
    .readFileSync(
      path.join(repo, "src/data/nfl/trades.json"),
      "utf8"
    )
    .replace(/^\uFEFF/, "")
);

const publicTrades = getPublicTrades(trades);
const publicPlayers = getPublicPlayerRecords(
  players,
  publicTrades
);
const publicPlayerSlugSet = new Set(
  publicPlayers.map((player) => player.slug)
);

const normalize = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[Ã¢â‚¬â„¢']/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();

const errors = [];

if (repairs.length !== 291) {
  errors.push(
    `Expected 291 repairs; validator received ${repairs.length}.`
  );
}

for (const repair of repairs) {
  const matches = players.filter(
    (player) =>
      player.slug === repair.slug &&
      player.name === repair.after
  );

  if (matches.length !== 1) {
    errors.push(
      `${repair.slug}: expected one repaired record, found ${matches.length}.`
    );
    continue;
  }

  if (
    players.some(
      (player) =>
        player.slug === repair.slug &&
        player.name === repair.before
    )
  ) {
    errors.push(
      `${repair.slug}: original malformed display name remains.`
    );
  }

  const collisionCount = players.filter(
    (player) =>
      normalize(player.name) === normalize(repair.after)
  ).length;

  if (collisionCount !== 1) {
    errors.push(
      `${repair.slug}: repaired normalized name count is ${collisionCount}.`
    );
  }

  if (!publicPlayerSlugSet.has(repair.slug)) {
    errors.push(
      `${repair.slug}: repaired route is no longer public.`
    );
  }

  const related = getRelatedPublicTrades(
    matches[0],
    publicTrades
  );

  if (related.length === 0) {
    errors.push(
      `${repair.slug}: repaired player lost all exact public relationships.`
    );
  }
}

const publicUnbalancedPlayers = publicPlayers.filter(
  (player) => {
    const name = String(player?.name || "");

    return (
      (name.match(/\(/g) || []).length !==
      (name.match(/\)/g) || []).length
    );
  }
);

const remainingUnbalancedSlugs = publicUnbalancedPlayers
  .map((player) => player.slug)
  .sort();

const expectedRemaining = [];

if (
  JSON.stringify(remainingUnbalancedSlugs) !==
  JSON.stringify(expectedRemaining)
) {
  errors.push(
    `Remaining unbalanced routes mismatch: ${remainingUnbalancedSlugs.join(", ")}`
  );
}

const summary = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASSED" : "FAILED",
  counts: {
    repairsApplied: repairs.length,
    publicTrades: publicTrades.length,
    exactPublicPlayerRoutes: publicPlayers.length,
    remainingPublicUnbalancedNames:
      publicUnbalancedPlayers.length,
  },
  remainingPublicUnbalancedRoutes:
    remainingUnbalancedSlugs,
  errors,
};

fs.writeFileSync(
  outputPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);

if (errors.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));