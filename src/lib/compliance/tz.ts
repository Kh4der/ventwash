import { areaCode } from "@/lib/phone";

/**
 * Recipient timezone resolution — pure code, no dependency, FAIL CLOSED.
 *
 * Order: ZIP3 exception table (minority zones of multi-timezone states) →
 * state dominant timezone → area-code table fallback → null.
 * A null timezone means the quiet-hours gate BLOCKS the contact attempt
 * (reason 'tz_unknown'); it never means "assume business timezone".
 */

// Dominant IANA timezone per state/territory.
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver",
  NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York",
  NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
  PR: "America/Puerto_Rico",
};

// ZIP3 prefixes that live in a DIFFERENT zone than their state's dominant one.
// Coarse by design: anything ambiguous should resolve to null upstream
// (missing postal) rather than guess.
const ZIP3_EXCEPTIONS: Record<string, string> = {
  // Florida panhandle (Central)
  "324": "America/Chicago", "325": "America/Chicago",
  // Texas: El Paso (Mountain)
  "798": "America/Denver", "799": "America/Denver", "885": "America/Denver",
  // Tennessee: eastern (Knoxville/Chattanooga are Eastern)
  "377": "America/New_York", "378": "America/New_York", "379": "America/New_York",
  "374": "America/New_York", "373": "America/New_York",
  // Kentucky: western (Central)
  "420": "America/Chicago", "421": "America/Chicago", "423": "America/Chicago",
  "427": "America/Chicago",
  // Indiana: northwest + southwest (Central)
  "463": "America/Chicago", "464": "America/Chicago",
  "475": "America/Chicago", "476": "America/Chicago", "477": "America/Chicago",
  // Michigan: western UP (Central)
  "499": "America/Menominee",
  // North Dakota / South Dakota western (Mountain)
  "586": "America/Denver", "577": "America/Denver",
  // Nebraska western (Mountain)
  "691": "America/Denver", "693": "America/Denver",
  // Kansas far-west (Mountain)
  "677": "America/Denver", "678": "America/Denver",
  // Idaho north (Pacific)
  "838": "America/Los_Angeles",
  // Oregon: Malheur county (Mountain)
  "979": "America/Boise",
};

// Area code → IANA timezone, for leads with a phone but no address.
// Only unambiguous single-zone codes are listed; others resolve null.
const AREA_CODE_TZ: Record<string, string> = {
  // Eastern
  "212": "America/New_York", "718": "America/New_York", "917": "America/New_York",
  "646": "America/New_York", "347": "America/New_York", "516": "America/New_York",
  "631": "America/New_York", "914": "America/New_York", "518": "America/New_York",
  "585": "America/New_York", "716": "America/New_York", "315": "America/New_York",
  "607": "America/New_York", "845": "America/New_York", "201": "America/New_York",
  "551": "America/New_York", "609": "America/New_York", "732": "America/New_York",
  "848": "America/New_York", "856": "America/New_York", "862": "America/New_York",
  "908": "America/New_York", "973": "America/New_York", "215": "America/New_York",
  "267": "America/New_York", "445": "America/New_York", "412": "America/New_York",
  "484": "America/New_York", "610": "America/New_York", "717": "America/New_York",
  "570": "America/New_York", "814": "America/New_York", "878": "America/New_York",
  "617": "America/New_York", "857": "America/New_York", "781": "America/New_York",
  "339": "America/New_York", "508": "America/New_York", "774": "America/New_York",
  "978": "America/New_York", "351": "America/New_York", "413": "America/New_York",
  "203": "America/New_York", "475": "America/New_York", "860": "America/New_York",
  "959": "America/New_York", "401": "America/New_York", "802": "America/New_York",
  "603": "America/New_York", "207": "America/New_York", "202": "America/New_York",
  "301": "America/New_York", "240": "America/New_York", "410": "America/New_York",
  "443": "America/New_York", "667": "America/New_York", "302": "America/New_York",
  "703": "America/New_York", "571": "America/New_York", "804": "America/New_York",
  "757": "America/New_York", "540": "America/New_York", "434": "America/New_York",
  "276": "America/New_York", "304": "America/New_York", "681": "America/New_York",
  "704": "America/New_York", "980": "America/New_York", "919": "America/New_York",
  "984": "America/New_York", "910": "America/New_York", "252": "America/New_York",
  "336": "America/New_York", "743": "America/New_York", "828": "America/New_York",
  "803": "America/New_York", "839": "America/New_York", "843": "America/New_York",
  "854": "America/New_York", "864": "America/New_York", "404": "America/New_York",
  "470": "America/New_York", "678": "America/New_York", "770": "America/New_York",
  "706": "America/New_York", "762": "America/New_York", "912": "America/New_York",
  "229": "America/New_York", "305": "America/New_York", "786": "America/New_York",
  "954": "America/New_York", "754": "America/New_York", "561": "America/New_York",
  "772": "America/New_York", "407": "America/New_York", "689": "America/New_York",
  "321": "America/New_York", "813": "America/New_York", "656": "America/New_York",
  "727": "America/New_York", "941": "America/New_York", "239": "America/New_York",
  "352": "America/New_York", "386": "America/New_York", "904": "America/New_York",
  "216": "America/New_York", "440": "America/New_York", "330": "America/New_York",
  "234": "America/New_York", "614": "America/New_York", "380": "America/New_York",
  "513": "America/New_York", "283": "America/New_York", "937": "America/New_York",
  "419": "America/New_York", "567": "America/New_York", "740": "America/New_York",
  "220": "America/New_York", "313": "America/Detroit", "248": "America/Detroit",
  "734": "America/Detroit", "586": "America/Detroit", "810": "America/Detroit",
  "947": "America/Detroit", "517": "America/Detroit", "616": "America/Detroit",
  "269": "America/Detroit", "989": "America/Detroit", "231": "America/Detroit",
  "502": "America/New_York", "859": "America/New_York", "606": "America/New_York",
  "317": "America/Indiana/Indianapolis", "463": "America/Indiana/Indianapolis",
  "765": "America/Indiana/Indianapolis", "812": "America/Indiana/Indianapolis",
  // Central
  "312": "America/Chicago", "773": "America/Chicago", "872": "America/Chicago",
  "708": "America/Chicago", "630": "America/Chicago", "331": "America/Chicago",
  "847": "America/Chicago", "224": "America/Chicago", "815": "America/Chicago",
  "779": "America/Chicago", "217": "America/Chicago", "309": "America/Chicago",
  "618": "America/Chicago", "414": "America/Chicago", "262": "America/Chicago",
  "608": "America/Chicago", "715": "America/Chicago", "920": "America/Chicago",
  "612": "America/Chicago", "651": "America/Chicago", "763": "America/Chicago",
  "952": "America/Chicago", "218": "America/Chicago", "320": "America/Chicago",
  "507": "America/Chicago", "515": "America/Chicago", "319": "America/Chicago",
  "563": "America/Chicago", "641": "America/Chicago", "712": "America/Chicago",
  "314": "America/Chicago", "557": "America/Chicago", "816": "America/Chicago",
  "660": "America/Chicago", "573": "America/Chicago", "417": "America/Chicago",
  "501": "America/Chicago", "479": "America/Chicago", "870": "America/Chicago",
  "504": "America/Chicago", "985": "America/Chicago", "225": "America/Chicago",
  "318": "America/Chicago", "337": "America/Chicago", "601": "America/Chicago",
  "769": "America/Chicago", "228": "America/Chicago", "662": "America/Chicago",
  "205": "America/Chicago", "659": "America/Chicago", "251": "America/Chicago",
  "334": "America/Chicago", "256": "America/Chicago", "938": "America/Chicago",
  "615": "America/Chicago", "629": "America/Chicago", "901": "America/Chicago",
  "731": "America/Chicago", "931": "America/Chicago", "405": "America/Chicago",
  "572": "America/Chicago", "918": "America/Chicago", "539": "America/Chicago",
  "580": "America/Chicago", "316": "America/Chicago", "620": "America/Chicago",
  "785": "America/Chicago", "913": "America/Chicago", "402": "America/Chicago",
  "531": "America/Chicago", "605": "America/Chicago", "701": "America/Chicago",
  "214": "America/Chicago", "469": "America/Chicago", "972": "America/Chicago",
  "945": "America/Chicago", "817": "America/Chicago", "682": "America/Chicago",
  "713": "America/Chicago", "281": "America/Chicago", "832": "America/Chicago",
  "346": "America/Chicago", "210": "America/Chicago", "726": "America/Chicago",
  "512": "America/Chicago", "737": "America/Chicago", "254": "America/Chicago",
  "325": "America/Chicago", "361": "America/Chicago", "409": "America/Chicago",
  "430": "America/Chicago", "903": "America/Chicago", "806": "America/Chicago",
  "830": "America/Chicago", "936": "America/Chicago", "940": "America/Chicago",
  "956": "America/Chicago", "979": "America/Chicago",
  // Mountain
  "303": "America/Denver", "720": "America/Denver", "970": "America/Denver",
  "719": "America/Denver", "505": "America/Denver", "575": "America/Denver",
  "801": "America/Denver", "385": "America/Denver", "435": "America/Denver",
  "406": "America/Denver", "307": "America/Denver", "915": "America/Denver",
  "602": "America/Phoenix", "480": "America/Phoenix", "623": "America/Phoenix",
  "520": "America/Phoenix", "928": "America/Phoenix",
  // Pacific
  "213": "America/Los_Angeles", "323": "America/Los_Angeles", "310": "America/Los_Angeles",
  "424": "America/Los_Angeles", "818": "America/Los_Angeles", "747": "America/Los_Angeles",
  "626": "America/Los_Angeles", "562": "America/Los_Angeles", "714": "America/Los_Angeles",
  "657": "America/Los_Angeles", "949": "America/Los_Angeles", "951": "America/Los_Angeles",
  "909": "America/Los_Angeles", "840": "America/Los_Angeles", "760": "America/Los_Angeles",
  "442": "America/Los_Angeles", "619": "America/Los_Angeles", "858": "America/Los_Angeles",
  "805": "America/Los_Angeles", "820": "America/Los_Angeles", "661": "America/Los_Angeles",
  "415": "America/Los_Angeles", "628": "America/Los_Angeles", "510": "America/Los_Angeles",
  "341": "America/Los_Angeles", "650": "America/Los_Angeles", "408": "America/Los_Angeles",
  "669": "America/Los_Angeles", "925": "America/Los_Angeles", "916": "America/Los_Angeles",
  "279": "America/Los_Angeles", "209": "America/Los_Angeles", "559": "America/Los_Angeles",
  "707": "America/Los_Angeles", "530": "America/Los_Angeles", "831": "America/Los_Angeles",
  "702": "America/Los_Angeles", "725": "America/Los_Angeles", "775": "America/Los_Angeles",
  "206": "America/Los_Angeles", "253": "America/Los_Angeles", "425": "America/Los_Angeles",
  "564": "America/Los_Angeles", "360": "America/Los_Angeles", "509": "America/Los_Angeles",
  "503": "America/Los_Angeles", "971": "America/Los_Angeles", "541": "America/Los_Angeles",
  "458": "America/Los_Angeles",
  // Alaska / Hawaii
  "907": "America/Anchorage", "808": "Pacific/Honolulu",
};

/** Validate that a string is a usable IANA timezone. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a lead's timezone from postal/region/phone. Returns null when
 * nothing resolves — callers must treat null as "do not contact now".
 */
export function resolveTimezone(lead: {
  postal?: string | null;
  region?: string | null;
  phone_e164?: string | null;
}): string | null {
  const zip3 = (lead.postal ?? "").trim().slice(0, 3);
  if (zip3.length === 3 && ZIP3_EXCEPTIONS[zip3]) return ZIP3_EXCEPTIONS[zip3];

  const region = (lead.region ?? "").trim().toUpperCase();
  if (region && STATE_TZ[region]) return STATE_TZ[region];

  const ac = areaCode(lead.phone_e164);
  if (ac && AREA_CODE_TZ[ac]) return AREA_CODE_TZ[ac];

  return null;
}

/** Local hour (0-23) and minute in a target timezone. */
export function localTime(tz: string, at: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  return { hour: hour === 24 ? 0 : hour, minute };
}
