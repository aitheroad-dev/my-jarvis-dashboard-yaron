// Fixed taxonomy for the planner: tags, regions, a city gazetteer used by the
// chat matcher, and the example prompts shown on the home page.

export interface TagDef {
  /** Canonical Hebrew label stored on each point. */
  label: string;
  emoji: string;
  /** Pill colour (Israel-trail palette). */
  color: string;
  /** Extra free-text triggers the chat matcher looks for. */
  synonyms: string[];
}

// Trail palette
export const PALETTE = {
  cream: "#F2ECD8",
  trail: "#4A7C4E",
  mustard: "#C8963E",
  sea: "#2E6B8A",
  earth: "#8B5E3C",
  ink: "#3B352B",
} as const;

export const TAGS: TagDef[] = [
  { label: "מעיין", emoji: "🏝️", color: PALETTE.sea, synonyms: ["מעיין", "מעיינות", "עין ", "נביעה"] },
  { label: "מקור מים", emoji: "🔱", color: PALETTE.sea, synonyms: ["מקור מים", "מים זורמים"] },
  { label: "מים כל השנה", emoji: "💧", color: PALETTE.sea, synonyms: ["מים כל השנה", "מים כל הקיץ", "זורם תמיד"] },
  { label: "בריכת טבע", emoji: "🏊", color: PALETTE.sea, synonyms: ["בריכה", "בריכת טבע", "גב מים", "טבילה", "רחצה"] },
  { label: "מסלול", emoji: "👣", color: PALETTE.trail, synonyms: ["מסלול", "הליכה", "טרק", "שביל", "טרק רגלי"] },
  { label: "תצפית", emoji: "🌄", color: PALETTE.mustard, synonyms: ["תצפית", "נוף", "פנורמה", "נקודת תצפית"] },
  { label: "שקיעה", emoji: "🌠", color: PALETTE.mustard, synonyms: ["שקיעה", "שקיעת", "ערב", "sunset"] },
  { label: "זריחה", emoji: "🌅", color: PALETTE.mustard, synonyms: ["זריחה", "זריחת", "בוקר מוקדם", "sunrise"] },
  { label: "טיול משפחות", emoji: "👨‍👩‍👧‍👦", color: PALETTE.trail, synonyms: ["משפח", "ילדים", "עם הילדים", "קל"] },
  { label: "טיול 4x4", emoji: "🚜", color: PALETTE.earth, synonyms: ["4x4", "4×4", "ג'יפ", "גיפ", "שטח", "jeep", "טרקטורון"] },
  { label: "חניון לילה", emoji: "🏕️", color: PALETTE.earth, synonyms: ["חניון לילה", "לינה", "לישון", "קמפינג", "אוהל", "לילה"] },
  { label: "מקום מיוחד", emoji: "🌟", color: PALETTE.mustard, synonyms: ["מיוחד", "נסתר", "פנינה", "סודי"] },
];

export const TAG_LABELS = TAGS.map((t) => t.label);

export function tagDef(label: string): TagDef | undefined {
  return TAGS.find((t) => t.label === label);
}

// Regions ordered roughly north → south. Drives both the filter chips and the
// region <select> in the editor.
export const REGIONS: string[] = [
  "רמת הגולן",
  "הגליל",
  "חיפה והכרמל",
  "עמק יזרעאל",
  "גוש דן",
  "השפלה",
  "ירושלים והסביבה",
  "יהודה ושומרון",
  "ים המלח",
  "הנגב",
  "אילת והערבה",
];

export interface City {
  name: string;
  lat: number;
  lng: number;
  aliases?: string[];
}

// Gazetteer for "near X" / "build me a trip around X" style requests.
export const CITIES: City[] = [
  { name: "חיפה", lat: 32.794, lng: 34.9896 },
  { name: "תל אביב", lat: 32.0853, lng: 34.7818, aliases: ["תל-אביב", "גוש דן"] },
  { name: "ירושלים", lat: 31.7683, lng: 35.2137 },
  { name: "באר שבע", lat: 31.2518, lng: 34.7913 },
  { name: "אילת", lat: 29.5577, lng: 34.9519 },
  { name: "טבריה", lat: 32.7959, lng: 35.531, aliases: ["כנרת", "ים כנרת"] },
  { name: "צפת", lat: 32.9646, lng: 35.4951 },
  { name: "נצרת", lat: 32.7026, lng: 35.2978 },
  { name: "מצפה רמון", lat: 30.6097, lng: 34.8014, aliases: ["מצפה-רמון", "מכתש רמון"] },
  { name: "עפולה", lat: 32.6078, lng: 35.2897 },
  { name: "כרמיאל", lat: 32.9171, lng: 35.2956 },
  { name: "קצרין", lat: 32.9907, lng: 35.6896, aliases: ["גולן"] },
  { name: "עין גדי", lat: 31.4615, lng: 35.3896, aliases: ["ים המלח"] },
  { name: "מודיעין", lat: 31.8928, lng: 35.0145 },
  { name: "נתניה", lat: 32.321, lng: 34.853 },
  { name: "אשקלון", lat: 31.6688, lng: 34.5742 },
  { name: "ערד", lat: 31.2589, lng: 35.2122 },
  { name: "דימונה", lat: 31.0707, lng: 35.0327 },
  { name: "אריאל", lat: 32.1056, lng: 35.1885, aliases: ["שומרון"] },
  { name: "מטולה", lat: 33.279, lng: 35.578 },
];

export const EXAMPLE_PROMPTS: string[] = [
  "אני מחפש מעיין קרוב לחיפה",
  'תבנה לי טיול לסופ"ש במצפה רמון',
  "נקודת תצפית לשקיעה בגליל",
  "טיול משפחות עם מים בכרמל",
  "חניון לילה בנגב",
  "מסלול 4x4 ברמת הגולן",
];
