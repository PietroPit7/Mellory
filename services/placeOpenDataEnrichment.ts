export type OpenDataSource =
  | "none"
  | "openstreetmap"
  | "mixed";

export type BasePlaceForOpenData = {
  id: string;
  name: string;
  category?: string;
  categoryBase?: string;
  detail?: string;
  website?: string;
  phone?: string;
  openingHours?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type OpenDataEnrichment = {
  source: OpenDataSource;
  lastEnrichedAt: string;

  osmId: string;
  osmType: string;
  osmTags: Record<string, string>;

  name: string;
  category: string;
  cuisine: string;
  address: string;
  website: string;
  phone: string;
  openingHours: string;

  instagramUrl: string;
  facebookUrl: string;

  outdoorSeating: string;
  wheelchair: string;
  takeaway: string;
  delivery: string;
  vegetarian: string;
  vegan: string;

  wikidataId: string;
  wikipediaTitle: string;
  wikipediaUrl: string;
  description: string;

  imageUrl: string;
  imageAttribution: string;

  guideAwards: string[];
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat?: number;
    lon?: number;
  };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METERS = 140;

const emptyOpenDataEnrichment: OpenDataEnrichment = {
  source: "none",
  lastEnrichedAt: "",

  osmId: "",
  osmType: "",
  osmTags: {},

  name: "",
  category: "",
  cuisine: "",
  address: "",
  website: "",
  phone: "",
  openingHours: "",

  instagramUrl: "",
  facebookUrl: "",

  outdoorSeating: "",
  wheelchair: "",
  takeaway: "",
  delivery: "",
  vegetarian: "",
  vegan: "",

  wikidataId: "",
  wikipediaTitle: "",
  wikipediaUrl: "",
  description: "",

  imageUrl: "",
  imageAttribution: "",

  guideAwards: [],
};

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCoordinates(place: BasePlaceForOpenData) {
  return (
    typeof place.latitude === "number" &&
    Number.isFinite(place.latitude) &&
    typeof place.longitude === "number" &&
    Number.isFinite(place.longitude)
  );
}

function getElementLatitude(element: OverpassElement) {
  return element.lat ?? element.center?.lat ?? null;
}

function getElementLongitude(element: OverpassElement) {
  return element.lon ?? element.center?.lon ?? null;
}

function getDistanceMeters({
  firstLatitude,
  firstLongitude,
  secondLatitude,
  secondLongitude,
}: {
  firstLatitude: number;
  firstLongitude: number;
  secondLatitude: number;
  secondLongitude: number;
}) {
  const earthRadiusMeters = 6371000;
  const firstLatRadians = (firstLatitude * Math.PI) / 180;
  const secondLatRadians = (secondLatitude * Math.PI) / 180;
  const deltaLatRadians = ((secondLatitude - firstLatitude) * Math.PI) / 180;
  const deltaLonRadians = ((secondLongitude - firstLongitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLatRadians / 2) * Math.sin(deltaLatRadians / 2) +
    Math.cos(firstLatRadians) *
      Math.cos(secondLatRadians) *
      Math.sin(deltaLonRadians / 2) *
      Math.sin(deltaLonRadians / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function getNameSimilarity(firstName: string, secondName: string) {
  const first = normalizeText(firstName);
  const second = normalizeText(secondName);

  if (!first || !second) return 0;
  if (first === second) return 100;
  if (first.includes(second) || second.includes(first)) return 82;

  const firstWords = new Set(first.split(" ").filter(Boolean));
  const secondWords = new Set(second.split(" ").filter(Boolean));

  if (firstWords.size === 0 || secondWords.size === 0) return 0;

  let sharedWords = 0;

  firstWords.forEach((word) => {
    if (secondWords.has(word)) {
      sharedWords += 1;
    }
  });

  return Math.round(
    (sharedWords / Math.max(firstWords.size, secondWords.size)) * 70
  );
}

function getOsmCategory(tags: Record<string, string>) {
  const amenity = cleanText(tags.amenity);
  const shop = cleanText(tags.shop);
  const tourism = cleanText(tags.tourism);
  const leisure = cleanText(tags.leisure);
  const cuisine = cleanText(tags.cuisine);

  if (amenity === "restaurant") {
    return cuisine ? `Ristorante · ${cuisine}` : "Ristorante";
  }

  if (amenity === "cafe") return "Caffè";
  if (amenity === "bar") return "Bar";
  if (amenity === "pub") return "Pub";
  if (amenity === "fast_food") return "Fast food";
  if (amenity === "ice_cream") return "Gelateria";
  if (shop === "bakery") return "Forno / Pasticceria";
  if (shop === "pastry") return "Pasticceria";
  if (tourism === "hotel") return "Hotel";
  if (tourism === "museum") return "Museo";
  if (tourism === "attraction") return "Attrazione";
  if (leisure) return leisure;

  return "";
}

function getBestTag(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(tags[key]);
    if (value.length > 0) return value;
  }

  return "";
}

function getAddressFromOsmTags(tags: Record<string, string>) {
  const street = cleanText(tags["addr:street"]);
  const houseNumber = cleanText(tags["addr:housenumber"]);
  const postcode = cleanText(tags["addr:postcode"]);
  const city = cleanText(tags["addr:city"]);

  const streetLine = [street, houseNumber].filter(Boolean).join(" ");
  const cityLine = [postcode, city].filter(Boolean).join(" ");

  return [streetLine, cityLine].filter(Boolean).join(", ");
}

function getSocialUrl(tags: Record<string, string>, keys: string[]) {
  const value = getBestTag(tags, keys);

  if (!value) return "";

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  if (value.startsWith("@")) {
    return `https://www.instagram.com/${value.replace("@", "")}`;
  }

  if (value.includes("instagram.com") || value.includes("facebook.com")) {
    return `https://${value}`;
  }

  return value;
}

function buildOverpassQuery(latitude: number, longitude: number) {
  return `
    [out:json][timeout:18];
    (
      node(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["amenity"~"restaurant|cafe|bar|pub|fast_food|ice_cream"];
      way(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["amenity"~"restaurant|cafe|bar|pub|fast_food|ice_cream"];
      relation(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["amenity"~"restaurant|cafe|bar|pub|fast_food|ice_cream"];

      node(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["shop"~"bakery|pastry|coffee|chocolate|confectionery"];
      way(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["shop"~"bakery|pastry|coffee|chocolate|confectionery"];
      relation(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["shop"~"bakery|pastry|coffee|chocolate|confectionery"];

      node(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["tourism"~"hotel|museum|attraction|guest_house"];
      way(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["tourism"~"hotel|museum|attraction|guest_house"];
      relation(around:${SEARCH_RADIUS_METERS},${latitude},${longitude})["name"]["tourism"~"hotel|museum|attraction|guest_house"];
    );
    out center tags 40;
  `;
}

async function fetchOverpassElements(latitude: number, longitude: number) {
  const query = buildOverpassQuery(latitude, longitude);

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error("Overpass non disponibile");
  }

  const data = (await response.json()) as OverpassResponse;

  return Array.isArray(data.elements) ? data.elements : [];
}

function findBestOsmElement(
  place: BasePlaceForOpenData,
  elements: OverpassElement[]
) {
  if (!hasCoordinates(place)) return null;

  const placeLatitude = place.latitude as number;
  const placeLongitude = place.longitude as number;
  const placeName = place.name;

  const scoredElements = elements
    .map((element) => {
      const tags = element.tags || {};
      const elementName = cleanText(tags.name);
      const elementLatitude = getElementLatitude(element);
      const elementLongitude = getElementLongitude(element);

      if (
        !elementName ||
        typeof elementLatitude !== "number" ||
        typeof elementLongitude !== "number"
      ) {
        return null;
      }

      const similarity = getNameSimilarity(placeName, elementName);
      const distance = getDistanceMeters({
        firstLatitude: placeLatitude,
        firstLongitude: placeLongitude,
        secondLatitude: elementLatitude,
        secondLongitude: elementLongitude,
      });

      const distanceScore = Math.max(0, 80 - distance);
      const score = similarity + distanceScore;

      return {
        element,
        score,
        similarity,
        distance,
      };
    })
    .filter(
      (
        item
      ): item is {
        element: OverpassElement;
        score: number;
        similarity: number;
        distance: number;
      } => Boolean(item)
    )
    .sort((a, b) => b.score - a.score);

  const bestMatch = scoredElements[0];

  if (!bestMatch) return null;

  if (bestMatch.similarity < 55 || bestMatch.distance > 90) {
    return null;
  }

  return bestMatch.element;
}

function enrichmentFromOsmElement(element: OverpassElement): OpenDataEnrichment {
  const tags = element.tags || {};
  const website = getBestTag(tags, [
    "website",
    "contact:website",
    "url",
    "official_website",
  ]);
  const phone = getBestTag(tags, ["phone", "contact:phone"]);
  const openingHours = getBestTag(tags, ["opening_hours"]);
  const cuisine = getBestTag(tags, ["cuisine"]);
  const address = getAddressFromOsmTags(tags);

  return {
    ...emptyOpenDataEnrichment,
    source: "openstreetmap",
    lastEnrichedAt: new Date().toISOString(),

    osmId: String(element.id),
    osmType: element.type,
    osmTags: tags,

    name: getBestTag(tags, ["name"]),
    category: getOsmCategory(tags),
    cuisine,
    address,
    website,
    phone,
    openingHours,

    instagramUrl: getSocialUrl(tags, [
      "contact:instagram",
      "instagram",
      "social:instagram",
    ]),
    facebookUrl: getSocialUrl(tags, [
      "contact:facebook",
      "facebook",
      "social:facebook",
    ]),

    outdoorSeating: getBestTag(tags, ["outdoor_seating"]),
    wheelchair: getBestTag(tags, ["wheelchair"]),
    takeaway: getBestTag(tags, ["takeaway"]),
    delivery: getBestTag(tags, ["delivery"]),
    vegetarian: getBestTag(tags, ["diet:vegetarian"]),
    vegan: getBestTag(tags, ["diet:vegan"]),

    wikidataId: "",
    wikipediaTitle: "",
  };
}

function mergeEnrichmentData(
  base: OpenDataEnrichment,
  next: Partial<OpenDataEnrichment>
): OpenDataEnrichment {
  const source: OpenDataSource =
    base.source !== "none" && next.source && next.source !== base.source
      ? "mixed"
      : next.source || base.source;

  return {
    ...base,
    ...next,
    source,
    lastEnrichedAt: new Date().toISOString(),

    osmTags: {
      ...base.osmTags,
      ...(next.osmTags || {}),
    },

    name: next.name || base.name,
    category: next.category || base.category,
    cuisine: next.cuisine || base.cuisine,
    address: next.address || base.address,
    website: next.website || base.website,
    phone: next.phone || base.phone,
    openingHours: next.openingHours || base.openingHours,

    instagramUrl: next.instagramUrl || base.instagramUrl,
    facebookUrl: next.facebookUrl || base.facebookUrl,

    outdoorSeating: next.outdoorSeating || base.outdoorSeating,
    wheelchair: next.wheelchair || base.wheelchair,
    takeaway: next.takeaway || base.takeaway,
    delivery: next.delivery || base.delivery,
    vegetarian: next.vegetarian || base.vegetarian,
    vegan: next.vegan || base.vegan,

    wikidataId: next.wikidataId || base.wikidataId,
    wikipediaTitle: next.wikipediaTitle || base.wikipediaTitle,
    description: next.description || base.description,
    imageUrl: next.imageUrl || base.imageUrl,
    imageAttribution: next.imageAttribution || base.imageAttribution,
  };
}

type WikipediaEnrichment = {
  description: string;
  imageUrl: string;
  imageAttribution: string;
  wikipediaTitle: string;
  wikipediaUrl: string;
  awards: string[];
};

const WIKI_LANG = "it";
// Soglia rigida per la geosearch Wikipedia: la voce dev'essere sul posto.
const WIKI_MAX_DISTANCE_METERS = 70;
// Soglia per match via Wikidata (coord nominali della voce vs locale).
const WIKIDATA_MAX_DISTANCE_METERS = 500;

// Filtro "solo gastronomia": la voce deve descrivere un locale dove si mangia/beve.
const FOOD_VENUE_REGEX =
  /ristorant|restaurant|trattoria|osteria|pizzeri|pizza|caff|caf[eé]|coffee|\bbar\b|\bpub\b|gelat|pasticc|enotec|bistro|braceri|hostari|locanda|birreri|paninoteca|tavola calda|steakhouse|wine bar|cocktail/i;

function stripParentheses(value: string) {
  return value.replace(/\(.*?\)/g, "").trim();
}

function looksLikeFoodVenue(text: string) {
  return FOOD_VENUE_REGEX.test(text || "");
}

type WikipediaSummary = {
  description: string;
  imageUrl: string;
  wikipediaUrl: string;
};

async function fetchWikipediaSummaryByTitle(
  lang: string,
  title: string
): Promise<WikipediaSummary | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title
  )}`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const summary = (await response.json()) as {
    type?: string;
    extract?: string;
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
  };

  if (summary.type && summary.type !== "standard") return null;

  return {
    description: cleanText(summary.extract),
    imageUrl:
      cleanText(summary.thumbnail?.source) ||
      cleanText(summary.originalimage?.source),
    wikipediaUrl:
      cleanText(summary.content_urls?.desktop?.page) ||
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

function parseWikipediaTag(tag: string) {
  const match = tag.match(/^([a-z]{2,3}):(.+)$/i);
  if (match) return { lang: match[1].toLowerCase(), title: match[2] };
  return { lang: WIKI_LANG, title: tag };
}

type WikidataClaim = {
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: Record<string, { datavalue?: { value?: unknown } }[]>;
};

type WikidataEntity = {
  id?: string;
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  sitelinks?: Record<string, { title?: string }>;
  claims?: Record<string, WikidataClaim[]>;
};

const GUIDE_AWARD_REGEX =
  /michelin|gambero rosso|50 best|fifty best|50 top pizza|bib gourmand|tre forchette/i;

function formatGuideAward(label: string, starCount: number) {
  const lower = label.toLowerCase();
  if (lower.includes("michelin")) {
    if (lower.includes("bib")) return "Michelin · Bib Gourmand";
    if (starCount > 0) {
      return `Michelin · ${starCount} ${starCount === 1 ? "stella" : "stelle"}`;
    }
    return "Michelin";
  }
  return label;
}

// Riconoscimenti di guida (Michelin, Gambero Rosso, 50 Best...) presi da
// Wikidata (P166 "award received") con il numero di stelle dal qualificatore
// P1114. Dati curati e verificati; restituisce solo le guide riconosciute.
async function resolveGuideAwards(entity: WikidataEntity): Promise<string[]> {
  const awardClaims = entity.claims?.P166 ?? [];
  if (awardClaims.length === 0) return [];

  const refs = awardClaims
    .map((claim) => {
      const value = claim.mainsnak?.datavalue?.value as
        | { id?: string }
        | undefined;
      const amount = claim.qualifiers?.P1114?.[0]?.datavalue?.value as
        | { amount?: string }
        | undefined;
      const quantity = amount?.amount
        ? Math.abs(parseInt(amount.amount, 10)) || 0
        : 0;
      return value?.id ? { qid: value.id, quantity } : null;
    })
    .filter((ref): ref is { qid: string; quantity: number } => ref !== null);

  if (refs.length === 0) return [];

  const ids = Array.from(new Set(refs.map((ref) => ref.qid)));
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids
      .map(encodeURIComponent)
      .join("%7C")}&props=labels&languages=it%7Cen&format=json&origin=*`;

  const response = await fetch(url);
  if (!response.ok) return [];

  const data = (await response.json()) as {
    entities?: Record<string, WikidataEntity>;
  };

  const awards: string[] = [];

  refs.forEach((ref) => {
    const labelEntity = data.entities?.[ref.qid];
    const label = labelEntity ? getWikidataLabel(labelEntity) : "";
    if (!label || !GUIDE_AWARD_REGEX.test(label)) return;
    const formatted = formatGuideAward(label, ref.quantity);
    if (!awards.includes(formatted)) awards.push(formatted);
  });

  return awards;
}

async function fetchWikidataEntity(qid: string): Promise<WikidataEntity | null> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}` +
    `&props=labels%7Cdescriptions%7Cclaims%7Csitelinks&languages=it%7Cen` +
    `&sitefilter=itwiki%7Cenwiki&format=json&origin=*`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = (await response.json()) as {
    entities?: Record<string, WikidataEntity>;
  };
  return data.entities?.[qid] ?? null;
}

function getWikidataDescription(entity: WikidataEntity) {
  return (
    cleanText(entity.descriptions?.it?.value) ||
    cleanText(entity.descriptions?.en?.value)
  );
}

function getWikidataLabel(entity: WikidataEntity) {
  return (
    cleanText(entity.labels?.it?.value) || cleanText(entity.labels?.en?.value)
  );
}

function getWikidataImageUrl(entity: WikidataEntity) {
  const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (typeof file !== "string" || !file) return "";
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    file
  )}?width=640`;
}

function getWikidataCoordinates(entity: WikidataEntity) {
  const value = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value as
    | { latitude?: number; longitude?: number }
    | undefined;
  if (!value || typeof value.latitude !== "number") return null;
  return { latitude: value.latitude, longitude: value.longitude as number };
}

// Da un'entità Wikidata costruisce l'arricchimento SOLO se è un locale
// gastronomico e (per i match da ricerca) se nome e coordinate combaciano.
async function enrichFromWikidataEntity(
  entity: WikidataEntity | null,
  name: string,
  latitude: number,
  longitude: number,
  trusted: boolean
): Promise<WikipediaEnrichment | null> {
  if (!entity) return null;

  const label = getWikidataLabel(entity);
  const description = getWikidataDescription(entity);

  if (!trusted) {
    if (normalizeText(label) !== normalizeText(name)) return null;
    if (!looksLikeFoodVenue(description)) return null;

    const coordinates = getWikidataCoordinates(entity);
    if (!coordinates) return null;
    const distance = getDistanceMeters({
      firstLatitude: latitude,
      firstLongitude: longitude,
      secondLatitude: coordinates.latitude,
      secondLongitude: coordinates.longitude,
    });
    if (distance > WIKIDATA_MAX_DISTANCE_METERS) return null;
  }

  let finalDescription = description;
  let imageUrl = getWikidataImageUrl(entity);
  let wikipediaUrl = "";
  let sourceTitle = label;

  const itTitle = entity.sitelinks?.itwiki?.title;
  const enTitle = entity.sitelinks?.enwiki?.title;
  const linkTitle = itTitle || enTitle;
  const linkLang = itTitle ? "it" : "en";

  if (linkTitle) {
    const summary = await fetchWikipediaSummaryByTitle(linkLang, linkTitle).catch(
      () => null
    );
    if (summary) {
      finalDescription = summary.description || finalDescription;
      imageUrl = imageUrl || summary.imageUrl;
      wikipediaUrl = summary.wikipediaUrl;
      sourceTitle = linkTitle;
    }
  }

  if (!wikipediaUrl && entity.id) {
    wikipediaUrl = `https://www.wikidata.org/wiki/${entity.id}`;
  }

  const awards = await resolveGuideAwards(entity).catch(() => [] as string[]);

  if (!finalDescription && !imageUrl && awards.length === 0) return null;

  return {
    description: finalDescription,
    imageUrl,
    imageAttribution: linkTitle ? "Wikipedia · CC BY-SA" : "Wikidata · CC0",
    wikipediaTitle: sourceTitle,
    wikipediaUrl,
    awards,
  };
}

async function fetchWikidataSearchEnrichment(
  name: string,
  latitude: number,
  longitude: number
): Promise<WikipediaEnrichment | null> {
  const normalizedName = normalizeText(name);
  if (normalizedName.length < 3) return null;

  const url =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}` +
    `&language=it&uselang=it&format=json&limit=6&origin=*`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as {
    search?: { id?: string; label?: string }[];
  };
  const candidates = (data.search ?? []).filter(
    (candidate) =>
      candidate.id && normalizeText(candidate.label ?? "") === normalizedName
  );

  for (const candidate of candidates) {
    const entity = await fetchWikidataEntity(candidate.id as string).catch(
      () => null
    );
    const enriched = await enrichFromWikidataEntity(
      entity,
      name,
      latitude,
      longitude,
      false
    ).catch(() => null);
    if (enriched) return enriched;
  }

  return null;
}

// Geosearch Wikipedia: cattura le voci geolocalizzate (stesso nome, <=70m).
async function fetchWikipediaGeosearchEnrichment(
  name: string,
  latitude: number,
  longitude: number
): Promise<WikipediaEnrichment | null> {
  const normalizedName = normalizeText(name);
  if (normalizedName.length < 3) return null;

  const geoUrl =
    `https://${WIKI_LANG}.wikipedia.org/w/api.php?action=query&list=geosearch` +
    `&gscoord=${latitude}%7C${longitude}&gsradius=200&gslimit=10&format=json&origin=*`;

  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) return null;

  const geoData = (await geoResponse.json()) as {
    query?: { geosearch?: { title: string; dist: number }[] };
  };
  const candidates = geoData.query?.geosearch ?? [];

  const match = candidates.find((candidate) => {
    if (
      typeof candidate.dist !== "number" ||
      candidate.dist > WIKI_MAX_DISTANCE_METERS
    ) {
      return false;
    }
    return normalizeText(stripParentheses(candidate.title)) === normalizedName;
  });

  if (!match) return null;

  const summary = await fetchWikipediaSummaryByTitle(WIKI_LANG, match.title);
  if (!summary || (!summary.description && !summary.imageUrl)) return null;
  if (!looksLikeFoodVenue(summary.description)) return null;

  return {
    description: summary.description,
    imageUrl: summary.imageUrl,
    imageAttribution: "Wikipedia · CC BY-SA",
    wikipediaTitle: match.title,
    wikipediaUrl: summary.wikipediaUrl,
    awards: [],
  };
}

// Risolutore verificato: 1) tag OSM wikidata/wikipedia (collegamento certo della
// community); 2) ricerca Wikidata con verifica nome+gastronomia+coordinate;
// 3) geosearch Wikipedia. Mai dati non verificati.
async function fetchEncyclopediaEnrichment(
  name: string,
  latitude: number,
  longitude: number,
  osmTags: Record<string, string>
): Promise<WikipediaEnrichment | null> {
  const wikidataTag = cleanText(osmTags.wikidata);
  if (/^Q\d+$/.test(wikidataTag)) {
    const entity = await fetchWikidataEntity(wikidataTag).catch(() => null);
    const enriched = await enrichFromWikidataEntity(
      entity,
      name,
      latitude,
      longitude,
      true
    ).catch(() => null);
    if (enriched) return enriched;
  }

  const wikipediaTag = cleanText(osmTags.wikipedia);
  if (wikipediaTag) {
    const { lang, title } = parseWikipediaTag(wikipediaTag);
    const summary = await fetchWikipediaSummaryByTitle(lang, title).catch(
      () => null
    );
    if (summary && (summary.description || summary.imageUrl)) {
      return {
        description: summary.description,
        imageUrl: summary.imageUrl,
        imageAttribution: "Wikipedia · CC BY-SA",
        wikipediaTitle: title,
        wikipediaUrl: summary.wikipediaUrl,
        awards: [],
      };
    }
  }

  const fromWikidata = await fetchWikidataSearchEnrichment(
    name,
    latitude,
    longitude
  ).catch(() => null);
  if (fromWikidata) return fromWikidata;

  return fetchWikipediaGeosearchEnrichment(name, latitude, longitude).catch(
    () => null
  );
}

export async function enrichPlaceWithOpenData(
  place: BasePlaceForOpenData
): Promise<OpenDataEnrichment> {
  let enrichment: OpenDataEnrichment = {
    ...emptyOpenDataEnrichment,
    lastEnrichedAt: new Date().toISOString(),
    name: place.name,
    category: place.category || place.categoryBase || "",
    address: place.detail || "",
    website: place.website || "",
    phone: place.phone || "",
    openingHours: place.openingHours || "",
  };

  if (!hasCoordinates(place)) {
    return enrichment;
  }

  let osmTags: Record<string, string> = {};

  try {
    const overpassElements = await fetchOverpassElements(
      place.latitude as number,
      place.longitude as number
    );

    const bestOsmElement = findBestOsmElement(place, overpassElements);

    if (bestOsmElement) {
      osmTags = bestOsmElement.tags || {};
      enrichment = mergeEnrichmentData(
        enrichment,
        enrichmentFromOsmElement(bestOsmElement)
      );
    }
  } catch {
    enrichment = {
      ...enrichment,
      lastEnrichedAt: new Date().toISOString(),
    };
  }

  try {
    const wikipedia = await fetchEncyclopediaEnrichment(
      place.name,
      place.latitude as number,
      place.longitude as number,
      osmTags
    );

    if (wikipedia) {
      enrichment = {
        ...enrichment,
        source: enrichment.source === "openstreetmap" ? "mixed" : enrichment.source,
        description: wikipedia.description || enrichment.description,
        imageUrl: wikipedia.imageUrl || enrichment.imageUrl,
        imageAttribution:
          wikipedia.imageAttribution || enrichment.imageAttribution,
        wikipediaTitle: wikipedia.wikipediaTitle,
        wikipediaUrl: wikipedia.wikipediaUrl,
        guideAwards: wikipedia.awards,
        lastEnrichedAt: new Date().toISOString(),
      };
    }
  } catch {
    // Wikipedia best-effort: in caso di errore non mostriamo nulla.
  }

  return enrichment;
}

export function hasUsefulOpenData(enrichment: OpenDataEnrichment) {
  return (
    enrichment.website.length > 0 ||
    enrichment.phone.length > 0 ||
    enrichment.openingHours.length > 0 ||
    enrichment.cuisine.length > 0 ||
    enrichment.address.length > 0 ||
    enrichment.instagramUrl.length > 0 ||
    enrichment.facebookUrl.length > 0 ||
    enrichment.outdoorSeating.length > 0 ||
    enrichment.wheelchair.length > 0 ||
    enrichment.takeaway.length > 0 ||
    enrichment.delivery.length > 0
  );
}

export function getOpenDataDisplayRows(enrichment: OpenDataEnrichment) {
  const rows: { label: string; value: string }[] = [];

  if (enrichment.cuisine) {
    rows.push({
      label: "Cucina",
      value: enrichment.cuisine,
    });
  }

  if (enrichment.openingHours) {
    rows.push({
      label: "Orari",
      value: enrichment.openingHours,
    });
  }

  if (enrichment.phone) {
    rows.push({
      label: "Telefono",
      value: enrichment.phone,
    });
  }

  if (enrichment.website) {
    rows.push({
      label: "Sito",
      value: enrichment.website,
    });
  }

  if (enrichment.instagramUrl) {
    rows.push({
      label: "Instagram",
      value: enrichment.instagramUrl,
    });
  }

  if (enrichment.facebookUrl) {
    rows.push({
      label: "Facebook",
      value: enrichment.facebookUrl,
    });
  }

  if (enrichment.outdoorSeating) {
    rows.push({
      label: "Tavoli esterni",
      value: enrichment.outdoorSeating,
    });
  }

  if (enrichment.wheelchair) {
    rows.push({
      label: "Accessibilità",
      value: enrichment.wheelchair,
    });
  }

  if (enrichment.takeaway) {
    rows.push({
      label: "Asporto",
      value: enrichment.takeaway,
    });
  }

  if (enrichment.delivery) {
    rows.push({
      label: "Consegna",
      value: enrichment.delivery,
    });
  }

  if (enrichment.vegetarian) {
    rows.push({
      label: "Vegetariano",
      value: enrichment.vegetarian,
    });
  }

  if (enrichment.vegan) {
    rows.push({
      label: "Vegano",
      value: enrichment.vegan,
    });
  }

  return rows;
}
