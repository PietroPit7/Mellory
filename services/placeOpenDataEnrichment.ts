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
  description: string;

  imageUrl: string;
  imageAttribution: string;
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
  description: "",

  imageUrl: "",
  imageAttribution: "",
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

  try {
    const overpassElements = await fetchOverpassElements(
      place.latitude as number,
      place.longitude as number
    );

    const bestOsmElement = findBestOsmElement(place, overpassElements);

    if (bestOsmElement) {
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
