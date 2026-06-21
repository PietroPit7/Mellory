import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

  if (cleanedQuery.length < 3) return [];

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
  const insets = useSafeAreaInsets();
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
  const loadingPulse = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(0)).current;
  const styles = useMemo(() => createStyles(colors), [colors]);

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
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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

  function renderPlaceRow(place: DashboardPlace) {
    return (
      <PressableScale
        key={place.id}
        style={styles.placeRow}
        onPress={() => openPlaceDetail(place)}
      >
        <View style={styles.placeAccentBar} />

        <View style={styles.placeAvatar}>
          <Text style={styles.placeAvatarText}>
            {place.name.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={styles.placeRowInfo}>
          <Text numberOfLines={1} style={styles.placeRowName}>
            {place.name}
          </Text>
          <Text numberOfLines={1} style={styles.placeRowSub}>
            {place.category}
            {place.distance ? ` · ${place.distance}` : ""}
          </Text>
        </View>

        <Text style={styles.placeRowChevron}>›</Text>
      </PressableScale>
    );
  }

  return (
    <View style={styles.screen}>
    <ScrollView
      style={styles.scrollFill}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      directionalLockEnabled
    >
      <View style={{ height: insets.top + 8 }} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brandBlock}>
          <Text style={styles.logo}>Mellory</Text>
          <View style={styles.brandUnderline} />
        </View>
      </View>

      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.overline}>
          GUIDA GASTRONOMICA · EDIZIONE PERSONALE
        </Text>
        <Text style={styles.headline}>
          Ricorda dove sei stato bene,{" "}
          <Text style={styles.headlineAccent}>sempre</Text>.
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>⌕</Text>

        <TextInput
          value={searchQuery}
          onChangeText={(text) => {
            setSearchQuery(text);
            setMessage("");
            if (text.trim() !== selectedCityLabel) {
              setSelectedCityLabel("");
            }
          }}
          placeholder="Cerca città o locale"
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
          <View style={styles.suggestingDot} />
        ) : null}

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Usa la mia posizione"
          style={[styles.locationButton, isLoading && styles.disabled]}
          onPress={handleUsePosition}
          disabled={isLoading}
        >
          <View style={styles.locationDot} />
        </PressableScale>
      </View>

      {/* Suggestions */}
      {showSuggestions && (
        <View style={styles.suggestionsBox}>
          {renderPlaceSuggestionGroup(placeSuggestions)}
          {renderSuggestionGroup("Località", groupedSuggestions.cities)}
          {renderSuggestionGroup("Zone", groupedSuggestions.areas)}
        </View>
      )}

      {message.length > 0 && (
        <Text style={styles.messageText}>{message}</Text>
      )}

      {/* Loading */}
      {isLoading && (
        <View style={styles.loadingRow}>
          <Animated.View style={[styles.loadingDot, {
            opacity: loadingPulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
            transform: [{ scale: loadingPulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.1] }) }],
          }]} />
          <Text style={styles.loadingText}>Preparo la selezione…</Text>
        </View>
      )}

      {/* Content */}
      {!isLoading && (
        <Animated.View style={{ opacity: contentFade }}>
          {hasDashboard && (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>{dashboardCityLabel}</Text>
                <Text style={styles.sectionCount}>
                  {filteredPlaces.length} posti
                </Text>
              </View>

              {/* Category filter pills */}
              <ScrollView
                horizontal
                nestedScrollEnabled
                directionalLockEnabled
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.pillRow}
                style={styles.pillScroll}
              >
                {categories.map((category) => {
                  const isSelected = selectedCategoryId === category.id;
                  return (
                    <PressableScale
                      key={category.id}
                      style={[
                        styles.filterPill,
                        isSelected && styles.filterPillSelected,
                      ]}
                      onPress={() => {
                        setSelectedCategoryId(category.id);
                        setActiveThemeId(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.filterPillIcon,
                          isSelected && styles.filterPillIconSelected,
                        ]}
                      >
                        {category.icon}
                      </Text>
                      <Text
                        style={[
                          styles.filterPillText,
                          isSelected && styles.filterPillTextSelected,
                        ]}
                      >
                        {category.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>

              {/* Zone pills */}
              {zoneLists.length > 0 && (
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  directionalLockEnabled
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.pillRow}
                  style={styles.pillScroll}
                >
                  {zoneLists.map((list) => {
                    const isActive = activeThemeId === list.id;
                    return (
                      <PressableScale
                        key={list.id}
                        style={[
                          styles.zonePill,
                          isActive && styles.zonePillActive,
                        ]}
                        onPress={() => {
                          setActiveThemeId((current) =>
                            current === list.id ? null : list.id
                          );
                          setSelectedCategoryId("all");
                        }}
                      >
                        <Text
                          style={[
                            styles.zonePillText,
                            isActive && styles.zonePillTextActive,
                          ]}
                        >
                          {list.title}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              )}

              {/* Place list */}
              {hasPlaces && (
                <View style={styles.placeList}>
                  {filteredPlaces.map(renderPlaceRow)}
                </View>
              )}

              {/* Map link */}
              <PressableScale style={styles.mapRow} onPress={openContextSearch}>
                <Text style={styles.mapRowText}>Vedi sulla mappa</Text>
                <Text style={styles.mapRowChevron}>›</Text>
              </PressableScale>
            </>
          )}

          {!hasDashboard && (
            <>
              {savedPlaces.length > 0 && (
                <>
                  <View style={styles.sectionRow}>
                    <Text style={styles.sectionTitle}>I tuoi posti</Text>
                    <Text style={styles.sectionCount}>
                      {savedPlaces.length}
                    </Text>
                  </View>

                  <View style={styles.placeList}>
                    {savedPlaces.slice(0, 8).map(renderPlaceRow)}
                  </View>
                </>
              )}

              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Le tue raccolte</Text>
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
                    <Text style={styles.collectionIcon}>
                      {getCollectionIcon(item)}
                    </Text>
                    <Text style={styles.collectionTitle}>{item.title}</Text>
                  </PressableScale>
                ))}
              </View>

              <PressableScale
                style={styles.mapButton}
                onPress={() => openMap()}
              >
                <Text style={styles.mapButtonText}>Esplora sulla mappa</Text>
              </PressableScale>
            </>
          )}
        </Animated.View>
      )}

      <View style={styles.bottomSpace} />
    </ScrollView>

    {hasDashboard && hasPlaces && (
      <PressableScale
        style={[styles.floatingMapPill, { bottom: insets.bottom + 68 }]}
        onPress={openContextSearch}
      >
        <Text style={styles.floatingMapPillIcon}>⊞</Text>
        <Text style={styles.floatingMapPillText}>Mappa</Text>
      </PressableScale>
    )}
    </View>
  );
}

function createStyles(colors: MelloryThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.black,
    },
    scrollFill: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 20,
    },
    floatingMapPill: {
      position: "absolute",
      alignSelf: "center",
      left: "50%",
      transform: [{ translateX: -54 }],
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      height: 42,
      paddingHorizontal: 20,
      borderRadius: 24,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
    },
    floatingMapPillIcon: {
      color: colors.pink,
      fontSize: 14,
      fontWeight: "600",
    },
    floatingMapPillText: {
      color: colors.cream,
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
    safeTop: {
      height: 16,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 18,
      marginBottom: 16,
    },
    brandBlock: {
      flex: 1,
    },
    logo: {
      color: colors.cream,
      fontSize: 46,
      lineHeight: 50,
      fontWeight: "900",
      letterSpacing: -1.4,
    },
    brandUnderline: {
      width: 36,
      height: 2.5,
      borderRadius: 999,
      backgroundColor: colors.pink,
      marginTop: 14,
      marginBottom: 14,
    },
    hero: {
      marginBottom: 32,
    },
    overline: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 2,
      marginBottom: 12,
      textTransform: "uppercase",
    },
    headline: {
      color: colors.cream,
      fontSize: 34,
      lineHeight: 39,
      fontWeight: "900",
      letterSpacing: -1.5,
    },
    headlineAccent: {
      color: colors.pink,
    },
    searchBox: {
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      paddingLeft: 18,
      paddingRight: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 14,
    },
    searchIcon: {
      color: colors.textMuted,
      fontSize: 22,
      lineHeight: 24,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      color: colors.cream,
      fontSize: 16,
      fontWeight: "500",
    },
    locationButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.pink,
      alignItems: "center",
      justifyContent: "center",
    },
    locationDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: "#fff",
    },
    disabled: {
      opacity: 0.6,
    },
    suggestionsBox: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      marginBottom: 14,
      overflow: "hidden",
    },
    suggestionGroup: {
      paddingTop: 12,
    },
    suggestionGroupTitle: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 2,
      paddingHorizontal: 18,
      marginBottom: 4,
      textTransform: "uppercase",
    },
    suggestionItem: {
      paddingHorizontal: 18,
      paddingVertical: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.softBorder,
    },
    suggestionDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.pink,
    },
    suggestionTextBlock: {
      flex: 1,
    },
    suggestionTitle: {
      color: colors.cream,
      fontSize: 15,
      fontWeight: "600",
      marginBottom: 2,
    },
    suggestionDetail: {
      color: colors.muted,
      fontSize: 13,
    },
    messageText: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 12,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 28,
    },
    loadingDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.pink,
    },
    suggestingDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.pink,
      opacity: 0.7,
    },
    loadingText: {
      color: colors.muted,
      fontSize: 15,
    },
    sectionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 12,
      marginTop: 24,
    },
    sectionTitle: {
      color: colors.cream,
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: -0.6,
    },
    sectionCount: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: "600",
    },
    pillScroll: {
      marginBottom: 12,
    },
    pillRow: {
      gap: 7,
      paddingRight: 20,
    },
    filterPill: {
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      paddingHorizontal: 14,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 5,
    },
    filterPillSelected: {
      backgroundColor: colors.cream,
      borderColor: colors.cream,
    },
    filterPillIcon: {
      color: colors.pink,
      fontSize: 12,
    },
    filterPillIconSelected: {
      color: colors.black,
    },
    filterPillText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "600",
    },
    filterPillTextSelected: {
      color: colors.black,
    },
    zonePill: {
      height: 30,
      borderRadius: 15,
      backgroundColor: "transparent",
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      paddingHorizontal: 13,
      justifyContent: "center",
      alignItems: "center",
    },
    zonePillActive: {
      backgroundColor: colors.pink,
      borderColor: colors.pink,
    },
    zonePillText: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: "600",
    },
    zonePillTextActive: {
      color: "#fff",
    },
    placeList: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      overflow: "hidden",
      marginBottom: 6,
    },
    placeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 0,
      paddingRight: 18,
      paddingVertical: 15,
      gap: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.softBorder,
    },
    placeAccentBar: {
      width: 3,
      alignSelf: "stretch",
      borderRadius: 99,
      backgroundColor: colors.pink,
      marginLeft: 16,
      flexShrink: 0,
    },
    placeAvatar: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.card2,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    placeAvatarText: {
      color: colors.pink,
      fontSize: 15,
      fontWeight: "800",
    },
    placeRowInfo: {
      flex: 1,
      minWidth: 0,
    },
    placeRowName: {
      color: colors.cream,
      fontSize: 15,
      fontWeight: "700",
      marginBottom: 2,
      letterSpacing: -0.1,
    },
    placeRowSub: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "500",
    },
    placeRowChevron: {
      color: colors.softBorder,
      fontSize: 20,
    },
    mapRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      paddingVertical: 16,
      paddingHorizontal: 18,
      marginTop: 6,
      marginBottom: 24,
    },
    mapRowText: {
      color: colors.cream,
      fontSize: 15,
      fontWeight: "700",
    },
    mapRowChevron: {
      color: colors.pink,
      fontSize: 20,
    },
    collectionGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginBottom: 14,
      marginTop: 4,
    },
    collectionCard: {
      flex: 1,
      minWidth: "47%",
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      padding: 18,
      gap: 10,
    },
    collectionIcon: {
      color: colors.pink,
      fontSize: 20,
    },
    collectionTitle: {
      color: colors.cream,
      fontSize: 15,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    mapButton: {
      backgroundColor: colors.cream,
      borderRadius: 16,
      paddingVertical: 17,
      alignItems: "center",
      marginBottom: 14,
    },
    mapButtonText: {
      color: colors.black,
      fontSize: 15,
      fontWeight: "800",
      letterSpacing: 0.2,
    },
    bottomSpace: {
      height: 110,
    },
  });
}
