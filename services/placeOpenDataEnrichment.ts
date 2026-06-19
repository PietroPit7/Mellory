export type OpenDataSource =
  | "none"
  | "openstreetmap"
  | "mixed";

export type OpenDataReviewSource =
  | "google"
  | "thefork"
  | "tripadvisor"
  | "yelp"
  | "foursquare";

export type OpenDataReviewLink = {
  sourceId: OpenDataReviewSource;
  url: string;
  verifiedBy: "openstreetmap" | "wikidata" | "google-places";
};

export type OpenDataReviewRating = {
  sourceId: OpenDataReviewSource;
  rating: number;
  scale: number;
  reviewCount: number | null;
  url: string;
  verifiedBy: "google-places";
};

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
  externalReviewLinks: OpenDataReviewLink[];
  reviewRatings: OpenDataReviewRating[];

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

type GooglePlacesTextSearchPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
};

type GooglePlacesTextSearchResponse = {
  places?: GooglePlacesTextSearchPlace[];
};

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT =
  "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY?.trim() ?? "";
const SEARCH_RADIUS_METERS = 140;
const GOOGLE_PLACES_MAX_DISTANCE_METERS = 320;

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
  externalReviewLinks: [],
  reviewRatings: [],

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

function normalizeUrl(url: string) {
  const trimmed = cleanText(url);

  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("www.") || trimmed.includes(".com/") || trimmed.includes(".it/")) {
    return `https://${trimmed}`;
  }
  if (trimmed.startsWith("/")) return trimmed;

  return "";
}

function isDirectGoogleReviewUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === "maps.app.goo.gl") return path.length > 1;
  if (host !== "www.google.com" && host !== "google.com" && host !== "maps.google.com") {
    return false;
  }
  if (path.includes("/search")) return false;

  return (
    path.startsWith("/maps/place/") ||
    (path === "/maps" && url.searchParams.has("cid")) ||
    (path === "/" && url.searchParams.has("cid"))
  );
}

function getReviewSourceFromUrl(url: URL): OpenDataReviewSource | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (isDirectGoogleReviewUrl(url)) return "google";

  const isTheFork =
    host === "thefork.it" ||
    host.endsWith(".thefork.it") ||
    host === "thefork.com" ||
    host.endsWith(".thefork.com");
  if (isTheFork && !path.includes("/search") && /\/(ristorante|restaurant)\//.test(path)) {
    return "thefork";
  }

  const isTripadvisor =
    host === "tripadvisor.it" ||
    host.endsWith(".tripadvisor.it") ||
    host === "tripadvisor.com" ||
    host.endsWith(".tripadvisor.com");
  if (
    isTripadvisor &&
    !path.includes("/search") &&
    (path.includes("restaurant_review") || /^\/[1-9][0-9]{0,7}$/.test(path))
  ) {
    return "tripadvisor";
  }

  const isYelp =
    host === "yelp.com" ||
    host.endsWith(".yelp.com") ||
    /^yelp\.[a-z]{2,}(?:\.[a-z]{2})?$/.test(host) ||
    /^.+\.yelp\.[a-z]{2,}(?:\.[a-z]{2})?$/.test(host);
  if (isYelp && path.startsWith("/biz/") && !path.includes("/search")) {
    return "yelp";
  }

  const isFoursquare =
    host === "foursquare.com" ||
    host === "www.foursquare.com" ||
    host === "app.foursquare.com";
  if (
    isFoursquare &&
    !path.includes("/search") &&
    (path.startsWith("/v/") || path.startsWith("/share/venue/") || path === "/mapaction")
  ) {
    return "foursquare";
  }

  return null;
}

function getVerifiedReviewLinkFromUrl(
  url: string,
  verifiedBy: OpenDataReviewLink["verifiedBy"]
): OpenDataReviewLink | null {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl || normalizedUrl.startsWith("/")) return null;

  try {
    const parsedUrl = new URL(normalizedUrl);
    const sourceId = getReviewSourceFromUrl(parsedUrl);

    return sourceId
      ? {
          sourceId,
          url: normalizedUrl,
          verifiedBy,
        }
      : null;
  } catch {
    return null;
  }
}

function dedupeReviewLinks(links: OpenDataReviewLink[]) {
  return links.filter(
    (link, index, allLinks) =>
      allLinks.findIndex(
        (candidate) =>
          candidate.sourceId === link.sourceId && candidate.url === link.url
      ) === index
  );
}

function dedupeReviewRatings(ratings: OpenDataReviewRating[]) {
  return ratings.filter(
    (rating, index, allRatings) =>
      allRatings.findIndex(
        (candidate) =>
          candidate.sourceId === rating.sourceId && candidate.url === rating.url
      ) === index
  );
}

function getReviewUrlCandidatesFromTag(key: string, value: string) {
  const normalizedKey = key.toLowerCase();
  const cleanValue = cleanText(value);
  const candidates = [cleanValue];

  if (!cleanValue) return candidates;

  if (
    normalizedKey.includes("google") &&
    normalizedKey.includes("cid") &&
    /^\d+$/.test(cleanValue)
  ) {
    candidates.push(`https://www.google.com/maps?cid=${cleanValue}`);
  }

  if (normalizedKey.includes("tripadvisor") && cleanValue.startsWith("Restaurant_Review")) {
    candidates.push(`https://www.tripadvisor.it/${cleanValue}`);
  }

  if (normalizedKey.includes("tripadvisor") && /^[1-9][0-9]{0,7}$/.test(cleanValue)) {
    candidates.push(`https://www.tripadvisor.com/${cleanValue}`);
  }

  if (
    normalizedKey.includes("thefork") &&
    (cleanValue.startsWith("/ristorante/") || cleanValue.startsWith("/restaurant/"))
  ) {
    candidates.push(`https://www.thefork.it${cleanValue}`);
  }

  if (
    normalizedKey.includes("yelp") &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{1,120}$/.test(cleanValue)
  ) {
    candidates.push(`https://www.yelp.com/biz/${encodeURIComponent(cleanValue)}`);
  }

  if (
    normalizedKey.includes("foursquare") &&
    /^[0-9a-f]{24}$/i.test(cleanValue)
  ) {
    candidates.push(`https://www.foursquare.com/v/${cleanValue}`);
  }

  return candidates;
}

function getVerifiedReviewLinksFromOsmTags(tags: Record<string, string>) {
  const links = new Map<string, OpenDataReviewLink>();

  Object.entries(tags).forEach(([key, value]) => {
    getReviewUrlCandidatesFromTag(key, value).forEach((candidate) => {
      const link = getVerifiedReviewLinkFromUrl(candidate, "openstreetmap");
      if (!link) return;

      links.set(`${link.sourceId}|${link.url}`, link);
    });
  });

  return dedupeReviewLinks(Array.from(links.values()));
}

export function hasGooglePlacesApiKey() {
  return GOOGLE_PLACES_API_KEY.length > 0;
}

function buildGooglePlacesTextQuery(place: BasePlaceForOpenData) {
  return [place.name, place.detail, place.category]
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(", ");
}

function getGooglePlaceDistanceMeters(
  place: BasePlaceForOpenData,
  googlePlace: GooglePlacesTextSearchPlace
) {
  const latitude = googlePlace.location?.latitude;
  const longitude = googlePlace.location?.longitude;

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !hasCoordinates(place)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return getDistanceMeters({
    firstLatitude: place.latitude as number,
    firstLongitude: place.longitude as number,
    secondLatitude: latitude,
    secondLongitude: longitude,
  });
}

function getBestGooglePlaceMatch(
  place: BasePlaceForOpenData,
  places: GooglePlacesTextSearchPlace[]
) {
  return places
    .map((googlePlace) => {
      const displayName = cleanText(googlePlace.displayName?.text);
      const similarity = getNameSimilarity(place.name, displayName);
      const distance = getGooglePlaceDistanceMeters(place, googlePlace);
      const distanceScore = Number.isFinite(distance)
        ? Math.max(0, GOOGLE_PLACES_MAX_DISTANCE_METERS - distance) / 6
        : 0;

      return {
        googlePlace,
        similarity,
        distance,
        score: similarity + distanceScore,
      };
    })
    .filter(
      (candidate) =>
        candidate.similarity >= 70 &&
        candidate.distance <= GOOGLE_PLACES_MAX_DISTANCE_METERS &&
        cleanText(candidate.googlePlace.googleMapsUri).length > 0
    )
    .sort((firstCandidate, secondCandidate) => {
      return secondCandidate.score - firstCandidate.score;
    })[0]?.googlePlace;
}

async function fetchGooglePlacesEnrichment(
  place: BasePlaceForOpenData
): Promise<Partial<OpenDataEnrichment> | null> {
  if (!hasGooglePlacesApiKey() || !hasCoordinates(place)) return null;

  const textQuery = buildGooglePlacesTextQuery(place);
  if (textQuery.length < 3) return null;

  const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri",
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "it",
      regionCode: "IT",
      pageSize: 5,
      locationBias: {
        circle: {
          center: {
            latitude: place.latitude,
            longitude: place.longitude,
          },
          radius: 500,
        },
      },
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as GooglePlacesTextSearchResponse;
  const googlePlace = getBestGooglePlaceMatch(place, data.places ?? []);
  const googleMapsUri = cleanText(googlePlace?.googleMapsUri);

  if (!googlePlace || !googleMapsUri) return null;

  const googleReviewLink: OpenDataReviewLink = {
    sourceId: "google",
    url: googleMapsUri,
    verifiedBy: "google-places",
  };
  const externalReviewLinks = getVerifiedReviewLinkFromUrl(
    googleReviewLink.url,
    googleReviewLink.verifiedBy
  )
    ? [googleReviewLink]
    : [];

  const rating =
    typeof googlePlace.rating === "number" && Number.isFinite(googlePlace.rating)
      ? googlePlace.rating
      : null;
  const reviewCount =
    typeof googlePlace.userRatingCount === "number" &&
    Number.isFinite(googlePlace.userRatingCount)
      ? Math.max(0, Math.round(googlePlace.userRatingCount))
      : null;

  return {
    address: cleanText(googlePlace.formattedAddress),
    externalReviewLinks,
    reviewRatings:
      rating !== null && rating > 0 && rating <= 5
        ? [
            {
              sourceId: "google",
              rating,
              scale: 5,
              reviewCount,
              url: googleMapsUri,
              verifiedBy: "google-places",
            },
          ]
        : [],
  };
}

export async function fetchGooglePlacesReviewPreview(
  place: BasePlaceForOpenData
) {
  return fetchGooglePlacesEnrichment(place);
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
    externalReviewLinks: getVerifiedReviewLinksFromOsmTags(tags),

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
    externalReviewLinks: dedupeReviewLinks([
      ...base.externalReviewLinks,
      ...(next.externalReviewLinks || []),
    ]),
    reviewRatings: dedupeReviewRatings([
      ...base.reviewRatings,
      ...(next.reviewRatings || []),
    ]),

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
  website: string;
  phone: string;
  address: string;
  awards: string[];
  reviewLinks: OpenDataReviewLink[];
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
  wikidataId: string;
};

type WikidataReference = {
  snaks?: Record<string, unknown>;
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
    wikidataId: await fetchWikidataIdForWikipediaTitle(lang, title).catch(
      () => ""
    ),
  };
}

function parseWikipediaTag(tag: string) {
  const match = tag.match(/^([a-z]{2,3}):(.+)$/i);
  if (match) return { lang: match[1].toLowerCase(), title: match[2] };
  return { lang: WIKI_LANG, title: tag };
}

async function fetchWikidataIdForWikipediaTitle(lang: string, title: string) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}` +
    `&prop=pageprops&format=json&origin=*`;
  const response = await fetch(url);
  if (!response.ok) return "";

  const data = (await response.json()) as {
    query?: {
      pages?: Record<string, { pageprops?: { wikibase_item?: string } }>;
    };
  };
  const page = Object.values(data.query?.pages ?? {})[0];
  const wikidataId = cleanText(page?.pageprops?.wikibase_item);

  return /^Q\d+$/.test(wikidataId) ? wikidataId : "";
}

type WikidataClaim = {
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: Record<string, { datavalue?: { value?: unknown } }[]>;
  references?: WikidataReference[];
  rank?: string;
};

type WikidataEntity = {
  id?: string;
  labels?: Record<string, { value?: string }>;
  aliases?: Record<string, { value?: string }[]>;
  descriptions?: Record<string, { value?: string }>;
  sitelinks?: Record<string, { title?: string }>;
  claims?: Record<string, WikidataClaim[]>;
};

type GuideAwardFamily = {
  key: string;
  label: string;
  patterns: RegExp[];
};

const GUIDE_AWARD_FAMILIES: GuideAwardFamily[] = [
  {
    key: "michelin",
    label: "Michelin",
    patterns: [/\bmichelin\b/, /\bbib gourmand\b/],
  },
  {
    key: "gambero-rosso",
    label: "Gambero Rosso",
    patterns: [
      /\bgambero rosso\b/,
      /\btre forchette\b/,
      /\bthree forks\b/,
      /\btre gamberi\b/,
      /\bthree prawns\b/,
      /\btre bicchieri\b/,
    ],
  },
  {
    key: "worlds-50-best",
    label: "The World's 50 Best Restaurants",
    patterns: [
      /\bworlds 50 best\b/,
      /\bworld s 50 best\b/,
      /\b50 best restaurants\b/,
      /\bfifty best restaurants\b/,
      /\basia s 50 best\b/,
      /\basias 50 best\b/,
      /\blatin america s 50 best\b/,
      /\blatin americas 50 best\b/,
      /\bmiddle east north africa s 50 best\b/,
      /\bmena 50 best\b/,
    ],
  },
  {
    key: "50-top-pizza",
    label: "50 Top Pizza",
    patterns: [/\b50 top pizza\b/, /\bfifty top pizza\b/],
  },
  {
    key: "espresso",
    label: "L'Espresso",
    patterns: [
      /\bl espresso\b/,
      /\blespresso\b/,
      /\bespresso guide\b/,
      /\bristoranti d italia\b/,
      /\bcappelli dell espresso\b/,
    ],
  },
  {
    key: "slow-food",
    label: "Slow Food",
    patterns: [/\bslow food\b/, /\bosterie d italia\b/, /\bchiocciola\b/],
  },
  {
    key: "gault-millau",
    label: "Gault&Millau",
    patterns: [/\bgault millau\b/, /\bgault et millau\b/, /\bgaultmillau\b/],
  },
  {
    key: "la-liste",
    label: "La Liste",
    patterns: [/\bla liste\b/],
  },
  {
    key: "best-chef",
    label: "The Best Chef Awards",
    patterns: [/\bthe best chef\b/, /\bbest chef awards\b/],
  },
  {
    key: "james-beard",
    label: "James Beard Foundation",
    patterns: [/\bjames beard\b/],
  },
  {
    key: "forbes-travel-guide",
    label: "Forbes Travel Guide",
    patterns: [/\bforbes travel guide\b/],
  },
  {
    key: "good-food-guide",
    label: "Good Food Guide",
    patterns: [/\bgood food guide\b/],
  },
  {
    key: "aa-rosettes",
    label: "AA Rosettes",
    patterns: [/\baa rosette\b/, /\baa rosettes\b/],
  },
  {
    key: "le-fooding",
    label: "Le Fooding",
    patterns: [/\ble fooding\b/],
  },
  {
    key: "oad",
    label: "OAD",
    patterns: [/\bopinionated about dining\b/, /\boad\b/],
  },
  {
    key: "falstaff",
    label: "Falstaff",
    patterns: [/\bfalstaff\b/],
  },
  {
    key: "identita-golose",
    label: "Identita Golose",
    patterns: [/\bidentita golose\b/],
  },
  {
    key: "zagat",
    label: "Zagat",
    patterns: [/\bzagat\b/],
  },
];

function getGuideAwardFamily(label: string) {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return null;

  return (
    GUIDE_AWARD_FAMILIES.find((family) =>
      family.patterns.some((pattern) => pattern.test(normalizedLabel))
    ) ?? null
  );
}

function getWikidataAliases(entity: WikidataEntity) {
  return Object.values(entity.aliases ?? {})
    .flat()
    .map((alias) => cleanText(alias.value))
    .filter(Boolean);
}

function getWikidataAwardMatchText(entity: WikidataEntity) {
  return [
    getWikidataLabel(entity),
    getWikidataDescription(entity),
    ...getWikidataAliases(entity),
  ]
    .filter(Boolean)
    .join(" ");
}

function formatGuideAward(
  label: string,
  starCount: number,
  familyKey?: string,
  familyLabel?: string
) {
  const lower = label.toLowerCase();
  const normalized = normalizeText(label);

  if (familyKey === "michelin" || lower.includes("michelin")) {
    if (lower.includes("bib")) return "Michelin · Bib Gourmand";
    if (lower.includes("green") || lower.includes("verde")) {
      return "Michelin · Stella verde";
    }
    if (starCount > 0) {
      return `Michelin · ${starCount} ${starCount === 1 ? "stella" : "stelle"}`;
    }
    return "";
  }

  if (familyKey === "gambero-rosso" && starCount > 0) {
    if (normalized.includes("forchett") || normalized.includes("fork")) {
      return `Gambero Rosso · ${starCount} ${
        starCount === 1 ? "forchetta" : "forchette"
      }`;
    }
    if (normalized.includes("gamber") || normalized.includes("prawn")) {
      return `Gambero Rosso · ${starCount} ${
        starCount === 1 ? "gambero" : "gamberi"
      }`;
    }
    if (normalized.includes("bicchier") || normalized.includes("glass")) {
      return `Gambero Rosso · ${starCount} ${
        starCount === 1 ? "bicchiere" : "bicchieri"
      }`;
    }
  }

  return label || familyLabel || "";
}

type AwardRef = {
  qid: string;
  quantity: number;
  year: number;
  hasEnd: boolean;
  hasReference: boolean;
  rank: string;
  label: string;
};

type GuideAwardRef = AwardRef & {
  familyKey: string;
  familyLabel: string;
};

function getQualifierYear(claim: WikidataClaim, property: string) {
  const value = claim.qualifiers?.[property]?.[0]?.datavalue?.value as
    | { time?: string }
    | undefined;
  if (!value?.time) return 0;
  const year = parseInt(value.time.replace(/^[+-]/, "").slice(0, 4), 10);
  return Number.isFinite(year) ? year : 0;
}

function getAwardYear(claim: WikidataClaim) {
  return Math.max(
    getQualifierYear(claim, "P585"),
    getQualifierYear(claim, "P580")
  );
}

function hasReliableClaimReference(claim: WikidataClaim) {
  return (claim.references ?? []).some(
    (reference) => Object.keys(reference.snaks ?? {}).length > 0
  );
}

function formatAwardRef(ref: AwardRef) {
  const guideRef = ref as Partial<GuideAwardRef>;

  return formatGuideAward(
    ref.label,
    ref.quantity,
    guideRef.familyKey,
    guideRef.familyLabel
  );
}

function getLatestCertainAwardRef(refs: AwardRef[]) {
  const datedRefs = refs.filter(
    (ref) => ref.year > 0 && ref.hasReference && ref.rank !== "deprecated"
  );
  if (datedRefs.length === 0) return null;

  const latestYear = Math.max(...datedRefs.map((ref) => ref.year));
  const latestRefs = datedRefs.filter((ref) => ref.year === latestYear);
  const formattedAwards = new Set(
    latestRefs.map(formatAwardRef).filter(Boolean)
  );

  if (formattedAwards.size !== 1) return null;

  return latestRefs.find((ref) => ref.rank === "preferred") ?? latestRefs[0];
}

// Riconoscimenti di guida (Michelin, Gambero Rosso, 50 Best...) presi da
// Wikidata (P166 "award received") con il numero di stelle (P1114) e le date
// (P585 data del riconoscimento / P580 inizio / P582 fine). Mostriamo solo
// claim datati e con reference: senza fonte certa non mostriamo alcun badge.
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
      return value?.id
        ? {
            qid: value.id,
            quantity,
            year: getAwardYear(claim),
            hasEnd: Boolean(claim.qualifiers?.P582?.length),
            hasReference: hasReliableClaimReference(claim),
            rank: claim.rank ?? "normal",
            label: "",
          }
        : null;
    })
    .filter((ref): ref is AwardRef => ref !== null);

  if (refs.length === 0) return [];

  const ids = Array.from(new Set(refs.map((ref) => ref.qid)));
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids
      .map(encodeURIComponent)
      .join(
        "%7C"
      )}&props=labels%7Caliases%7Cdescriptions&languages=it%7Cen&format=json&origin=*`;

  const response = await fetch(url);
  if (!response.ok) return [];

  const data = (await response.json()) as {
    entities?: Record<string, WikidataEntity>;
  };

  const guides = refs
    .map((ref) => {
      const labelEntity = data.entities?.[ref.qid];
      return { ...ref, label: labelEntity ? getWikidataLabel(labelEntity) : "" };
    })
    .map((ref) => {
      const labelEntity = data.entities?.[ref.qid];
      const family = getGuideAwardFamily(
        labelEntity ? getWikidataAwardMatchText(labelEntity) : ref.label
      );
      return ref.year > 0 && ref.hasReference && family
        ? {
            ...ref,
            familyKey: family.key,
            familyLabel: family.label,
          }
        : null;
    })
    .filter((ref): ref is GuideAwardRef => ref !== null);

  if (guides.length === 0) return [];

  const isMichelinStar = (ref: GuideAwardRef) =>
    ref.familyKey === "michelin" && !/bib/i.test(ref.label) && ref.quantity > 0;

  const awards: string[] = [];

  // Michelin: solo la valutazione più recente (preferendo quelle ancora attive).
  const michelinStars = guides.filter(isMichelinStar);
  if (michelinStars.length > 0) {
    const active = michelinStars.filter((ref) => !ref.hasEnd);
    const pool = active.length > 0 ? active : michelinStars;
    const latestMichelin = getLatestCertainAwardRef(pool);
    const formatted = latestMichelin ? formatAwardRef(latestMichelin) : "";
    if (formatted) awards.push(formatted);
  } else {
    const latestBibOrGreen = getLatestCertainAwardRef(
      guides.filter(
        (ref) =>
          ref.familyKey === "michelin" &&
          /bib|green|verde/i.test(ref.label)
      )
    );
    const formatted = latestBibOrGreen ? formatAwardRef(latestBibOrGreen) : "";
    if (formatted) awards.push(formatted);
  }

  // Altre guide importanti: una voce per famiglia, la più recente e certa.
  GUIDE_AWARD_FAMILIES.filter((family) => family.key !== "michelin").forEach(
    (family) => {
      const latestAward = getLatestCertainAwardRef(
        guides.filter((ref) => ref.familyKey === family.key)
      );
      const formatted = latestAward ? formatAwardRef(latestAward) : "";
      if (formatted && !awards.includes(formatted)) awards.push(formatted);
    }
  );

  return awards;
}

async function fetchWikidataEntity(qid: string): Promise<WikidataEntity | null> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}` +
    `&props=labels%7Caliases%7Cdescriptions%7Cclaims%7Csitelinks&languages=it%7Cen` +
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

function getWikidataClaimStringValue(claim: WikidataClaim | undefined) {
  const value = claim?.mainsnak?.datavalue?.value;

  if (typeof value === "string") return cleanText(value);
  if (
    value &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return cleanText(value.text);
  }

  return "";
}

function getWikidataStringClaims(entity: WikidataEntity, property: string) {
  return (entity.claims?.[property] ?? [])
    .map((claim) => getWikidataClaimStringValue(claim))
    .filter(Boolean);
}

function getWikidataStringClaim(entity: WikidataEntity, property: string) {
  return getWikidataStringClaims(entity, property)[0] ?? "";
}

function getWikidataVerifiedContactData(entity: WikidataEntity) {
  return {
    website: getWikidataStringClaim(entity, "P856"),
    phone: getWikidataStringClaim(entity, "P1329"),
    address: getWikidataStringClaim(entity, "P6375"),
  };
}

function getWikidataVerifiedReviewLinks(entity: WikidataEntity) {
  const candidates: string[] = [];

  getWikidataStringClaims(entity, "P3749").forEach((cid) => {
    if (/^\d{14,20}$/.test(cid)) {
      candidates.push(`https://www.google.com/maps?cid=${cid}`);
    }
  });

  getWikidataStringClaims(entity, "P3134").forEach((id) => {
    if (/^[1-9][0-9]{0,7}$/.test(id)) {
      candidates.push(`https://www.tripadvisor.com/${id}`);
    }
  });

  getWikidataStringClaims(entity, "P3108").forEach((id) => {
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{1,120}$/.test(id)) {
      candidates.push(`https://www.yelp.com/biz/${encodeURIComponent(id)}`);
    }
  });

  getWikidataStringClaims(entity, "P1968").forEach((id) => {
    if (/^[0-9a-f]{24}$/i.test(id)) {
      candidates.push(`https://www.foursquare.com/v/${id}`);
    }
  });

  return dedupeReviewLinks(
    candidates
      .map((candidate) => getVerifiedReviewLinkFromUrl(candidate, "wikidata"))
      .filter((link): link is OpenDataReviewLink => Boolean(link))
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
  const contactData = getWikidataVerifiedContactData(entity);
  const reviewLinks = getWikidataVerifiedReviewLinks(entity);

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

  // Riassunto Wikipedia e riconoscimenti in parallelo per andare più veloce.
  const [summary, awards] = await Promise.all([
    linkTitle
      ? fetchWikipediaSummaryByTitle(linkLang, linkTitle).catch(() => null)
      : Promise.resolve(null),
    resolveGuideAwards(entity).catch(() => [] as string[]),
  ]);

  if (summary) {
    finalDescription = summary.description || finalDescription;
    imageUrl = imageUrl || summary.imageUrl;
    wikipediaUrl = summary.wikipediaUrl;
    sourceTitle = linkTitle as string;
  }

  if (!wikipediaUrl && entity.id) {
    wikipediaUrl = `https://www.wikidata.org/wiki/${entity.id}`;
  }

  const hasContactData =
    contactData.website || contactData.phone || contactData.address;

  if (
    !finalDescription &&
    !imageUrl &&
    awards.length === 0 &&
    !hasContactData &&
    reviewLinks.length === 0
  ) {
    return null;
  }

  return {
    description: finalDescription,
    imageUrl,
    imageAttribution: linkTitle ? "Wikipedia · CC BY-SA" : "Wikidata · CC0",
    wikipediaTitle: sourceTitle,
    wikipediaUrl,
    website: contactData.website,
    phone: contactData.phone,
    address: contactData.address,
    awards,
    reviewLinks,
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

  const linkedEnrichment = summary.wikidataId
    ? await enrichFromWikidataEntity(
        await fetchWikidataEntity(summary.wikidataId).catch(() => null),
        name,
        latitude,
        longitude,
        true
      ).catch(() => null)
    : null;

  return {
    description: summary.description,
    imageUrl: summary.imageUrl || linkedEnrichment?.imageUrl || "",
    imageAttribution: summary.imageUrl
      ? "Wikipedia · CC BY-SA"
      : linkedEnrichment?.imageAttribution || "Wikipedia · CC BY-SA",
    wikipediaTitle: match.title,
    wikipediaUrl: summary.wikipediaUrl,
    website: linkedEnrichment?.website || "",
    phone: linkedEnrichment?.phone || "",
    address: linkedEnrichment?.address || "",
    awards: linkedEnrichment?.awards ?? [],
    reviewLinks: linkedEnrichment?.reviewLinks ?? [],
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
      const linkedEnrichment = summary.wikidataId
        ? await enrichFromWikidataEntity(
            await fetchWikidataEntity(summary.wikidataId).catch(() => null),
            name,
            latitude,
            longitude,
            true
          ).catch(() => null)
        : null;

      return {
        description: summary.description,
        imageUrl: summary.imageUrl || linkedEnrichment?.imageUrl || "",
        imageAttribution: summary.imageUrl
          ? "Wikipedia · CC BY-SA"
          : linkedEnrichment?.imageAttribution || "Wikipedia · CC BY-SA",
        wikipediaTitle: title,
        wikipediaUrl: summary.wikipediaUrl,
        website: linkedEnrichment?.website || "",
        phone: linkedEnrichment?.phone || "",
        address: linkedEnrichment?.address || "",
        awards: linkedEnrichment?.awards ?? [],
        reviewLinks: linkedEnrichment?.reviewLinks ?? [],
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
    const overpassElements = await Promise.race([
      fetchOverpassElements(place.latitude as number, place.longitude as number),
      new Promise<OverpassElement[]>((resolve) =>
        setTimeout(() => resolve([]), 6000)
      ),
    ]);

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
        website: wikipedia.website || enrichment.website,
        phone: wikipedia.phone || enrichment.phone,
        address: wikipedia.address || enrichment.address,
        externalReviewLinks: dedupeReviewLinks([
          ...enrichment.externalReviewLinks,
          ...wikipedia.reviewLinks,
        ]),
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
    enrichment.externalReviewLinks.length > 0 ||
    enrichment.reviewRatings.length > 0 ||
    enrichment.guideAwards.length > 0 ||
    enrichment.description.length > 0 ||
    enrichment.imageUrl.length > 0 ||
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
