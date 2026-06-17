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
const CITY_SUGGESTION_LIMIT = 8;
const PLACE_SUGGESTION_LIMIT = 10;
const PLACE_LIMIT = 120;
const PLACE_RADIUS_METERS = 6500;

const PLACE_CATEGORIES = [
  "catering.restaurant",
  "catering.restaurant.pizza",
  "catering.cafe",
  "catering.bar",
  "catering.pub",
  "catering.fast_food",
  "catering.ice_cream",
  "tourism.attraction",
  "leisure",
  "entertainment",
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
  };
}

function dedupeCitySuggestions(suggestions: CitySuggestion[]) {
  const uniqueSuggestions = new Map<string, CitySuggestion>();

  suggestions.forEach((suggestion) => {
    const key = [
      suggestion.cityLabel,
      suggestion.detailLabel,
      suggestion.latitude.toFixed(4),
      suggestion.longitude.toFixed(4),
    ]
      .join("|")
      .toLowerCase();

    if (!uniqueSuggestions.has(key)) {
      uniqueSuggestions.set(key, suggestion);
    }
  });

  return Array.from(uniqueSuggestions.values()).slice(0, CITY_SUGGESTION_LIMIT);
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
  if (safeCategories.includes("tourism.attraction")) return "Attrazione";
  if (safeCategories.some((category) => category.startsWith("entertainment"))) {
    return "Intrattenimento";
  }
  if (safeCategories.some((category) => category.startsWith("leisure"))) {
    return "Tempo libero";
  }

  return "Luogo";
}

function getPlaceCategory(categories: string[] | undefined, categoryBase: string) {
  const safeCategories = categories || [];

  if (
    safeCategories.includes("catering.restaurant.pizza") ||
    safeCategories.includes("catering.fast_food.pizza")
  ) {
    return "Ristorante / Pizza";
  }

  if (safeCategories.includes("catering.cafe.ice_cream")) {
    return "Caffè / Gelateria";
  }

  if (safeCategories.includes("catering.cafe.coffee_shop")) {
    return "Caffè / Coffee shop";
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

  const categories = Array.isArray(properties?.categories)
    ? properties.categories
    : [];
  const categoryBase = getPlaceCategoryBase(categories);
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

export async function fetchCitySuggestions(query: string) {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 3) return [];

  const cacheKey = trimmedQuery.toLocaleLowerCase("it");
  const cachedSuggestions = citySuggestionsCache.get(cacheKey);
  if (cachedSuggestions) return cachedSuggestions;

  const apiKey = getGeoapifyApiKey();
  const url = `${AUTOCOMPLETE_ENDPOINT}?text=${encodeURIComponent(
    trimmedQuery
  )}&type=city&limit=${CITY_SUGGESTION_LIMIT}&lang=it&format=geojson&apiKey=${encodeURIComponent(
    apiKey
  )}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      "Non riesco a caricare i suggerimenti citta da Geoapify. Controlla la chiave API o riprova tra poco."
    );
  }

  const data =
    (await response.json()) as GeoapifyFeatureCollection<GeoapifyCityProperties>;
  const features = Array.isArray(data.features) ? data.features : [];
  const suggestions = features
    .map((feature, index) => toCitySuggestion(feature, index, trimmedQuery))
    .filter((city): city is CitySuggestion => city !== null);

  const uniqueSuggestions = dedupeCitySuggestions(suggestions);
  citySuggestionsCache.set(cacheKey, uniqueSuggestions);

  return uniqueSuggestions;
}

type NearbyPlacesOptions = {
  radiusMeters?: number;
  limit?: number;
};

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

  const apiKey = getGeoapifyApiKey();
  const origin = { latitude, longitude };
  const url = `${PLACES_ENDPOINT}?categories=${encodeURIComponent(
    PLACE_CATEGORIES
  )}&filter=circle:${longitude},${latitude},${radiusMeters}&bias=proximity:${longitude},${latitude}&limit=${limit}&lang=it&apiKey=${encodeURIComponent(
    apiKey
  )}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      "Non riesco a caricare i luoghi da Geoapify. Controlla la chiave API o riprova tra poco."
    );
  }

  const data =
    (await response.json()) as GeoapifyFeatureCollection<GeoapifyPlaceProperties>;
  const features = Array.isArray(data.features) ? data.features : [];

  const places = features
    .map((feature, index) => toNearbyPlace(feature, index, origin))
    .filter((place): place is NearbyPlace => place !== null)
    .sort((firstPlace, secondPlace) => {
      return firstPlace.distanceMeters - secondPlace.distanceMeters;
    });

  const uniquePlaces = dedupePlaces(places, limit);

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
    throw new Error(
      "Non riesco a cercare questo locale adesso. Riprova tra poco."
    );
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
}
