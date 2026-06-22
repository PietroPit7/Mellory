import type {
  CitySuggestion,
  Coordinates,
  GeoapifyCityProperties,
  GeoapifyFeature,
  GeoapifyFeatureCollection,
  GeoapifyPlaceProperties,
  NearbyPlace,
} from "@/types/geoapify";

const GEOAPIFY_API_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY?.trim() ?? "";
const AUTOCOMPLETE_ENDPOINT =
  "https://api.geoapify.com/v1/geocode/autocomplete";
const PLACES_ENDPOINT = "https://api.geoapify.com/v2/places";
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org";
const NOMINATIM_UA = "Mellory/1.0 (mellory-app)";
const CITY_QUERY_RESULT_LIMIT = 12;
const CITY_SUGGESTION_LIMIT = 4;
const PLACE_SUGGESTION_LIMIT = 14;
const PLACE_LIMIT = 180;
const PLACE_RADIUS_METERS = 9000;

// OpenStreetMap (Overpass) è la fonte verificata dalla community: la uniamo a
// Geoapify per avere molti più locali certi nella stessa zona.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
const OVERPASS_MAX_RESULTS = 340;

// Mellory è una guida gastronomica: solo locali dove si mangia e si beve,
// niente attrazioni/musei/luoghi turistici.
const PLACE_CATEGORIES = [
  "catering.restaurant",
  "catering.restaurant.pizza",
  "catering.cafe",
  "catering.cafe.coffee_shop",
  "catering.cafe.ice_cream",
  "catering.bar",
  "catering.pub",
  "catering.fast_food",
  "catering.fast_food.pizza",
  "catering.food_court",
  "catering.ice_cream",
  "commercial.food_and_drink",
].join(",");

const citySuggestionsCache = new Map<string, CitySuggestion[]>();
const nearbyPlacesCache = new Map<string, NearbyPlace[]>();
const placeSuggestionsCache = new Map<string, NearbyPlace[]>();

export function hasGeoapifyApiKey() {
  return GEOAPIFY_API_KEY.length > 0;
}

function getGeoapifyApiKey() {
  if (!hasGeoapifyApiKey()) {
    throw new Error(
      "Manca EXPO_PUBLIC_GEOAPIFY_API_KEY. Aggiungila al file .env.local e riavvia Expo con npx expo start -c."
    );
  }

  return GEOAPIFY_API_KEY;
}

function cleanText(value: string | undefined) {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/;/g, ", ").trim();
}

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase("it")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getNonEmptyParts(parts: (string | undefined)[]) {
  return parts.map(cleanText).filter((city): city is string => city.length > 0);
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function getDistanceMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number
) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((toLatitude - fromLatitude) * Math.PI) / 180;
  const longitudeDelta = ((toLongitude - fromLongitude) * Math.PI) / 180;
  const fromLatitudeRadians = (fromLatitude * Math.PI) / 180;
  const toLatitudeRadians = (toLatitude * Math.PI) / 180;

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusMeters * c);
}

function getCityLabel(properties: GeoapifyCityProperties | undefined) {
  return (
    cleanText(properties?.city) ||
    cleanText(properties?.municipality) ||
    cleanText(properties?.name) ||
    cleanText(properties?.county)
  );
}

function getCityDetail(properties: GeoapifyCityProperties | undefined) {
  const detailParts = getNonEmptyParts([properties?.state, properties?.country]);
  return detailParts.join(", ") || cleanText(properties?.formatted);
}

function getCityKind(
  properties: GeoapifyCityProperties | undefined
): CitySuggestion["kind"] {
  const resultType = cleanText(properties?.result_type).toLowerCase();

  if (
    resultType.includes("suburb") ||
    resultType.includes("district") ||
    resultType.includes("neighbourhood") ||
    resultType.includes("county")
  ) {
    return "area";
  }

  return "city";
}

function toCitySuggestion(
  feature: GeoapifyFeature<GeoapifyCityProperties>,
  index: number,
  fallbackLabel: string
): CitySuggestion | null {
  const properties = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  const longitude = properties?.lon ?? coordinates?.[0];
  const latitude = properties?.lat ?? coordinates?.[1];

  if (latitude == null || longitude == null) return null;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const cityLabel = getCityLabel(properties) || fallbackLabel;
  const detailLabel = getCityDetail(properties) || "Citta selezionata";
  const kind = getCityKind(properties);

  return {
    id:
      cleanText(properties?.place_id) ||
      `${cityLabel}-${latitude.toFixed(5)}-${longitude.toFixed(5)}-${index}`,
    label: cityLabel,
    detail: detailLabel,
    latitude,
    longitude,
    cityLabel,
    detailLabel,
    kind,
  };
}

function getCitySuggestionScore(query: string, suggestion: CitySuggestion) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedLabel = normalizeSearchText(suggestion.cityLabel);
  let score = 0;

  if (normalizedLabel === normalizedQuery) score += 1000;
  if (normalizedLabel.startsWith(normalizedQuery)) score += 240;
  if (suggestion.kind === "city") score += 80;
  if (normalizeSearchText(suggestion.detailLabel).includes("italia")) score += 16;

  return score;
}

function dedupeCitySuggestions(query: string, suggestions: CitySuggestion[]) {
  const uniqueSuggestions = new Map<string, CitySuggestion>();

  suggestions.forEach((suggestion) => {
    const key = normalizeSearchText(suggestion.cityLabel);
    const current = uniqueSuggestions.get(key);

    if (
      !current ||
      getCitySuggestionScore(query, suggestion) > getCitySuggestionScore(query, current)
    ) {
      uniqueSuggestions.set(key, suggestion);
    }
  });

  const sortedSuggestions = Array.from(uniqueSuggestions.values()).sort(
    (firstSuggestion, secondSuggestion) =>
      getCitySuggestionScore(query, secondSuggestion) -
      getCitySuggestionScore(query, firstSuggestion)
  );
  const exactSuggestion = sortedSuggestions.find(
    (suggestion) =>
      normalizeSearchText(suggestion.cityLabel) === normalizeSearchText(query)
  );

  return exactSuggestion
    ? [exactSuggestion]
    : sortedSuggestions.slice(0, CITY_SUGGESTION_LIMIT);
}

function dedupePlaces(places: NearbyPlace[], limit: number) {
  const uniquePlaces = new Map<string, NearbyPlace>();

  places.forEach((place) => {
    const key = [
      place.name,
      place.latitude.toFixed(5),
      place.longitude.toFixed(5),
    ]
      .join("|")
      .toLowerCase();

    if (!uniquePlaces.has(key)) {
      uniquePlaces.set(key, place);
    }
  });

  return Array.from(uniquePlaces.values()).slice(0, limit);
}

function getPlaceCategoryBase(categories: string[] | undefined) {
  const safeCategories = categories || [];

  if (
    safeCategories.includes("catering.restaurant.pizza") ||
    safeCategories.includes("catering.fast_food.pizza")
  ) {
    return "Pizzeria";
  }

  if (
    safeCategories.includes("catering.ice_cream") ||
    safeCategories.includes("catering.cafe.ice_cream") ||
    safeCategories.includes("commercial.food_and_drink.ice_cream")
  ) {
    return "Gelateria";
  }

  if (safeCategories.includes("catering.pub")) return "Pub";
  if (
    safeCategories.includes("catering.restaurant") ||
    safeCategories.some((category) =>
      category.startsWith("catering.restaurant.")
    )
  ) {
    return "Ristorante";
  }
  if (
    safeCategories.includes("catering.cafe") ||
    safeCategories.some((category) => category.startsWith("catering.cafe."))
  ) {
    return "Caffè";
  }
  if (safeCategories.includes("catering.bar")) return "Bar";
  if (safeCategories.includes("catering.fast_food")) return "Fast food";
  if (safeCategories.some((category) => category.startsWith("commercial.food_and_drink"))) {
    return "Food & drink";
  }

  return "Luogo";
}

function getPlaceCategory(categories: string[] | undefined, categoryBase: string) {
  const safeCategories = categories || [];

  if (
    safeCategories.includes("catering.restaurant.pizza") ||
    safeCategories.includes("catering.fast_food.pizza")
  ) {
    return "Pizzeria";
  }

  if (safeCategories.includes("catering.cafe.ice_cream")) {
    return "Gelateria";
  }

  if (safeCategories.includes("catering.cafe.coffee_shop")) {
    return "Caffè";
  }

  return categoryBase;
}

function getPlaceDetail(properties: GeoapifyPlaceProperties | undefined) {
  const formatted = cleanText(properties?.formatted);
  if (formatted) return formatted;

  const streetLine = getNonEmptyParts([
    properties?.street,
    properties?.housenumber,
  ]).join(" ");

  const detailParts = getNonEmptyParts([
    cleanText(properties?.address_line1) || streetLine,
    properties?.address_line2,
    properties?.city,
  ]);

  return detailParts.join(", ");
}

function toNearbyPlace(
  feature: GeoapifyFeature<GeoapifyPlaceProperties>,
  index: number,
  origin: Coordinates
): NearbyPlace | null {
  const properties = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  const longitude = properties?.lon ?? coordinates?.[0];
  const latitude = properties?.lat ?? coordinates?.[1];

  if (latitude == null || longitude == null) return null;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const name =
    cleanText(properties?.name) || cleanText(properties?.address_line1);

  if (!name) return null;

  const categories = [
    ...(Array.isArray(properties?.categories) ? properties.categories : []),
    cleanText(properties?.category),
  ].filter(Boolean);
  const categoryBase = getPlaceCategoryBase(categories);
  if (categoryBase === "Luogo") return null;

  const category = getPlaceCategory(categories, categoryBase);
  const distanceMeters =
    typeof properties?.distance === "number"
      ? Math.round(properties.distance)
      : getDistanceMeters(
          origin.latitude,
          origin.longitude,
          latitude,
          longitude
        );

  return {
    id:
      cleanText(properties?.place_id) ||
      `${name}-${latitude.toFixed(5)}-${longitude.toFixed(5)}-${index}`,
    name,
    category,
    categoryBase,
    detail: getPlaceDetail(properties),
    distance: formatDistance(distanceMeters),
    distanceMeters,
    latitude,
    longitude,
    website: cleanText(properties?.website) || cleanText(properties?.contact_website),
    phone: cleanText(properties?.phone) || cleanText(properties?.contact_phone),
    openingHours: cleanText(properties?.opening_hours),
    editorialAwards: "",
  };
}

type NominatimResult = {
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
};

async function fetchCitySuggestionsFromNominatim(
  query: string
): Promise<CitySuggestion[]> {
  try {
    const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(
      query
    )}&format=json&limit=6&accept-language=it&featuretype=city`;
    const response = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA },
    });
    if (!response.ok) return [];
    const results = (await response.json()) as NominatimResult[];
    return results
      .filter((r) => r.lat && r.lon)
      .map((r, index) => {
        const parts = r.display_name.split(",").map((s) => s.trim());
        const cityLabel = parts[0] || query;
        const detailLabel = parts.slice(1, 4).join(", ") || "";
        const latitude = parseFloat(r.lat);
        const longitude = parseFloat(r.lon);
        if (isNaN(latitude) || isNaN(longitude)) return null;
        return {
          id: `nom-${r.osm_type ?? "n"}-${r.osm_id ?? index}`,
          label: cityLabel,
          detail: detailLabel,
          latitude,
          longitude,
          cityLabel,
          detailLabel,
          kind: "city" as const,
        };
      })
      .filter((s) => s !== null) as CitySuggestion[];
  } catch {
    return [];
  }
}

async function fetchPlaceSuggestionsFromNominatim(
  query: string,
  origin?: Coordinates
): Promise<NearbyPlace[]> {
  try {
    const viewbox = origin
      ? `&viewbox=${origin.longitude - 0.6},${origin.latitude + 0.6},${
          origin.longitude + 0.6
        },${origin.latitude - 0.6}&bounded=0`
      : "";
    const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(
      query
    )}&format=json&limit=10&accept-language=it${viewbox}`;
    const response = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA },
    });
    if (!response.ok) return [];
    const results = (await response.json()) as NominatimResult[];
    const fallbackOrigin = origin ?? { latitude: 0, longitude: 0 };
    return results
      .filter((r) => r.class === "amenity" && r.lat && r.lon)
      .map((r, index) => {
        const lat = parseFloat(r.lat);
        const lon = parseFloat(r.lon);
        if (isNaN(lat) || isNaN(lon)) return null;
        const parts = r.display_name.split(",").map((s) => s.trim());
        const name = parts[0] || r.display_name;
        const detail = parts.slice(1, 4).join(", ");
        const t = r.type ?? "";
        let categoryBase = "Luogo";
        if (t === "restaurant") categoryBase = "Ristorante";
        else if (t === "cafe") categoryBase = "Caffè";
        else if (t === "bar") categoryBase = "Bar";
        else if (t === "pub") categoryBase = "Pub";
        else if (t === "fast_food") categoryBase = "Fast food";
        else if (t === "ice_cream") categoryBase = "Gelateria";
        else if (t === "bakery") categoryBase = "Forno";
        if (categoryBase === "Luogo") return null;
        const distanceMeters = getDistanceMeters(
          fallbackOrigin.latitude,
          fallbackOrigin.longitude,
          lat,
          lon
        );
        return {
          id: `nom-${r.osm_type ?? "n"}-${r.osm_id ?? index}`,
          name,
          category: categoryBase,
          categoryBase,
          detail,
          distance: formatDistance(distanceMeters),
          distanceMeters,
          latitude: lat,
          longitude: lon,
          website: "",
          phone: "",
          openingHours: "",
          editorialAwards: "",
        };
      })
      .filter((p): p is NearbyPlace => p !== null);
  } catch {
    return [];
  }
}

export async function fetchCitySuggestions(query: string) {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 3) return [];

  const cacheKey = trimmedQuery.toLocaleLowerCase("it");
  const cachedSuggestions = citySuggestionsCache.get(cacheKey);
  if (cachedSuggestions) return cachedSuggestions;

  if (!hasGeoapifyApiKey()) {
    const suggestions = await fetchCitySuggestionsFromNominatim(trimmedQuery);
    citySuggestionsCache.set(cacheKey, suggestions);
    return suggestions;
  }

  try {
    const apiKey = getGeoapifyApiKey();
    const url = `${AUTOCOMPLETE_ENDPOINT}?text=${encodeURIComponent(
      trimmedQuery
    )}&type=city&limit=${CITY_QUERY_RESULT_LIMIT}&lang=it&format=geojson&apiKey=${encodeURIComponent(
      apiKey
    )}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Geoapify city autocomplete error: ${response.status}`);
    }

    const data =
      (await response.json()) as GeoapifyFeatureCollection<GeoapifyCityProperties>;
    const features = Array.isArray(data.features) ? data.features : [];
    const suggestions = features
      .map((feature, index) => toCitySuggestion(feature, index, trimmedQuery))
      .filter((city): city is CitySuggestion => city !== null);

    const uniqueSuggestions = dedupeCitySuggestions(trimmedQuery, suggestions);
    citySuggestionsCache.set(cacheKey, uniqueSuggestions);

    return uniqueSuggestions;
  } catch {
    const suggestions = await fetchCitySuggestionsFromNominatim(trimmedQuery);
    citySuggestionsCache.set(cacheKey, suggestions);
    return suggestions;
  }
}

export function hasPreciseCitySuggestion(
  query: string,
  suggestions: CitySuggestion[]
) {
  const normalizedQuery = normalizeSearchText(query);

  return suggestions.some(
    (suggestion) =>
      suggestion.kind === "city" &&
      normalizeSearchText(suggestion.cityLabel) === normalizedQuery
  );
}

type NearbyPlacesOptions = {
  radiusMeters?: number;
  limit?: number;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function getBestTag(
  tags: Record<string, string> | undefined,
  keys: string[]
) {
  if (!tags) return "";
  for (const key of keys) {
    const value = cleanText(tags[key]);
    if (value) return value;
  }
  return "";
}

function normalizePlaceName(name: string) {
  return normalizeSearchText(name);
}

function getOsmCategoryBase(tags: Record<string, string> | undefined) {
  if (!tags) return "Luogo";

  const amenity = cleanText(tags.amenity).toLowerCase();
  const shop = cleanText(tags.shop).toLowerCase();
  const cuisine = cleanText(tags.cuisine).toLowerCase();

  if (amenity === "restaurant") {
    return cuisine.includes("pizza") ? "Pizzeria" : "Ristorante";
  }
  if (amenity === "fast_food") {
    return cuisine.includes("pizza") ? "Pizzeria" : "Fast food";
  }
  if (amenity === "cafe") return "Caffè";
  if (amenity === "bar" || amenity === "biergarten") return "Bar";
  if (amenity === "pub") return "Pub";
  if (amenity === "food_court") return "Food court";
  if (amenity === "ice_cream") return "Gelateria";
  if (shop === "bakery") return "Forno";
  if (shop === "deli") return "Gastronomia";
  if (shop === "wine") return "Enoteca";
  if (shop === "pastry" || shop === "confectionery") return "Pasticceria";
  if (shop === "ice_cream") return "Gelateria";
  if (shop === "coffee" || shop === "chocolate") return "Caffè";

  return "Luogo";
}

const CUISINE_IT: Record<string, string> = {
  italian: "Italiana",
  pizza: "Pizza",
  sushi: "Sushi",
  japanese: "Giapponese",
  chinese: "Cinese",
  indian: "Indiana",
  mexican: "Messicana",
  greek: "Greca",
  french: "Francese",
  american: "Americana",
  burger: "Burger",
  kebab: "Kebab",
  thai: "Thailandese",
  vietnamese: "Vietnamita",
  korean: "Coreana",
  mediterranean: "Mediterranea",
  seafood: "Pesce",
  fish_and_chips: "Fish & Chips",
  chicken: "Pollo",
  steak_house: "Steakhouse",
  sandwich: "Sandwich",
  pasta: "Pasta",
  regional: "Regionale",
};

function getOsmCategory(
  tags: Record<string, string> | undefined,
  categoryBase: string
) {
  const cuisine = cleanText(tags?.cuisine);
  if (!cuisine) return categoryBase;

  const firstCuisine = cuisine.split(",")[0]?.trim().toLowerCase();
  if (!firstCuisine) return categoryBase;

  const label = CUISINE_IT[firstCuisine];
  if (!label) return categoryBase;

  return `${categoryBase} · ${label}`;
}

function getOsmDetail(tags: Record<string, string> | undefined) {
  if (!tags) return "";

  const street = cleanText(tags["addr:street"]);
  const houseNumber = cleanText(tags["addr:housenumber"]);
  const city = cleanText(tags["addr:city"]);
  const streetLine = [street, houseNumber].filter(Boolean).join(" ");

  return [streetLine, city].filter(Boolean).join(", ");
}

function osmElementToNearbyPlace(
  element: OverpassElement,
  origin: Coordinates
): NearbyPlace | null {
  const tags = element.tags;
  const name = getBestTag(tags, ["name", "name:it"]);
  if (!name) return null;

  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }

  const categoryBase = getOsmCategoryBase(tags);
  if (categoryBase === "Luogo") return null;

  const distanceMeters = getDistanceMeters(
    origin.latitude,
    origin.longitude,
    latitude,
    longitude
  );

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    category: getOsmCategory(tags, categoryBase),
    categoryBase,
    detail: getOsmDetail(tags),
    distance: formatDistance(distanceMeters),
    distanceMeters,
    latitude,
    longitude,
    website: getBestTag(tags, ["website", "contact:website", "url"]),
    phone: getBestTag(tags, ["phone", "contact:phone"]),
    openingHours: getBestTag(tags, ["opening_hours"]),
    editorialAwards: "",
  };
}

function buildNearbyOverpassQuery(
  latitude: number,
  longitude: number,
  radiusMeters: number
) {
  const around = `around:${radiusMeters},${latitude},${longitude}`;

  return `
    [out:json][timeout:25];
    (
      nwr(${around})["name"]["amenity"~"^(restaurant|bar|cafe|pub|fast_food|ice_cream|biergarten)$"];
      nwr(${around})["name"]["amenity"="food_court"];
      nwr(${around})["name"]["shop"~"^(bakery|pastry|confectionery|coffee|chocolate|ice_cream|deli|wine)$"];
    );
    out center tags ${OVERPASS_MAX_RESULTS};
  `;
}

async function fetchOverpassNearby(
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<NearbyPlace[]> {
  const query = buildNearbyOverpassQuery(latitude, longitude, radiusMeters);
  const origin = { latitude, longitude };

  const tryEndpoint = (endpoint: string): Promise<NearbyPlace[]> =>
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    })
      .then((r) => {
        if (!r.ok) throw new Error("not ok");
        return r.json() as Promise<{ elements?: OverpassElement[] }>;
      })
      .then((data) => {
        const elements = Array.isArray(data.elements) ? data.elements : [];
        return elements
          .map((el) => osmElementToNearbyPlace(el, origin))
          .filter((p): p is NearbyPlace => p !== null);
      });

  // Race tutti e tre gli endpoint in parallelo: vince il primo che risponde.
  return new Promise<NearbyPlace[]>((resolve) => {
    let rejected = 0;
    OVERPASS_ENDPOINTS.forEach((ep) => {
      tryEndpoint(ep)
        .then(resolve)
        .catch(() => {
          if (++rejected === OVERPASS_ENDPOINTS.length) resolve([]);
        });
    });
  });
}

async function fetchGeoapifyNearby(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  limit: number
): Promise<NearbyPlace[]> {
  if (!hasGeoapifyApiKey()) return [];

  const apiKey = GEOAPIFY_API_KEY;
  const origin = { latitude, longitude };
  const url = `${PLACES_ENDPOINT}?categories=${encodeURIComponent(
    PLACE_CATEGORIES
  )}&filter=circle:${longitude},${latitude},${radiusMeters}&bias=proximity:${longitude},${latitude}&limit=${limit}&lang=it&apiKey=${encodeURIComponent(
    apiKey
  )}`;

  const response = await fetch(url);
  if (!response.ok) return [];

  const data =
    (await response.json()) as GeoapifyFeatureCollection<GeoapifyPlaceProperties>;
  const features = Array.isArray(data.features) ? data.features : [];

  return features
    .map((feature, index) => toNearbyPlace(feature, index, origin))
    .filter((place): place is NearbyPlace => place !== null);
}

// Unisce locali da fonti diverse: deduplica per nome normalizzato + coordinate
// arrotondate e, sui doppioni, conserva i contatti disponibili da entrambe.
function mergeNearbyPlaces(places: NearbyPlace[], limit: number) {
  const uniquePlaces = new Map<string, NearbyPlace>();

  places.forEach((place) => {
    const key = `${normalizePlaceName(place.name)}|${place.latitude.toFixed(
      4
    )}|${place.longitude.toFixed(4)}`;
    const existing = uniquePlaces.get(key);

    if (!existing) {
      uniquePlaces.set(key, place);
      return;
    }

    uniquePlaces.set(key, {
      ...existing,
      detail: existing.detail || place.detail,
      website: existing.website || place.website,
      phone: existing.phone || place.phone,
      openingHours: existing.openingHours || place.openingHours,
      categoryBase:
        existing.categoryBase !== "Luogo"
          ? existing.categoryBase
          : place.categoryBase,
      category:
        existing.categoryBase !== "Luogo" ? existing.category : place.category,
    });
  });

  return Array.from(uniquePlaces.values())
    .sort((firstPlace, secondPlace) => {
      return firstPlace.distanceMeters - secondPlace.distanceMeters;
    })
    .slice(0, limit);
}

// Limita l'attesa di una fonte lenta: se non risponde entro il timeout
// restituisce il fallback, senza penalizzare i casi veloci.
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T) {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const OVERPASS_TIMEOUT_MS = 20000;

export async function fetchNearbyPlaces(
  latitude: number,
  longitude: number,
  options: NearbyPlacesOptions = {}
) {
  const radiusMeters = options.radiusMeters ?? PLACE_RADIUS_METERS;
  const limit = options.limit ?? PLACE_LIMIT;
  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(
    4
  )},${radiusMeters},${limit}`;
  const cachedPlaces = nearbyPlacesCache.get(cacheKey);
  if (cachedPlaces) return cachedPlaces;

  // Geoapify e Overpass in parallelo: se una fonte fallisce o è lenta, usiamo
  // l'altra (Overpass è limitato nel tempo per non bloccare la ricerca).
  const [geoapifyPlaces, overpassPlaces] = await Promise.all([
    withTimeout(
      fetchGeoapifyNearby(latitude, longitude, radiusMeters, limit).catch(
        () => [] as NearbyPlace[]
      ),
      12000,
      [] as NearbyPlace[]
    ),
    withTimeout(
      fetchOverpassNearby(latitude, longitude, radiusMeters).catch(
        () => [] as NearbyPlace[]
      ),
      OVERPASS_TIMEOUT_MS,
      [] as NearbyPlace[]
    ),
  ]);

  const uniquePlaces = mergeNearbyPlaces(
    [...geoapifyPlaces, ...overpassPlaces],
    limit
  );

  nearbyPlacesCache.set(cacheKey, uniquePlaces);

  return uniquePlaces;
}

export async function fetchPlaceSuggestions(
  query: string,
  origin?: Coordinates
) {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 3) return [];

  const originKey = origin
    ? `${origin.latitude.toFixed(3)},${origin.longitude.toFixed(3)}`
    : "global";
  const cacheKey = `${trimmedQuery.toLocaleLowerCase("it")}|${originKey}`;
  const cachedPlaces = placeSuggestionsCache.get(cacheKey);
  if (cachedPlaces) return cachedPlaces;

  if (!hasGeoapifyApiKey()) {
    const places = await fetchPlaceSuggestionsFromNominatim(trimmedQuery, origin);
    placeSuggestionsCache.set(cacheKey, places);
    return places;
  }

  try {
    const apiKey = getGeoapifyApiKey();
    const proximity = origin
      ? `&bias=proximity:${origin.longitude},${origin.latitude}`
      : "";
    const url = `${AUTOCOMPLETE_ENDPOINT}?text=${encodeURIComponent(
      trimmedQuery
    )}&type=amenity&limit=${PLACE_SUGGESTION_LIMIT}&lang=it&format=geojson${proximity}&apiKey=${encodeURIComponent(
      apiKey
    )}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Geoapify place autocomplete error: ${response.status}`);
    }

    const data =
      (await response.json()) as GeoapifyFeatureCollection<GeoapifyPlaceProperties>;
    const features = Array.isArray(data.features) ? data.features : [];
    const fallbackOrigin = origin ?? { latitude: 0, longitude: 0 };
    const places = features
      .map((feature, index) => toNearbyPlace(feature, index, fallbackOrigin))
      .filter((place): place is NearbyPlace => place !== null)
      .sort((firstPlace, secondPlace) => {
        return firstPlace.distanceMeters - secondPlace.distanceMeters;
      });

    const uniquePlaces = dedupePlaces(places, PLACE_SUGGESTION_LIMIT);
    placeSuggestionsCache.set(cacheKey, uniquePlaces);

    return uniquePlaces;
  } catch {
    const places = await fetchPlaceSuggestionsFromNominatim(trimmedQuery, origin);
    placeSuggestionsCache.set(cacheKey, places);
    return places;
  }
}
