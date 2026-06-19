import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { PressableScale } from "@/components/pressable-scale";
import {
  type MelloryThemeColors,
  useMelloryTheme,
} from "@/contexts/mellory-theme";
import {
  fetchCitySuggestions as fetchGeoapifyCitySuggestions,
  fetchNearbyPlaces as fetchGeoapifyNearbyPlaces,
  fetchPlaceSuggestions as fetchGeoapifyPlaceSuggestions,
  hasPreciseCitySuggestion,
} from "@/services/geoapify";
import type { NearbyPlace as GeoapifyNearbyPlace } from "@/types/geoapify";

const GEOAPIFY_API_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY ?? "";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

type SearchMode = "nearby" | "city";
type CarouselKey = "places";

const CAROUSEL_STEP: Record<CarouselKey, number> = {
  places: 254,
};
const HOME_DASHBOARD_LIMIT = 100;

type Coordinates = {
  latitude: number;
  longitude: number;
};

type CitySuggestion = {
  id: string;
  label: string;
  detail: string;
  latitude: number;
  longitude: number;
  cityLabel: string;
  detailLabel: string;
  kind: "city" | "area";
};

type SearchContext = {
  latitude: number;
  longitude: number;
  cityLabel: string;
  detailLabel: string;
  mode: SearchMode;
};

type GeoapifyFeature = {
  properties?: {
    city?: string;
    municipality?: string;
    county?: string;
    suburb?: string;
    district?: string;
    state?: string;
    country?: string;
    formatted?: string;
    lat?: number;
    lon?: number;
    place_id?: string;
    result_type?: string;
  };
  geometry?: {
    coordinates?: [number, number];
  };
};

type OverpassElement = {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string | undefined>;
};

type DashboardCategory = {
  id: string;
  label: string;
  icon: string;
  count: number;
};

type DashboardPlace = {
  id: string;
  name: string;
  category: string;
  categoryBase: string;
  detail: string;
  distance: string;
  distanceMeters: number;
  latitude: number;
  longitude: number;
  categoryId: string;
  isGuideMentioned: boolean;
  website?: string;
  phone?: string;
  openingHours?: string;
  editorialAwards?: string;
};

const defaultCategories: DashboardCategory[] = [
  {
    id: "all",
    label: "Tutto",
    icon: "✦",
    count: 0,
  },
  {
    id: "restaurant",
    label: "Ristoranti",
    icon: "◌",
    count: 0,
  },
  {
    id: "cafe",
    label: "Caffè",
    icon: "◐",
    count: 0,
  },
  {
    id: "bar",
    label: "Bar",
    icon: "◇",
    count: 0,
  },
];

const collections = [
  {
    icon: "✦",
    title: "Da provare",
    text: "I posti che vuoi ricordarti di visitare.",
    focus: "try",
  },
  {
    icon: "♡",
    title: "Preferiti",
    text: "I locali in cui torneresti subito.",
    focus: "favorite",
  },
  {
    icon: "✓",
    title: "Visti",
    text: "I posti dove sei già stato e vuoi ricordare.",
    focus: "visited",
  },
  {
    icon: "↻",
    title: "Da rivalutare",
    text: "I locali da riprovare prima di decidere.",
    focus: "retry",
  },
];

function getCollectionIcon(item: (typeof collections)[number]) {
  if (item.title === "Visti") return "\u2713";
  if (item.title === "Da rivalutare") return "\u21BB";
  return item.icon;
}

// Liste tematiche generate al volo dai luoghi reali trovati nella zona.
type ZoneTheme = {
  id: string;
  title: string;
  hint: string;
  icon: string;
  match: (place: DashboardPlace) => boolean;
};

const ZONE_THEMES: ZoneTheme[] = [
  {
    id: "near",
    title: "Vicinissimi",
    hint: "A due passi da te",
    icon: "\u2726",
    match: (place) => place.distanceMeters <= 400,
  },
  {
    id: "dinner",
    title: "A cena",
    hint: "Ristoranti e pizzerie",
    icon: "\u25CC",
    match: (place) =>
      place.categoryId === "restaurant" || place.categoryId === "pizzeria",
  },
  {
    id: "aperitivo",
    title: "Aperitivo",
    hint: "Bar e pub",
    icon: "\u25C7",
    match: (place) => place.categoryId === "bar" || place.categoryId === "pub",
  },
  {
    id: "coffee",
    title: "Caff\u00E8 & colazione",
    hint: "Caff\u00E8 e forni",
    icon: "\u25D0",
    match: (place) =>
      place.categoryId === "cafe" || place.categoryId === "bakery",
  },
  {
    id: "sweet",
    title: "Dolce",
    hint: "Gelaterie e pasticcerie",
    icon: "\u273A",
    match: (place) =>
      place.categoryId === "ice_cream" || place.categoryId === "pastry",
  },
];

type ZoneList = ZoneTheme & {
  places: DashboardPlace[];
  count: number;
};

function buildZoneLists(places: DashboardPlace[]): ZoneList[] {
  return ZONE_THEMES.map((theme) => {
    const themePlaces = places.filter(theme.match);

    return {
      ...theme,
      places: themePlaces,
      count: themePlaces.length,
    };
  }).filter((list) => list.count > 0);
}

function hasGeoapifyApiKey() {
  return GEOAPIFY_API_KEY.trim().length > 0;
}

function cleanText(value: string | undefined) {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/;/g, ", ").trim();
}

function capitalize(value: string) {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getFriendlyMessage() {
  return "Non riesco a preparare questa zona adesso. Prova con una città vicina o usa la tua posizione.";
}

function getBestPlaceName(tags: Record<string, string | undefined> | undefined) {
  if (!tags) return "";

  return (
    tags.name ||
    tags["name:it"] ||
    tags.official_name ||
    tags.brand ||
    tags.operator ||
    ""
  );
}

function getCategoryBase(tags: Record<string, string | undefined> | undefined) {
  if (!tags) return "Locale";

  if (tags.shop === "bakery") return "Bakery";
  if (tags.shop === "pastry") return "Pasticceria";

  switch (tags.amenity) {
    case "restaurant":
      return "Ristorante";
    case "bar":
      return "Bar";
    case "cafe":
      return "Caffè";
    case "pub":
      return "Pub";
    case "fast_food":
      return "Fast food";
    case "ice_cream":
      return "Gelateria";
    case "biergarten":
      return "Birreria";
    default:
      return "Locale";
  }
}

function getCategory(tags: Record<string, string | undefined> | undefined) {
  const categoryBase = getCategoryBase(tags);
  const cuisine = cleanText(tags?.cuisine);

  if (!cuisine) return categoryBase;

  return `${categoryBase} · ${capitalize(cuisine.split(",")[0])}`;
}

function getCategoryId(categoryBase: string) {
  const value = categoryBase.toLowerCase();

  if (value.includes("ristorante")) return "restaurant";
  if (value.includes("bar")) return "bar";
  if (value.includes("caff")) return "cafe";
  if (value.includes("gelateria")) return "ice_cream";
  if (value.includes("pub")) return "pub";
  if (value.includes("bakery")) return "bakery";
  if (value.includes("pasticceria")) return "pastry";
  if (value.includes("fast")) return "fast_food";

  return value;
}

function getCategoryIcon(categoryBase: string) {
  const value = categoryBase.toLowerCase();

  if (value.includes("ristorante")) return "◌";
  if (value.includes("caff")) return "◐";
  if (value.includes("bar")) return "◇";
  if (value.includes("gelateria")) return "✺";
  if (value.includes("pub")) return "◒";
  if (value.includes("bakery") || value.includes("pasticceria")) return "✧";

  return "✦";
}

function getCategoryLabel(categoryBase: string) {
  if (categoryBase === "Caffè") return "Caffè";
  if (categoryBase === "Bakery") return "Bakery";
  return categoryBase;
}

function getAddressDetail(
  tags: Record<string, string | undefined> | undefined,
  fallbackCity: string
) {
  if (!tags) return fallbackCity;

  const street = cleanText(tags["addr:street"]);
  const houseNumber = cleanText(tags["addr:housenumber"]);
  const city =
    cleanText(tags["addr:city"]) ||
    cleanText(tags["is_in:city"]) ||
    fallbackCity;

  if (street && houseNumber && city) return `${street} ${houseNumber}, ${city}`;
  if (street && city) return `${street}, ${city}`;
  if (street) return street;
  if (city) return city;

  return fallbackCity;
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

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) return `${distanceMeters} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}


function groupSuggestions(suggestions: CitySuggestion[]) {
  return {
    cities: suggestions.filter((item) => item.kind === "city"),
    areas: suggestions.filter((item) => item.kind === "area"),
  };
}

async function getUserPosition(): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    throw new Error(
      "Attiva la posizione per vedere i posti più interessanti intorno a te."
    );
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

async function fetchLocationLabel(latitude: number, longitude: number) {
  if (!hasGeoapifyApiKey()) {
    return {
      cityLabel: "La tua zona",
      detailLabel: "Locali selezionati vicino a te",
    };
  }

  try {
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&lang=it&apiKey=${GEOAPIFY_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Label non disponibile");
    }

    const data = await response.json();
    const firstFeature = data.features?.[0] as GeoapifyFeature | undefined;
    const properties = firstFeature?.properties;

    const cityLabel =
      properties?.city ||
      properties?.municipality ||
      properties?.suburb ||
      properties?.county ||
      "La tua zona";

    const detailLabel =
      properties?.city ||
      properties?.municipality ||
      properties?.suburb ||
      properties?.county
        ? `Locali selezionati vicino a ${cityLabel}`
        : "Locali selezionati vicino a te";

    return {
      cityLabel,
      detailLabel,
    };
  } catch {
    return {
      cityLabel: "La tua zona",
      detailLabel: "Locali selezionati vicino a te",
    };
  }
}

async function fetchCitySuggestions(query: string): Promise<CitySuggestion[]> {
  const cleanedQuery = query.trim();

  if (cleanedQuery.length < 3 || !hasGeoapifyApiKey()) return [];

  try {
    return await fetchGeoapifyCitySuggestions(cleanedQuery);
  } catch {
    return [];
  }
}

async function fetchOverpassElements(query: string) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
        },
        body: query,
      });

      if (!response.ok) continue;

      const data = await response.json();
      const elements = Array.isArray(data.elements)
        ? (data.elements as OverpassElement[])
        : [];

      return elements;
    } catch {
      // Prova il prossimo endpoint senza mostrare errori tecnici in app.
    }
  }

  throw new Error(getFriendlyMessage());
}

async function fetchDashboardData(context: SearchContext) {
  const radius = 6500;
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"restaurant|bar|cafe|pub|fast_food|ice_cream|biergarten"](around:${radius},${context.latitude},${context.longitude});
      way["amenity"~"restaurant|bar|cafe|pub|fast_food|ice_cream|biergarten"](around:${radius},${context.latitude},${context.longitude});
      relation["amenity"~"restaurant|bar|cafe|pub|fast_food|ice_cream|biergarten"](around:${radius},${context.latitude},${context.longitude});
      node["shop"~"bakery|pastry"](around:${radius},${context.latitude},${context.longitude});
      way["shop"~"bakery|pastry"](around:${radius},${context.latitude},${context.longitude});
      relation["shop"~"bakery|pastry"](around:${radius},${context.latitude},${context.longitude});
    );
    out center tags;
  `;

  const [elements, geoapifyPlaces] = await Promise.all([
    // Overpass limitato nel tempo: se è lento non blocca la dashboard.
    Promise.race([
      fetchOverpassElements(query).catch(() => [] as OverpassElement[]),
      new Promise<OverpassElement[]>((resolve) =>
        setTimeout(() => resolve([]), 6500)
      ),
    ]),
    fetchGeoapifyNearbyPlaces(context.latitude, context.longitude, {
      radiusMeters: radius,
      limit: HOME_DASHBOARD_LIMIT,
    }).catch(() => []),
  ]);

  const uniquePlaces = new Set<string>();
  const places: DashboardPlace[] = [];

  elements.forEach((element) => {
    const tags = element.tags;
    const name = getBestPlaceName(tags);
    const categoryBase = getCategoryBase(tags);
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;

    if (!name) return;
    if (categoryBase === "Locale") return;
    if (latitude == null || longitude == null) return;

    const uniqueKey = `${name.toLowerCase()}-${Math.round(
      latitude * 10000
    )}-${Math.round(longitude * 10000)}`;

    if (uniquePlaces.has(uniqueKey)) return;

    uniquePlaces.add(uniqueKey);

    const distanceMeters = getDistanceMeters(
      context.latitude,
      context.longitude,
      latitude,
      longitude
    );

    places.push({
      id: `${element.type}-${element.id}`,
      name,
      category: getCategory(tags),
      categoryBase,
      detail: getAddressDetail(tags, context.cityLabel),
      distance: formatDistance(distanceMeters),
      distanceMeters,
      latitude,
      longitude,
      categoryId: getCategoryId(categoryBase),
      isGuideMentioned: false,
    });
  });

  geoapifyPlaces.forEach((geoapifyPlace) => {
    const place = geoapifyPlaceToDashboardPlace(geoapifyPlace);

    if (place.categoryBase === "Luogo") return;

    const uniqueKey = `${place.name.toLowerCase()}-${Math.round(
      place.latitude * 10000
    )}-${Math.round(place.longitude * 10000)}`;

    if (uniquePlaces.has(uniqueKey)) return;

    uniquePlaces.add(uniqueKey);
    places.push(place);
  });

  const sortedPlaces = places
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, HOME_DASHBOARD_LIMIT);

  const categoryMap = new Map<string, DashboardCategory>();

  sortedPlaces.forEach((place) => {
    const currentCategory = categoryMap.get(place.categoryId);

    categoryMap.set(place.categoryId, {
      id: place.categoryId,
      label: getCategoryLabel(place.categoryBase),
      icon: getCategoryIcon(place.categoryBase),
      count: (currentCategory?.count ?? 0) + 1,
    });
  });

  const dynamicCategories = Array.from(categoryMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);

  const categories: DashboardCategory[] = [
    {
      id: "all",
      label: "Tutto",
      icon: "✦",
      count: sortedPlaces.length,
    },
    ...dynamicCategories,
  ];

  return {
    categories,
    places: sortedPlaces,
  };
}

const HOME_SAVED_KEYS = [
  "mellory:places-index",
  "mellory:favorites",
  "mellory:try",
  "mellory:visited",
  "mellory:retry",
];

async function readJsonArray(key: string): Promise<unknown[]> {
  try {
    const value = await AsyncStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savedToDashboardPlace(raw: unknown): DashboardPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  if (!id || !name) return null;

  const categoryBase =
    typeof record.categoryBase === "string"
      ? record.categoryBase
      : typeof record.category === "string"
        ? record.category
        : "Locale";

  return {
    id,
    name,
    category:
      typeof record.category === "string" ? record.category : categoryBase,
    categoryBase,
    detail: typeof record.detail === "string" ? record.detail : "",
    distance: typeof record.distance === "string" ? record.distance : "",
    distanceMeters:
      typeof record.distanceMeters === "number" ? record.distanceMeters : 0,
    latitude: typeof record.latitude === "number" ? record.latitude : 0,
    longitude: typeof record.longitude === "number" ? record.longitude : 0,
    categoryId: getCategoryId(categoryBase),
    isGuideMentioned: false,
    website: typeof record.website === "string" ? record.website : "",
    phone: typeof record.phone === "string" ? record.phone : "",
    openingHours:
      typeof record.openingHours === "string" ? record.openingHours : "",
    editorialAwards:
      typeof record.editorialAwards === "string" ? record.editorialAwards : "",
  };
}

async function readHomeSavedPlaces(): Promise<DashboardPlace[]> {
  const arrays = await Promise.all(HOME_SAVED_KEYS.map(readJsonArray));
  const uniquePlaces = new Map<string, DashboardPlace>();

  arrays.flat().forEach((raw) => {
    const place = savedToDashboardPlace(raw);
    if (place && !uniquePlaces.has(place.id)) {
      uniquePlaces.set(place.id, place);
    }
  });

  return Array.from(uniquePlaces.values());
}

function geoapifyPlaceToDashboardPlace(place: GeoapifyNearbyPlace): DashboardPlace {
  return {
    id: place.id,
    name: place.name,
    category: place.category,
    categoryBase: place.categoryBase,
    detail: place.detail,
    distance: place.distance,
    distanceMeters: place.distanceMeters,
    latitude: place.latitude,
    longitude: place.longitude,
    categoryId: getCategoryId(place.categoryBase),
    isGuideMentioned: false,
    website: place.website,
    phone: place.phone,
    openingHours: place.openingHours,
    editorialAwards: place.editorialAwards,
  };
}

function openMap(params?: Record<string, string>) {
  router.push({
    pathname: "/map",
    params,
  } as never);
}

function openPlaceDetail(place: DashboardPlace) {
  router.push({
    pathname: "/place-detail",
    params: {
      id: place.id,
      name: place.name,
      category: place.category,
      detail: place.detail,
      distance: place.distance,
      distanceMeters: String(place.distanceMeters),
      status: "none",
      website: place.website ?? "",
      phone: place.phone ?? "",
      openingHours: place.openingHours ?? "",
      editorialAwards: place.editorialAwards ?? "",
      latitude: String(place.latitude),
      longitude: String(place.longitude),
    },
  } as never);
}

export default function HomeScreen() {
  const { colors } = useMelloryTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCityLabel, setSelectedCityLabel] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [placeSuggestions, setPlaceSuggestions] = useState<DashboardPlace[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activeContext, setActiveContext] = useState<SearchContext | null>(null);
  const [categories, setCategories] =
    useState<DashboardCategory[]>(defaultCategories);
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [places, setPlaces] = useState<DashboardPlace[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<DashboardPlace[]>([]);
  const placesScrollRef = useRef<ScrollView>(null);
  const loadingPulse = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(0)).current;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const carouselOffsets = useRef<Record<CarouselKey, number>>({
    places: 0,
  });

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      readHomeSavedPlaces().then((nextSaved) => {
        if (isActive) setSavedPlaces(nextSaved);
      });

      return () => {
        isActive = false;
      };
    }, [])
  );

  const groupedSuggestions = useMemo(
    () => groupSuggestions(citySuggestions),
    [citySuggestions]
  );

  const zoneLists = useMemo(() => buildZoneLists(places), [places]);

  const activeTheme = useMemo(
    () => zoneLists.find((list) => list.id === activeThemeId) ?? null,
    [zoneLists, activeThemeId]
  );

  const filteredPlaces = useMemo(() => {
    if (activeTheme) return places.filter(activeTheme.match);
    if (selectedCategoryId === "all") return places;

    return places.filter((place) => place.categoryId === selectedCategoryId);
  }, [activeTheme, places, selectedCategoryId]);

  const hasDashboard = activeContext !== null;
  const hasPlaces = filteredPlaces.length > 0;
  const dashboardCityLabel = activeContext?.cityLabel ?? "";

  useEffect(() => {
    if (isLoading) {
      setCitySuggestions([]);
      setPlaceSuggestions([]);
      setShowSuggestions(false);
      setIsSuggesting(false);
      return;
    }

    const query = searchQuery.trim();

    if (query.length < 3 || query === selectedCityLabel) {
      setCitySuggestions([]);
      setPlaceSuggestions([]);
      setShowSuggestions(false);
      setIsSuggesting(false);
      return;
    }

    let isActive = true;

    const timeout = setTimeout(async () => {
      setIsSuggesting(true);

      const origin = activeContext
        ? {
            latitude: activeContext.latitude,
            longitude: activeContext.longitude,
          }
        : undefined;
      const [suggestions, placeResults] = await Promise.all([
        fetchCitySuggestions(query),
        fetchGeoapifyPlaceSuggestions(query, origin).catch(() => []),
      ]);
      const visiblePlaceResults = hasPreciseCitySuggestion(query, suggestions)
        ? []
        : placeResults;

      if (isActive) {
        setCitySuggestions(suggestions);
        setPlaceSuggestions(
          visiblePlaceResults.map(geoapifyPlaceToDashboardPlace)
        );
        setShowSuggestions(
          suggestions.length > 0 || visiblePlaceResults.length > 0
        );
        setIsSuggesting(false);
      }
    }, 350);

    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [activeContext, isLoading, searchQuery, selectedCityLabel]);

  useEffect(() => {
    if (!isLoading) {
      loadingPulse.stopAnimation();
      loadingPulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(loadingPulse, {
          toValue: 1,
          duration: 860,
          useNativeDriver: true,
        }),
        Animated.timing(loadingPulse, {
          toValue: 0,
          duration: 860,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [isLoading, loadingPulse]);

  useEffect(() => {
    if (isLoading) {
      contentFade.setValue(0);
      return;
    }

    Animated.timing(contentFade, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [contentFade, isLoading]);

  async function loadDashboard(context: SearchContext) {
    setIsLoading(true);
    setMessage("");
    setActiveContext(context);
    setSelectedCategoryId("all");
    setActiveThemeId(null);
    setPlaces([]);

    try {
      const dashboard = await fetchDashboardData(context);

      setCategories(
        dashboard.categories.length > 1 ? dashboard.categories : defaultCategories
      );
      setPlaces(dashboard.places);

      if (dashboard.places.length === 0) {
        setMessage("Ho trovato pochi dati qui. Prova una zona più centrale.");
      }
    } catch {
      setMessage(getFriendlyMessage());
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUsePosition() {
    setMessage("");
    setShowSuggestions(false);
    setCitySuggestions([]);
    setPlaceSuggestions([]);
    setIsSuggesting(false);
    Keyboard.dismiss();

    try {
      setIsLoading(true);

      const position = await getUserPosition();
      const label = await fetchLocationLabel(position.latitude, position.longitude);

      const context: SearchContext = {
        latitude: position.latitude,
        longitude: position.longitude,
        cityLabel: label.cityLabel,
        detailLabel: label.detailLabel,
        mode: "nearby",
      };

      setSearchQuery(label.cityLabel);
      setSelectedCityLabel(label.cityLabel);

      await loadDashboard(context);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Non riesco a usare la posizione in questo momento."
      );
      setIsLoading(false);
    }
  }

  async function handleSuggestionPress(suggestion: CitySuggestion) {
    const context: SearchContext = {
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      cityLabel: suggestion.cityLabel,
      detailLabel: suggestion.detailLabel,
      mode: "city",
    };

    setSearchQuery(suggestion.cityLabel);
    setSelectedCityLabel(suggestion.cityLabel);
    setCitySuggestions([]);
    setPlaceSuggestions([]);
    setShowSuggestions(false);
    setMessage("");
    Keyboard.dismiss();

    await loadDashboard(context);
  }

  function handlePlaceSuggestionPress(place: DashboardPlace) {
    const context: SearchContext = {
      latitude: place.latitude,
      longitude: place.longitude,
      cityLabel: place.name,
      detailLabel: place.detail,
      mode: "city",
    };
    const categoriesForPlace: DashboardCategory[] = [
      {
        id: "all",
        label: "Tutto",
        icon: "✦",
        count: 1,
      },
      {
        id: place.categoryId,
        label: getCategoryLabel(place.categoryBase),
        icon: getCategoryIcon(place.categoryBase),
        count: 1,
      },
    ];

    setSearchQuery(place.name);
    setSelectedCityLabel(place.name);
    setCitySuggestions([]);
    setPlaceSuggestions([]);
    setShowSuggestions(false);
    setMessage("");
    setActiveContext(context);
    setSelectedCategoryId("all");
    setCategories(categoriesForPlace);
    setPlaces([place]);
    Keyboard.dismiss();
    openPlaceDetail(place);
  }

  async function handleSubmitSearch() {
    const query = searchQuery.trim();

    if (query.length < 3) {
      setMessage("Scrivi almeno tre lettere oppure usa la tua posizione.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    setShowSuggestions(false);
    Keyboard.dismiss();

    const suggestions =
      citySuggestions.length > 0
        ? citySuggestions
        : await fetchCitySuggestions(query);

    const hasExactCity = hasPreciseCitySuggestion(query, suggestions);
    const directPlaces = hasExactCity
      ? []
      : placeSuggestions.length > 0
        ? placeSuggestions
        : (
            await fetchGeoapifyPlaceSuggestions(
              query,
              activeContext
                ? {
                    latitude: activeContext.latitude,
                    longitude: activeContext.longitude,
                  }
                : undefined
            ).catch(() => [])
          ).map(geoapifyPlaceToDashboardPlace);

    if (hasExactCity && suggestions[0]) {
      await handleSuggestionPress(suggestions[0]);
      return;
    }

    setIsLoading(false);

    if (directPlaces[0]) {
      handlePlaceSuggestionPress(directPlaces[0]);
      return;
    }

    if (suggestions[0]) {
      await handleSuggestionPress(suggestions[0]);
      return;
    }

    setMessage("Non ho trovato una zona precisa. Prova con un nome più specifico.");
  }

  function openContextSearch() {
    if (activeContext) {
      openMap({
        latitude: String(activeContext.latitude),
        longitude: String(activeContext.longitude),
        cityLabel: activeContext.cityLabel,
        detailLabel: activeContext.detailLabel,
      });
      return;
    }

    openMap();
  }

  function renderSuggestionGroup(title: string, items: CitySuggestion[]) {
    if (items.length === 0) return null;

    return (
      <View style={styles.suggestionGroup}>
        <Text style={styles.suggestionGroupTitle}>{title}</Text>

        {items.map((item) => (
          <PressableScale
            key={item.id}
            style={styles.suggestionItem}
            onPress={() => handleSuggestionPress(item)}
          >
            <View style={styles.suggestionDot} />

            <View style={styles.suggestionTextBlock}>
              <Text style={styles.suggestionTitle}>{item.label}</Text>
              <Text numberOfLines={1} style={styles.suggestionDetail}>
                {item.detail}
              </Text>
            </View>
          </PressableScale>
        ))}
      </View>
    );
  }

  function renderPlaceSuggestionGroup(items: DashboardPlace[]) {
    if (items.length === 0) return null;

    return (
      <View style={styles.suggestionGroup}>
        <Text style={styles.suggestionGroupTitle}>Locali</Text>

        {items.slice(0, 8).map((item) => (
          <PressableScale
            key={item.id}
            style={styles.suggestionItem}
            onPress={() => handlePlaceSuggestionPress(item)}
          >
            <View style={styles.suggestionDot} />

            <View style={styles.suggestionTextBlock}>
              <Text numberOfLines={1} style={styles.suggestionTitle}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={styles.suggestionDetail}>
                {item.detail
                  ? `${item.category} - ${item.detail}`
                  : item.category}
              </Text>
            </View>
          </PressableScale>
        ))}
      </View>
    );
  }

  function renderPlaceCard(place: DashboardPlace) {
    return (
      <PressableScale
        key={place.id}
        style={styles.placeCard}
        onPress={() => openPlaceDetail(place)}
      >
        <View style={styles.placeTop}>
          <View style={styles.placeInitial}>
            <Text style={styles.placeInitialText}>
              {place.name.charAt(0).toUpperCase()}
            </Text>
          </View>

          <Text style={styles.placeDistance}>{place.distance}</Text>
        </View>

        <Text numberOfLines={2} style={styles.placeName}>
          {place.name}
        </Text>

        <Text numberOfLines={1} style={styles.placeCategory}>
          {place.category}
        </Text>

        <Text numberOfLines={2} style={styles.placeDetail}>
          {place.detail}
        </Text>

        <View style={styles.placeFooter}>
          <Text style={styles.placeFooterText}>Apri scheda</Text>
        </View>
      </PressableScale>
    );
  }

  function getCarouselRef(_key: CarouselKey) {
    return placesScrollRef;
  }

  function scrollCarousel(key: CarouselKey, direction: "left" | "right") {
    const currentOffset = carouselOffsets.current[key];
    const delta = direction === "left" ? -CAROUSEL_STEP[key] : CAROUSEL_STEP[key];
    const nextOffset = Math.max(0, currentOffset + delta);

    carouselOffsets.current[key] = nextOffset;
    getCarouselRef(key).current?.scrollTo({
      x: nextOffset,
      animated: true,
    });
  }

  function handleCarouselScroll(key: CarouselKey) {
    return (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      carouselOffsets.current[key] = event.nativeEvent.contentOffset.x;
    };
  }

  function renderCarouselControls(key: CarouselKey) {
    return (
      <View style={styles.carouselControls}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Scorri a sinistra"
          style={styles.carouselButton}
          onPress={() => scrollCarousel(key, "left")}
        >
          <Text style={styles.carouselButtonText}>‹</Text>
        </PressableScale>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Scorri a destra"
          style={styles.carouselButton}
          onPress={() => scrollCarousel(key, "right")}
        >
          <Text style={styles.carouselButtonText}>›</Text>
        </PressableScale>
      </View>
    );
  }

  const loadingScale = loadingPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.05],
  });
  const loadingOpacity = loadingPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.58, 1],
  });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      directionalLockEnabled
    >
      <View style={styles.topRule} />

      <View style={styles.header}>
        <View style={styles.brandBlock}>
          <Text style={styles.logo}>Mellory</Text>
          <View style={styles.brandUnderline} />
          <Text style={styles.brandSubtitle}>
            La tua guida personale dei posti in cui sei stato bene.
          </Text>
        </View>

        <PressableScale
          style={styles.settingsButton}
          onPress={() => router.push("/settings" as never)}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </PressableScale>
      </View>

      <View style={styles.hero}>
        <Text style={styles.overline}>
          GUIDA GASTRONOMICA · EDIZIONE PERSONALE
        </Text>

        <Text style={styles.headline}>
          Trova sempre{"\n"}il posto{" "}
          <Text style={styles.headlineAccent}>giusto</Text>.
        </Text>
      </View>

      <View style={styles.searchBlock}>
        <View style={styles.searchBox}>
          <View style={styles.searchLens}>
            <View style={styles.searchLensCircle} />
            <View style={styles.searchLensHandle} />
          </View>

          <TextInput
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setMessage("");

              if (text.trim() !== selectedCityLabel) {
                setSelectedCityLabel("");
              }
            }}
            placeholder="Cerca località o locale"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="words"
            onFocus={() => {
              if (
                (citySuggestions.length > 0 || placeSuggestions.length > 0) &&
                searchQuery.trim() !== selectedCityLabel
              ) {
                setShowSuggestions(true);
              }
            }}
            onSubmitEditing={handleSubmitSearch}
            returnKeyType="search"
          />

          {isSuggesting && !isLoading ? (
            <ActivityIndicator color={colors.pink} />
          ) : null}

          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Usa la mia posizione"
            style={[styles.positionButton, isLoading && styles.disabled]}
            onPress={handleUsePosition}
            disabled={isLoading}
          >
            <View style={styles.positionIcon}>
              <View
                style={[
                  styles.positionDot,
                  isLoading && styles.positionDotLoading,
                ]}
              />
            </View>
            <Text numberOfLines={1} style={styles.positionText}>
              {isLoading
                ? "Preparo"
                : hasDashboard
                  ? "Aggiorna"
                  : "Mia posizione"}
            </Text>
          </PressableScale>
        </View>

        {showSuggestions && (
          <View style={styles.suggestionsBox}>
            {renderPlaceSuggestionGroup(placeSuggestions)}
            {renderSuggestionGroup("Località", groupedSuggestions.cities)}
            {renderSuggestionGroup("Zone", groupedSuggestions.areas)}
          </View>
        )}

        {message.length > 0 && (
          <View style={styles.messageCard}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        )}
      </View>

      {savedPlaces.length > 0 && (
        <View style={styles.placesPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelKicker}>DALLA TUA GUIDA</Text>
            <Text style={styles.panelTitle}>I posti che hai scelto</Text>
            <Text style={styles.panelText}>
              La tua selezione personale, sempre a portata.
            </Text>
          </View>

          <ScrollView
            horizontal
            nestedScrollEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.placesRow}
          >
            {savedPlaces.map(renderPlaceCard)}
          </ScrollView>
        </View>
      )}

      {isLoading && (
        <View style={styles.loadingCard}>
          <View style={styles.loadingTopRow}>
            <Animated.View
              style={[
                styles.loadingMark,
                {
                  opacity: loadingOpacity,
                  transform: [{ scale: loadingScale }],
                },
              ]}
            >
              <View style={styles.loadingMarkRing} />
              <View style={styles.loadingMarkDot} />
            </Animated.View>

            <View style={styles.loadingCopy}>
              <Text style={styles.loadingTitle}>Preparo la selezione</Text>
              <Text style={styles.loadingText}>
                Sto scegliendo i locali migliori intorno alla tua zona.
              </Text>
            </View>
          </View>

          <View style={styles.loadingTrail}>
            <Animated.View
              style={[
                styles.loadingTrailGlow,
                {
                  opacity: loadingOpacity,
                },
              ]}
            />
          </View>
        </View>
      )}

      {!isLoading && (
        <Animated.View
          style={{
            opacity: contentFade,
            transform: [
              {
                translateY: contentFade.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          }}
        >
          <View style={styles.dashboardHeader}>
            <Text style={styles.overlineMuted}>
              {hasDashboard ? "DASHBOARD DI ZONA" : "SCORCIATOIE"}
            </Text>

            <Text style={styles.dashboardTitle}>
              {hasDashboard
                ? dashboardCityLabel
                : "Categorie essenziali, locali reali."}
            </Text>
          </View>

          <View style={styles.categoryPanel}>
            <ScrollView
              horizontal
              nestedScrollEnabled
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.categoryRow}
            >
              {categories.map((category) => {
                const isSelected = selectedCategoryId === category.id;

                return (
                  <PressableScale
                    key={category.id}
                    style={[
                      styles.categoryChip,
                      isSelected && styles.categoryChipSelected,
                    ]}
                    onPress={() => {
                      setSelectedCategoryId(category.id);
                      setActiveThemeId(null);
                    }}
                  >
                    <Text
                      style={[
                        styles.categoryIcon,
                        isSelected && styles.categoryIconSelected,
                      ]}
                    >
                      {category.icon}
                    </Text>

                    <Text
                      style={[
                        styles.categoryText,
                        isSelected && styles.categoryTextSelected,
                      ]}
                    >
                      {category.label}
                    </Text>

                    {category.count > 0 && (
                      <Text
                        style={[
                          styles.categoryCount,
                          isSelected && styles.categoryCountSelected,
                        ]}
                      >
                        {category.count}
                      </Text>
                    )}
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>

          {zoneLists.length > 0 && (
            <View style={styles.zoneSection}>
              <Text style={styles.zoneKicker}>RACCOLTE DI ZONA</Text>
              <Text style={styles.zoneHeading}>Liste pronte, dai dati reali</Text>
              <Text style={styles.zoneSubtitle}>
                Costruite al volo dai locali trovati qui intorno.
              </Text>

              <ScrollView
                horizontal
                nestedScrollEnabled
                directionalLockEnabled
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.zoneRow}
              >
                {zoneLists.map((list) => {
                  const isActive = activeThemeId === list.id;
                  const topPlace = list.places[0]?.name ?? "";

                  return (
                    <PressableScale
                      key={list.id}
                      style={[
                        styles.zoneCard,
                        isActive && styles.zoneCardActive,
                      ]}
                      onPress={() => {
                        setActiveThemeId((current) =>
                          current === list.id ? null : list.id
                        );
                        setSelectedCategoryId("all");
                      }}
                    >
                      <View style={styles.zoneCardTop}>
                        <View
                          style={[
                            styles.zoneIconWrap,
                            isActive && styles.zoneIconWrapActive,
                          ]}
                        >
                          <Text style={styles.zoneIcon}>{list.icon}</Text>
                        </View>

                        <Text
                          style={[
                            styles.zoneCount,
                            isActive && styles.zoneCountActive,
                          ]}
                        >
                          {list.count}
                        </Text>
                      </View>

                      <Text
                        numberOfLines={1}
                        style={[
                          styles.zoneTitle,
                          isActive && styles.zoneTitleActive,
                        ]}
                      >
                        {list.title}
                      </Text>

                      <Text
                        numberOfLines={1}
                        style={[
                          styles.zoneHint,
                          isActive && styles.zoneHintActive,
                        ]}
                      >
                        {list.hint}
                      </Text>

                      {topPlace ? (
                        <View style={styles.zoneFooter}>
                          <View
                            style={[
                              styles.zoneFooterDot,
                              isActive && styles.zoneFooterDotActive,
                            ]}
                          />
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.zonePreview,
                              isActive && styles.zonePreviewActive,
                            ]}
                          >
                            {topPlace}
                          </Text>
                        </View>
                      ) : null}
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {hasPlaces && (
            <View style={styles.placesPanel}>
              <View style={styles.panelHeader}>
                {renderCarouselControls("places")}

                <Text style={styles.panelKicker}>
                  {activeTheme ? "RACCOLTA DI ZONA" : "SELEZIONE REALE"}
                </Text>
                <Text style={styles.panelTitle}>
                  {activeTheme ? activeTheme.title : "Scorri i suggerimenti"}
                </Text>
                <Text style={styles.panelText}>
                  {activeTheme
                    ? activeTheme.hint
                    : "I locali cambiano in base alla categoria scelta."}
                </Text>
              </View>

              <ScrollView
                ref={placesScrollRef}
                horizontal
                nestedScrollEnabled
                directionalLockEnabled
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                onScroll={handleCarouselScroll("places")}
                scrollEventThrottle={16}
                contentContainerStyle={styles.placesRow}
              >
                {filteredPlaces.map(renderPlaceCard)}
              </ScrollView>
            </View>
          )}

        </Animated.View>
      )}

      <View style={styles.realSearchCard}>
        <Text style={styles.realSearchKicker}>RICERCA REALE</Text>
        <Text style={styles.realSearchTitle}>
          {hasDashboard ? "Vuoi filtrare meglio?" : "Trova posti veri, vicino a te."}
        </Text>
        <Text style={styles.realSearchText}>
          Apri la mappa per esplorare la zona, vedere i locali intorno a te e
          costruire la tua guida personale.
        </Text>

        <PressableScale
          style={styles.realSearchButton}
          onPress={openContextSearch}
        >
          <Text style={styles.realSearchButtonText}>Apri la mappa</Text>
        </PressableScale>
      </View>

      <View style={styles.myMelloryCard}>
        <Text style={styles.cardKicker}>MY MELLORY</Text>

        <Text style={styles.cardTitle}>
          Il recensore sei tu.{"\n"}La guida è la tua.
        </Text>

        <Text style={styles.cardText}>
          Scopri locali reali, salvali con gusto e costruisci un archivio
          personale fatto di note, liste, ricordi e posti da ritrovare.
        </Text>
      </View>

      <View style={styles.collectionGrid}>
        {collections.map((item) => (
          <PressableScale
            key={item.title}
            style={styles.collectionCard}
            onPress={() =>
              router.push({
                pathname: "/lists",
                params: { focus: item.focus },
              } as never)
            }
          >
            <View style={styles.collectionIconWrap}>
              <Text style={styles.collectionIcon}>{getCollectionIcon(item)}</Text>
            </View>

            <View>
              <Text style={styles.collectionTitle}>{item.title}</Text>
              <Text style={styles.collectionText}>{item.text}</Text>
            </View>
          </PressableScale>
        ))}
      </View>

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

function createStyles(colors: MelloryThemeColors) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 0,
  },
  topRule: {
    height: 1,
    backgroundColor: colors.yellow,
    opacity: 0.95,
    marginBottom: 26,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 18,
    marginBottom: 30,
  },
  brandBlock: {
    flex: 1,
  },
  logo: {
    color: colors.cream,
    fontSize: 54,
    lineHeight: 58,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -1.6,
  },
  brandUnderline: {
    width: 60,
    height: 1,
    backgroundColor: colors.yellow,
    marginTop: 14,
    marginBottom: 14,
  },
  brandSubtitle: {
    color: colors.cream,
    opacity: 0.88,
    fontSize: 19,
    lineHeight: 25,
    fontFamily: "serif",
    fontStyle: "italic",
    fontWeight: "700",
    marginTop: 4,
    maxWidth: 320,
  },
  settingsButton: {
    width: 58,
    height: 58,
    borderRadius: 999,
    backgroundColor: "rgba(255, 248, 239, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.42)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  settingsIcon: {
    color: colors.cream,
    fontSize: 25,
    lineHeight: 28,
    fontWeight: "700",
  },
  hero: {
    marginBottom: 36,
  },
  overline: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 18,
  },
  headline: {
    color: colors.cream,
    fontSize: 50,
    lineHeight: 54,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  headlineAccent: {
    color: colors.pink,
    fontStyle: "italic",
  },
  searchBlock: {
    marginBottom: 30,
  },
  searchBox: {
    minHeight: 92,
    borderRadius: 999,
    backgroundColor: colors.paper,
    paddingLeft: 24,
    paddingRight: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  searchLens: {
    width: 26,
    height: 26,
    position: "relative",
  },
  searchLensCircle: {
    width: 17,
    height: 17,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.muted,
    position: "absolute",
    left: 2,
    top: 2,
  },
  searchLensHandle: {
    width: 10,
    height: 2,
    borderRadius: 999,
    backgroundColor: colors.muted,
    position: "absolute",
    right: 2,
    bottom: 5,
    transform: [{ rotate: "45deg" }],
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.paperText,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "600",
  },
  suggestionsBox: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.1)",
    marginBottom: 14,
    overflow: "hidden",
  },
  suggestionGroup: {
    paddingTop: 14,
  },
  suggestionGroupTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.4,
    paddingHorizontal: 18,
    marginBottom: 3,
    textTransform: "uppercase",
  },
  suggestionItem: {
    minHeight: 68,
    paddingHorizontal: 18,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 248, 239, 0.06)",
  },
  suggestionDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  suggestionTextBlock: {
    flex: 1,
  },
  suggestionTitle: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 3,
  },
  suggestionDetail: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  positionButton: {
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: colors.paperText,
    borderWidth: 1,
    borderColor: colors.softBorder,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexShrink: 0,
    maxWidth: 148,
  },
  positionIcon: {
    width: 21,
    height: 21,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  positionDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.paper,
  },
  positionDotLoading: {
    backgroundColor: colors.pink,
  },
  positionText: {
    color: colors.paper,
    fontSize: 13,
    fontWeight: "900",
    flexShrink: 1,
  },
  disabled: {
    opacity: 0.72,
  },
  messageCard: {
    backgroundColor: "rgba(255, 248, 239, 0.08)",
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.12)",
    padding: 16,
    marginTop: 13,
  },
  messageText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },
  loadingCard: {
    backgroundColor: colors.card,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 24,
    marginBottom: 18,
    gap: 18,
    overflow: "hidden",
  },
  loadingTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  loadingMark: {
    width: 58,
    height: 58,
    borderRadius: 999,
    backgroundColor: "rgba(216, 78, 127, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(226, 189, 53, 0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingMarkRing: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.yellow,
    opacity: 0.92,
  },
  loadingMarkDot: {
    position: "absolute",
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  loadingCopy: {
    flex: 1,
  },
  loadingTitle: {
    color: colors.cream,
    fontSize: 26,
    lineHeight: 31,
    fontFamily: "serif",
    fontWeight: "900",
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  loadingTrail: {
    height: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255, 248, 239, 0.08)",
    overflow: "hidden",
  },
  loadingTrailGlow: {
    width: "62%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  dashboardHeader: {
    marginBottom: 16,
  },
  overlineMuted: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 4,
    marginBottom: 12,
  },
  dashboardTitle: {
    color: colors.cream,
    fontSize: 30,
    lineHeight: 35,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  carouselControls: {
    position: "absolute",
    top: 0,
    right: 22,
    zIndex: 3,
    flexDirection: "row",
    gap: 8,
  },
  carouselButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  carouselButtonText: {
    color: colors.cream,
    fontSize: 30,
    lineHeight: 31,
    fontWeight: "900",
    marginTop: -2,
  },
  categoryPanel: {
    marginBottom: 18,
  },
  categoryRow: {
    gap: 10,
    paddingRight: 24,
    paddingLeft: 0,
  },
  categoryChip: {
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  categoryChipSelected: {
    backgroundColor: colors.paper,
    borderColor: colors.paper,
  },
  categoryIcon: {
    color: colors.pink,
    fontSize: 17,
    fontWeight: "900",
  },
  categoryIconSelected: {
    color: colors.pink,
  },
  categoryText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "900",
  },
  categoryTextSelected: {
    color: colors.paperText,
  },
  categoryCount: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
  },
  categoryCountSelected: {
    color: colors.paperText,
  },
  placesPanel: {
    backgroundColor: colors.card,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    paddingVertical: 22,
    paddingLeft: 22,
    marginBottom: 14,
  },
  panelHeader: {
    paddingRight: 22,
    marginBottom: 16,
    position: "relative",
  },
  panelKicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 12,
  },
  panelTitle: {
    color: colors.cream,
    fontSize: 30,
    lineHeight: 35,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 8,
  },
  panelText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  placesRow: {
    gap: 14,
    paddingRight: 24,
    paddingLeft: 0,
  },
  placeCard: {
    width: 240,
    minHeight: 238,
    borderRadius: 26,
    backgroundColor: colors.card2,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 18,
  },
  placeTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  placeInitial: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(216, 78, 127, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(216, 78, 127, 0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  placeInitialText: {
    color: colors.pink,
    fontSize: 22,
    fontFamily: "serif",
    fontWeight: "900",
  },
  placeDistance: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  placeName: {
    color: colors.cream,
    fontSize: 22,
    lineHeight: 26,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 8,
  },
  placeCategory: {
    color: colors.pink,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  placeDetail: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  placeFooter: {
    marginTop: "auto",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 248, 239, 0.08)",
    paddingTop: 12,
  },
  placeFooterText: {
    color: colors.cream,
    fontSize: 12,
    fontWeight: "900",
  },
  zoneSection: {
    marginBottom: 18,
  },
  zoneKicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 12,
  },
  zoneHeading: {
    color: colors.cream,
    fontSize: 27,
    lineHeight: 31,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  zoneSubtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  zoneRow: {
    gap: 12,
    paddingRight: 24,
    paddingLeft: 0,
  },
  zoneCard: {
    width: 196,
    minHeight: 162,
    borderRadius: 25,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 18,
  },
  zoneFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: "auto",
    paddingTop: 12,
  },
  zoneFooterDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  zoneFooterDotActive: {
    backgroundColor: colors.pink,
  },
  zonePreview: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  zonePreviewActive: {
    color: colors.paperText,
    opacity: 0.78,
  },
  zoneCardActive: {
    backgroundColor: colors.paper,
    borderColor: colors.paper,
  },
  zoneCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  zoneIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(216, 78, 127, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(216, 78, 127, 0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoneIconWrapActive: {
    backgroundColor: "rgba(216, 78, 127, 0.16)",
  },
  zoneIcon: {
    color: colors.pink,
    fontSize: 21,
    fontWeight: "900",
  },
  zoneCount: {
    color: colors.muted,
    fontSize: 22,
    fontFamily: "serif",
    fontWeight: "900",
  },
  zoneCountActive: {
    color: colors.paperText,
  },
  zoneTitle: {
    color: colors.cream,
    fontSize: 21,
    lineHeight: 25,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 5,
  },
  zoneTitleActive: {
    color: colors.paperText,
  },
  zoneHint: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  zoneHintActive: {
    color: colors.paperText,
    opacity: 0.7,
  },
  realSearchCard: {
    backgroundColor: colors.paper,
    borderRadius: 30,
    padding: 24,
    marginBottom: 14,
  },
  realSearchKicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 14,
  },
  realSearchTitle: {
    color: colors.paperText,
    fontSize: 31,
    lineHeight: 36,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  realSearchText: {
    color: colors.paperText,
    fontSize: 16,
    lineHeight: 25,
    marginBottom: 20,
  },
  realSearchButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.paperText,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 22,
  },
  realSearchButtonText: {
    color: colors.paper,
    fontSize: 15,
    fontWeight: "900",
  },
  myMelloryCard: {
    backgroundColor: colors.card,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 24,
    marginBottom: 14,
  },
  cardKicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 22,
  },
  cardTitle: {
    color: colors.cream,
    fontSize: 35,
    lineHeight: 39,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -0.9,
    marginBottom: 14,
  },
  cardText: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 25,
  },
  collectionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 14,
  },
  collectionCard: {
    flex: 1,
    minWidth: "47%",
    minHeight: 158,
    borderRadius: 25,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 18,
    justifyContent: "space-between",
  },
  collectionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(216, 78, 127, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(216, 78, 127, 0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  collectionIcon: {
    color: colors.pink,
    fontSize: 22,
    fontWeight: "900",
  },
  collectionTitle: {
    color: colors.cream,
    fontSize: 24,
    lineHeight: 28,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 7,
  },
  collectionText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  bottomSpace: {
    height: 118,
  },
  });
}
