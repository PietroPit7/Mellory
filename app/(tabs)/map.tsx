import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MelloryMap from "@/components/MelloryMap";
import { PressableScale } from "@/components/pressable-scale";
import { melloryThemeVars } from "@/contexts/mellory-theme";
import {
  fetchCitySuggestions,
  fetchNearbyPlaces,
  fetchPlaceSuggestions,
  hasPreciseCitySuggestion,
  hasGeoapifyApiKey,
} from "@/services/geoapify";

type PlaceStatus = "try" | "favorite" | "visited" | "retry";

type CitySuggestion = Awaited<ReturnType<typeof fetchCitySuggestions>>[number] & {
  zoom?: number;
};

type NearbyPlace = Awaited<ReturnType<typeof fetchNearbyPlaces>>[number];

type MapPlace = {
  id: string;
  name: string;
  category: string;
  categoryBase: string;
  detail: string;
  distance: string;
  distanceMeters: number;
  website: string;
  phone: string;
  openingHours: string;
  editorialAwards: string;
  latitude: number;
  longitude: number;
  statuses: PlaceStatus[];
  coverImageUri: string;
  note: string;
};

type MapRegionCenter = {
  latitude: number;
  longitude: number;
  zoom: number;
};

type StoredPlaceIndexItem = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  categoryBase?: unknown;
  detail?: unknown;
  distance?: unknown;
  distanceMeters?: unknown;
  website?: unknown;
  phone?: unknown;
  openingHours?: unknown;
  editorialAwards?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  statuses?: unknown;
  badges?: unknown;
  coverImageUri?: unknown;
  note?: unknown;
  savedAt?: unknown;
  updatedAt?: unknown;
};

const colors = melloryThemeVars;

const PLACES_INDEX_STORAGE_KEY = "mellory:places-index";
const STATUS_STORAGE_KEYS: Record<PlaceStatus, string> = {
  favorite: "mellory:favorites",
  try: "mellory:try",
  visited: "mellory:visited",
  retry: "mellory:retry",
};

const categories = [
  "Tutti",
  "Ristoranti",
  "Bar",
  "Caffè",
  "Pizzerie",
  "Gelaterie",
  "Pub",
];

const AREA_SEARCH_PROFILES = [
  { minZoom: 18, radiusMeters: 120, limit: 35 },
  { minZoom: 17, radiusMeters: 220, limit: 45 },
  { minZoom: 16, radiusMeters: 380, limit: 60 },
  { minZoom: 15, radiusMeters: 700, limit: 80 },
  { minZoom: 14, radiusMeters: 1200, limit: 100 },
  { minZoom: 13, radiusMeters: 2200, limit: 130 },
  { minZoom: 12, radiusMeters: 4200, limit: 160 },
  { minZoom: 0, radiusMeters: 6500, limit: 180 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlaceStatus(value: unknown): value is PlaceStatus {
  return (
    value === "try" ||
    value === "favorite" ||
    value === "visited" ||
    value === "retry"
  );
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function getNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getStatuses(value: unknown): PlaceStatus[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isPlaceStatus);
}

function getCategoryColor(categoryBase: string) {
  if (categoryBase === "Ristorante") return colors.pink;
  if (categoryBase === "Bar") return colors.yellow;
  if (categoryBase === "Caffè" || categoryBase === "Caffe") return colors.gold;
  if (categoryBase === "Pizzeria") return colors.orange;
  if (categoryBase === "Gelateria") return colors.blue;
  if (categoryBase === "Attrazione") return colors.green;
  return colors.pink;
}

function nearbyPlaceToMapPlace(place: NearbyPlace): MapPlace | null {
  if (
    typeof place.latitude !== "number" ||
    !Number.isFinite(place.latitude) ||
    typeof place.longitude !== "number" ||
    !Number.isFinite(place.longitude)
  ) {
    return null;
  }

  return {
    id: place.id,
    name: place.name,
    category: place.category,
    categoryBase: place.categoryBase,
    detail: place.detail,
    distance: place.distance,
    distanceMeters: place.distanceMeters,
    website: place.website || "",
    phone: place.phone || "",
    openingHours: place.openingHours || "",
    editorialAwards: place.editorialAwards || "",
    latitude: place.latitude,
    longitude: place.longitude,
    statuses: [],
    coverImageUri: "",
    note: "",
  };
}

function storedPlaceToMapPlace(value: unknown): MapPlace | null {
  if (!isRecord(value)) return null;

  const place = value as StoredPlaceIndexItem;

  const latitude = getNumber(place.latitude, Number.NaN);
  const longitude = getNumber(place.longitude, Number.NaN);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const id = getString(place.id);
  const name = getString(place.name);

  if (!id || !name) return null;

  return {
    id,
    name,
    category: getString(place.category, "Locale"),
    categoryBase: getString(
      place.categoryBase,
      getString(place.category, "Locale")
    ),
    detail: getString(place.detail, "Dettagli in arrivo"),
    distance: getString(place.distance, "Distanza da te"),
    distanceMeters: getNumber(place.distanceMeters, 0),
    website: getString(place.website),
    phone: getString(place.phone),
    openingHours: getString(place.openingHours),
    editorialAwards: getString(place.editorialAwards),
    latitude,
    longitude,
    statuses: getStatuses(place.statuses),
    coverImageUri: getString(place.coverImageUri),
    note: getString(place.note),
  };
}

function mergeMapPlaces(firstPlace: MapPlace, secondPlace: MapPlace): MapPlace {
  return {
    ...firstPlace,
    ...secondPlace,
    statuses: Array.from(
      new Set<PlaceStatus>([...firstPlace.statuses, ...secondPlace.statuses])
    ),
    coverImageUri: secondPlace.coverImageUri || firstPlace.coverImageUri,
    note: secondPlace.note || firstPlace.note,
  };
}

async function readStoredPlaces(storageKey: string) {
  try {
    const storedValue = await AsyncStorage.getItem(storageKey);

    if (!storedValue) return [];

    const parsedValue = JSON.parse(storedValue) as unknown;

    if (!Array.isArray(parsedValue)) return [];

    return parsedValue;
  } catch {
    return [];
  }
}

async function readStatusMapPlaces() {
  const entries = await Promise.all(
    (Object.keys(STATUS_STORAGE_KEYS) as PlaceStatus[]).map(async (status) => {
      const storedPlaces = await readStoredPlaces(STATUS_STORAGE_KEYS[status]);
      return { status, storedPlaces };
    })
  );

  const mergedPlaces = new Map<string, MapPlace>();

  entries.forEach(({ status, storedPlaces }) => {
    storedPlaces.forEach((storedPlace) => {
      const place = storedPlaceToMapPlace({
        ...(isRecord(storedPlace) ? storedPlace : {}),
        statuses: [status],
      });

      if (!place) return;

      const currentPlace = mergedPlaces.get(place.id);
      mergedPlaces.set(
        place.id,
        currentPlace ? mergeMapPlaces(currentPlace, place) : place
      );
    });
  });

  return Array.from(mergedPlaces.values());
}

async function readSavedMapPlaces() {
  try {
    const [storedIndexPlaces, statusPlaces] = await Promise.all([
      readStoredPlaces(PLACES_INDEX_STORAGE_KEY),
      readStatusMapPlaces(),
    ]);

    const indexPlaces = storedIndexPlaces
      .map(storedPlaceToMapPlace)
      .filter((place): place is MapPlace => Boolean(place));

    const mergedPlaces = new Map<string, MapPlace>();

    indexPlaces.forEach((place) => {
      mergedPlaces.set(place.id, place);
    });

    statusPlaces.forEach((place) => {
      const currentPlace = mergedPlaces.get(place.id);
      mergedPlaces.set(
        place.id,
        currentPlace ? mergeMapPlaces(currentPlace, place) : place
      );
    });

    return Array.from(mergedPlaces.values()).sort(
      (firstPlace, secondPlace) =>
        firstPlace.distanceMeters - secondPlace.distanceMeters
    );
  } catch {
    return [];
  }
}

function matchesCategory(place: MapPlace, selectedCategory: string) {
  if (selectedCategory === "Tutti") return true;

  if (selectedCategory === "Ristoranti") {
    return place.categoryBase === "Ristorante";
  }

  if (selectedCategory === "Bar") {
    return place.categoryBase === "Bar";
  }

  if (selectedCategory === "Caffè") {
    return place.categoryBase === "Caffè" || place.categoryBase === "Caffe";
  }

  if (selectedCategory === "Pizzerie") {
    return place.categoryBase === "Pizzeria";
  }

  if (selectedCategory === "Gelaterie") {
    return place.categoryBase === "Gelateria";
  }

  if (selectedCategory === "Pub") {
    return place.categoryBase === "Pub";
  }

  return true;
}

function getPlaceSignals(place: MapPlace) {
  const signals: string[] = [];

  if (place.openingHours.trim()) signals.push("Orari");
  if (place.phone.trim()) signals.push("Telefono");
  if (place.website.trim()) signals.push("Sito");

  return signals.slice(0, 3);
}

function getAreaSearchProfile(zoom: number) {
  return (
    AREA_SEARCH_PROFILES.find((profile) => zoom >= profile.minZoom) ??
    AREA_SEARCH_PROFILES[AREA_SEARCH_PROFILES.length - 1]
  );
}

function getStatusLabel(status: PlaceStatus) {
  if (status === "favorite") return "Preferito";
  if (status === "try") return "Da provare";
  if (status === "visited") return "Visitato";
  if (status === "retry") return "Da rivalutare";
  return status;
}

function getStatusColor(status: PlaceStatus) {
  if (status === "favorite") return colors.pink;
  if (status === "try") return colors.yellow;
  if (status === "visited") return colors.green;
  if (status === "retry") return colors.orange;
  return colors.muted;
}

function getDistanceMeters(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number
) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((secondLatitude - firstLatitude) * Math.PI) / 180;
  const longitudeDelta = ((secondLongitude - firstLongitude) * Math.PI) / 180;
  const firstLatitudeRadians = (firstLatitude * Math.PI) / 180;
  const secondLatitudeRadians = (secondLatitude * Math.PI) / 180;

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusMeters * c);
}

function DotsLoader() {
  const dot1 = useRef(new Animated.Value(0.2)).current;
  const dot2 = useRef(new Animated.Value(0.2)).current;
  const dot3 = useRef(new Animated.Value(0.2)).current;
  const dot4 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const all = [dot1, dot2, dot3, dot4];
    const anims = all.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(dot, { toValue: 1, duration: 230, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.2, duration: 300, useNativeDriver: true }),
          Animated.delay(Math.max(0, (3 - i) * 140) + 60),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dot1, dot2, dot3, dot4]);

  return (
    <View style={dotsStyles.row}>
      {([dot1, dot2, dot3, dot4] as Animated.Value[]).map((dot, i) => (
        <Animated.View key={i} style={[dotsStyles.dot, { opacity: dot }]} />
      ))}
    </View>
  );
}

const dotsStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: "rgba(7,6,4,0.84)",
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.cream,
  },
});

function getMapCenter(places: MapPlace[], selectedCity: CitySuggestion | null) {
  if (selectedCity) {
    return {
      latitude: selectedCity.latitude,
      longitude: selectedCity.longitude,
      zoom: selectedCity.zoom ?? 13,
    };
  }

  if (places.length === 0) {
    return {
      latitude: 41.9028,
      longitude: 12.4964,
      zoom: 5,
    };
  }

  const latitude =
    places.reduce((sum, place) => sum + place.latitude, 0) / places.length;

  const longitude =
    places.reduce((sum, place) => sum + place.longitude, 0) / places.length;

  return {
    latitude,
    longitude,
    zoom: places.length === 1 ? 15 : 12,
  };
}

function getUserLocationSuggestion(
  latitude: number,
  longitude: number
): CitySuggestion {
  return {
    id: `user-location-${latitude.toFixed(5)}-${longitude.toFixed(5)}`,
    label: "La tua posizione",
    detail: "Locali vicini a te",
    latitude,
    longitude,
    cityLabel: "La tua posizione",
    detailLabel: "Locali vicini a te",
    kind: "area",
    zoom: 13,
  };
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [placeSuggestions, setPlaceSuggestions] = useState<MapPlace[]>([]);
  const [selectedSearchLabel, setSelectedSearchLabel] = useState("");
  const [selectedCity, setSelectedCity] = useState<CitySuggestion | null>(null);
  const [searchedPlaces, setSearchedPlaces] = useState<MapPlace[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<MapPlace[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("Tutti");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [mode, setMode] = useState<"search" | "saved">("search");
  const [mapRegion, setMapRegion] = useState<MapRegionCenter | null>(null);
  const [lastSearchCenter, setLastSearchCenter] =
    useState<MapRegionCenter | null>(null);

  const [previewPlace, setPreviewPlace] = useState<MapPlace | null>(null);

  const params = useLocalSearchParams();
  const consumedParamsRef = useRef(false);
  const previewAnim = useRef(new Animated.Value(0)).current;

  const sourcePlaces = mode === "saved" ? savedPlaces : searchedPlaces;

  const visiblePlaces = useMemo(
    () => sourcePlaces.filter((place) => matchesCategory(place, selectedCategory)),
    [sourcePlaces, selectedCategory]
  );

  const mapCenter = useMemo(
    () => getMapCenter(visiblePlaces, mode === "search" ? selectedCity : null),
    [visiblePlaces, selectedCity, mode]
  );

  const mapMarkers = useMemo(
    () =>
      visiblePlaces.map((place) => ({
        id: place.id,
        name: place.name,
        category: place.category,
        detail: place.detail,
        latitude: place.latitude,
        longitude: place.longitude,
        color: getCategoryColor(place.categoryBase),
      })),
    [visiblePlaces]
  );
  const areaSearchProfile = useMemo(
    () => getAreaSearchProfile(mapRegion?.zoom ?? mapCenter.zoom),
    [mapCenter.zoom, mapRegion?.zoom]
  );

  const pushPlaceDetail = useCallback(
    (place: MapPlace) => {
      router.push({
        pathname: "/place-detail",
        params: {
          id: place.id,
          name: place.name,
          category: place.category,
          detail: place.detail,
          distance: place.distance,
          distanceMeters: String(place.distanceMeters),
          status: place.statuses[0] || "none",
          website: place.website,
          phone: place.phone,
          openingHours: place.openingHours,
          editorialAwards: place.editorialAwards,
          latitude: String(place.latitude),
          longitude: String(place.longitude),
        },
      } as never);
    },
    []
  );

  // Clic sul marker: mostra una preview rapida, non apre subito la scheda.
  const handleMarkerPress = useCallback(
    (placeId: string) => {
      const place = visiblePlaces.find((item) => item.id === placeId);
      if (!place) return;
      setPreviewPlace(place);
    },
    [visiblePlaces]
  );

  const openPlaceDetail = useCallback(
    (placeId: string) => {
      const place = visiblePlaces.find((item) => item.id === placeId);

      if (!place) return;

      pushPlaceDetail(place);
    },
    [pushPlaceDetail, visiblePlaces]
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function loadSavedPlaces() {
        setPreviewPlace(null);
        setIsLoadingSaved(true);

        const nextSavedPlaces = await readSavedMapPlaces();

        if (!isActive) return;

        setSavedPlaces(nextSavedPlaces);
        setIsLoadingSaved(false);
      }

      loadSavedPlaces();

      return () => {
        isActive = false;
      };
    }, [])
  );

  useEffect(() => {
    let isActive = true;

    async function loadSuggestions() {
      const query = searchQuery.trim();

      if (query.length < 3 || query === selectedSearchLabel) {
        setCitySuggestions([]);
        setPlaceSuggestions([]);
        return;
      }

      if (!hasGeoapifyApiKey()) {
        setErrorMessage(
          "La ricerca non è disponibile in questo momento. Riprova tra poco."
        );
        return;
      }

      setIsSuggesting(true);

      try {
        const origin = selectedCity
          ? {
              latitude: selectedCity.latitude,
              longitude: selectedCity.longitude,
            }
          : lastSearchCenter ?? mapRegion ?? undefined;
        const [cityResults, placeResults] = await Promise.all([
          fetchCitySuggestions(query),
          fetchPlaceSuggestions(query, origin),
        ]);
        const visiblePlaceResults = hasPreciseCitySuggestion(query, cityResults)
          ? []
          : placeResults;

        if (!isActive) return;

        setCitySuggestions(cityResults);
        setPlaceSuggestions(
          visiblePlaceResults
            .map(nearbyPlaceToMapPlace)
            .filter((place): place is MapPlace => Boolean(place))
        );
      } catch {
        if (!isActive) return;

        setCitySuggestions([]);
        setPlaceSuggestions([]);
      } finally {
        if (isActive) {
          setIsSuggesting(false);
        }
      }
    }

    const timer = setTimeout(loadSuggestions, 280);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [lastSearchCenter, mapRegion, searchQuery, selectedCity, selectedSearchLabel]);

  async function searchPlacesAroundCity(city: CitySuggestion) {
    if (!hasGeoapifyApiKey()) {
      setErrorMessage(
        "La ricerca non è disponibile in questo momento. Riprova tra poco."
      );
      return;
    }

    setPreviewPlace(null);
    setMode("search");
    setSelectedCity(city);
    setSearchQuery(city.cityLabel);
    setSelectedSearchLabel(city.cityLabel);
    setCitySuggestions([]);
    setPlaceSuggestions([]);
    setErrorMessage("");
    setIsSearchingPlaces(true);
    Keyboard.dismiss();

    try {
      const places = await fetchNearbyPlaces(city.latitude, city.longitude);

      const nextPlaces = places
        .map(nearbyPlaceToMapPlace)
        .filter((place): place is MapPlace => Boolean(place));

      setSearchedPlaces(nextPlaces);
      setLastSearchCenter({
        latitude: city.latitude,
        longitude: city.longitude,
        zoom: 13,
      });

      if (nextPlaces.length === 0) {
        setErrorMessage(
          "Non ho trovato locali in questa zona. Prova una città più grande o un centro vicino."
        );
      }
    } catch {
      setErrorMessage(
        "Non riesco a preparare questa zona in questo momento. Riprova tra poco."
      );
    } finally {
      setIsSearchingPlaces(false);
    }
  }

  async function searchPlacesAroundUser() {
    if (!hasGeoapifyApiKey()) {
      setErrorMessage(
        "La ricerca non è disponibile in questo momento. Riprova tra poco."
      );
      return;
    }

    setPreviewPlace(null);
    setMode("search");
    setSelectedCategory("Tutti");
    setCitySuggestions([]);
    setPlaceSuggestions([]);
    setErrorMessage("");
    setIsLocatingUser(true);
    setIsSearchingPlaces(true);
    Keyboard.dismiss();

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        setErrorMessage(
          "Per mostrarti i locali vicino a te, autorizza la posizione dal dispositivo."
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;
      const userLocation = getUserLocationSuggestion(latitude, longitude);

      setSelectedCity(userLocation);
      setSearchQuery(userLocation.cityLabel);
      setSelectedSearchLabel(userLocation.cityLabel);

      const places = await fetchNearbyPlaces(latitude, longitude);
      const nextPlaces = places
        .map(nearbyPlaceToMapPlace)
        .filter((place): place is MapPlace => Boolean(place));

      setSearchedPlaces(nextPlaces);
      setLastSearchCenter({
        latitude,
        longitude,
        zoom: 13,
      });

      if (nextPlaces.length === 0) {
        setErrorMessage(
          "Non ho trovato locali vicino a te. Prova una città o riprova tra poco."
        );
      }
    } catch {
      setErrorMessage(
        "Non riesco a leggere la tua posizione adesso. Puoi cercare una città."
      );
    } finally {
      setIsLocatingUser(false);
      setIsSearchingPlaces(false);
    }
  }

  async function searchPlacesAroundMapRegion() {
    if (!mapRegion) return;

    if (!hasGeoapifyApiKey()) {
      setErrorMessage(
        "La ricerca non è disponibile in questo momento. Riprova tra poco."
      );
      return;
    }

    const areaSuggestion: CitySuggestion = {
      id: `map-area-${mapRegion.latitude.toFixed(5)}-${mapRegion.longitude.toFixed(
        5
      )}`,
      label: "Questa zona",
      detail: "Area selezionata",
      latitude: mapRegion.latitude,
      longitude: mapRegion.longitude,
      cityLabel: "Questa zona",
      detailLabel: "Area selezionata",
      kind: "area",
      zoom: mapRegion.zoom,
    };

    setPreviewPlace(null);
    setMode("search");
    setSelectedCity(areaSuggestion);
    setSearchQuery(areaSuggestion.cityLabel);
    setSelectedSearchLabel(areaSuggestion.cityLabel);
    setCitySuggestions([]);
    setPlaceSuggestions([]);
    setErrorMessage("");
    setIsSearchingPlaces(true);
    Keyboard.dismiss();

    try {
      const places = await fetchNearbyPlaces(
        mapRegion.latitude,
        mapRegion.longitude,
        {
          limit: areaSearchProfile.limit,
          radiusMeters: areaSearchProfile.radiusMeters,
        }
      );
      const nextPlaces = places
        .map(nearbyPlaceToMapPlace)
        .filter((place): place is MapPlace => Boolean(place));

      setSearchedPlaces(nextPlaces);
      setLastSearchCenter(mapRegion);

      if (nextPlaces.length === 0) {
        setErrorMessage("Non ho trovato locali in quest'area.");
      }
    } catch {
      setErrorMessage(
        "Non riesco a preparare questa zona in questo momento. Riprova tra poco."
      );
    } finally {
      setIsSearchingPlaces(false);
    }
  }

  function handlePlaceSuggestionPress(place: MapPlace) {
    const placeCenter: CitySuggestion = {
      id: `selected-place-${place.id}`,
      label: place.name,
      detail: place.detail,
      latitude: place.latitude,
      longitude: place.longitude,
      cityLabel: place.name,
      detailLabel: place.detail,
      kind: "area",
      zoom: 15,
    };

    setPreviewPlace(null);
    setMode("search");
    setSelectedCategory("Tutti");
    setSelectedCity(placeCenter);
    setSearchQuery(place.name);
    setSelectedSearchLabel(place.name);
    setCitySuggestions([]);
    setPlaceSuggestions([]);
    setErrorMessage("");
    setSearchedPlaces((currentPlaces) => [
      place,
      ...currentPlaces.filter((currentPlace) => currentPlace.id !== place.id),
    ]);
    setLastSearchCenter({
      latitude: place.latitude,
      longitude: place.longitude,
      zoom: 15,
    });
    Keyboard.dismiss();
    pushPlaceDetail(place);
  }

  async function handleSearchPress() {
    const query = searchQuery.trim();
    setPreviewPlace(null);

    if (query.length < 3) {
      setErrorMessage("Scrivi almeno tre lettere per cercare una città.");
      return;
    }

    if (
      citySuggestions.length > 0 &&
      hasPreciseCitySuggestion(query, citySuggestions)
    ) {
      await searchPlacesAroundCity(citySuggestions[0]);
      return;
    }

    if (placeSuggestions.length > 0) {
      handlePlaceSuggestionPress(placeSuggestions[0]);
      return;
    }

    if (citySuggestions.length > 0) {
      await searchPlacesAroundCity(citySuggestions[0]);
      return;
    }

    if (!hasGeoapifyApiKey()) {
      setErrorMessage(
        "La ricerca non è disponibile in questo momento. Riprova tra poco."
      );
      return;
    }

    setIsSuggesting(true);

    try {
      const origin = selectedCity
        ? {
            latitude: selectedCity.latitude,
            longitude: selectedCity.longitude,
          }
        : lastSearchCenter ?? mapRegion ?? undefined;
      const [cityResults, placeResults] = await Promise.all([
        fetchCitySuggestions(query),
        fetchPlaceSuggestions(query, origin),
      ]);
      const hasExactCity = hasPreciseCitySuggestion(query, cityResults);
      const visiblePlaceResults = hasExactCity ? [] : placeResults;
      const nextPlaces = visiblePlaceResults
        .map(nearbyPlaceToMapPlace)
        .filter((place): place is MapPlace => Boolean(place));

      if (cityResults.length === 0 && nextPlaces.length === 0) {
        setErrorMessage("Non ho trovato questa città. Prova con un nome più preciso.");
        return;
      }

      if (hasExactCity && cityResults[0]) {
        await searchPlacesAroundCity(cityResults[0]);
        return;
      }

      if (nextPlaces[0]) {
        handlePlaceSuggestionPress(nextPlaces[0]);
        return;
      }

      await searchPlacesAroundCity(cityResults[0]);
    } catch {
      setErrorMessage("Non riesco a cercare questa città adesso.");
    } finally {
      setIsSuggesting(false);
    }
  }

  async function refreshSavedPlaces() {
    setPreviewPlace(null);
    setMode("saved");
    setErrorMessage("");
    setIsLoadingSaved(true);

    const nextSavedPlaces = await readSavedMapPlaces();

    setSavedPlaces(nextSavedPlaces);
    setIsLoadingSaved(false);
  }

  const isMapLoading =
    isLocatingUser || isSearchingPlaces || (mode === "saved" && isLoadingSaved);

  const shouldShowAreaSearch = useMemo(() => {
    if (mode !== "search" || !mapRegion) return false;
    if (isMapLoading) return false;
    if (previewPlace) return false;

    // Nessuna ricerca ancora fatta: appena la mappa si muove, permetti di
    // cercare la zona inquadrata.
    if (!lastSearchCenter) return true;

    const lastAreaSearchProfile = getAreaSearchProfile(lastSearchCenter.zoom);

    if (lastAreaSearchProfile.radiusMeters !== areaSearchProfile.radiusMeters) {
      return true;
    }

    const movementThresholdMeters = Math.min(
      240,
      Math.max(25, areaSearchProfile.radiusMeters * 0.12)
    );

    // La soglia segue il raggio: area stretta = movimento minimo, area larga =
    // evita ricerche ridondanti per piccoli trascinamenti.
    return (
      getDistanceMeters(
        mapRegion.latitude,
        mapRegion.longitude,
        lastSearchCenter.latitude,
        lastSearchCenter.longitude
      ) > movementThresholdMeters
    );
  }, [areaSearchProfile.radiusMeters, isMapLoading, lastSearchCenter, mapRegion, mode, previewPlace]);

  const handleMapRegionChange = useCallback((region: MapRegionCenter) => {
    setPreviewPlace(null);
    setMapRegion(region);
  }, []);

  // Auto-search when map settles on a new area
  const searchAroundRegionRef = useRef<() => void>(() => {});
  searchAroundRegionRef.current = () => {
    if (!isMapLoading && mapRegion) void searchPlacesAroundMapRegion();
  };

  useEffect(() => {
    if (!shouldShowAreaSearch) return;
    const timer = setTimeout(() => searchAroundRegionRef.current(), 750);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowAreaSearch, mapRegion]);

  useEffect(() => {
    if (!previewPlace) return;

    previewAnim.setValue(0);
    Animated.spring(previewAnim, {
      toValue: 1,
      damping: 18,
      mass: 0.9,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [previewAnim, previewPlace]);

  // Arrivo dalla Home con una zona già scelta: la mappa la apre e la cerca.
  useEffect(() => {
    if (consumedParamsRef.current) return;

    const latitudeParam = Number(params.latitude);
    const longitudeParam = Number(params.longitude);
    const cityLabelParam =
      typeof params.cityLabel === "string" ? params.cityLabel.trim() : "";

    if (
      !Number.isFinite(latitudeParam) ||
      !Number.isFinite(longitudeParam) ||
      !cityLabelParam
    ) {
      return;
    }

    consumedParamsRef.current = true;

    const detailLabelParam =
      typeof params.detailLabel === "string" ? params.detailLabel : "";

    void searchPlacesAroundCity({
      id: `home-${latitudeParam.toFixed(5)}-${longitudeParam.toFixed(5)}`,
      label: cityLabelParam,
      detail: detailLabelParam,
      latitude: latitudeParam,
      longitude: longitudeParam,
      cityLabel: cityLabelParam,
      detailLabel: detailLabelParam,
      kind: "city",
    });
    // searchPlacesAroundCity è stabile (function declaration); eseguiamo una volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.latitude, params.longitude, params.cityLabel]);

  return (
    <View style={styles.root}>
      {/* Full-screen map */}
      <MelloryMap
        markers={mapMarkers}
        center={mapCenter}
        onMarkerPress={handleMarkerPress}
        onRegionChange={handleMapRegionChange}
        fullScreen
      />

      {/* Dots loader — centered on map while loading */}
      {isMapLoading ? (
        <View style={styles.mapDotsCenter} pointerEvents="none">
          <DotsLoader />
        </View>
      ) : null}

      {/* Top controls overlay */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <View pointerEvents="auto" style={styles.topCard}>
          {/* Search box */}
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={searchQuery}
              onChangeText={(value) => {
                setPreviewPlace(null);
                setSearchQuery(value);
                setMode("search");
                setErrorMessage("");
                if (value.trim() !== selectedSearchLabel) {
                  setSelectedSearchLabel("");
                }
              }}
              placeholder="Cerca città o locale"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={handleSearchPress}
              style={styles.searchInput}
            />
            {(isSuggesting || isSearchingPlaces) && !isLocatingUser ? (
              <ActivityIndicator color={colors.pink} size="small" />
            ) : null}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Usa la mia posizione"
              style={[styles.locationButton, (isLocatingUser || isSearchingPlaces) && { opacity: 0.6 }]}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                void searchPlacesAroundUser();
              }}
              disabled={isLocatingUser || isSearchingPlaces}
            >
              {isLocatingUser ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <View style={styles.locationDot} />
              )}
            </PressableScale>
          </View>

          {/* Mode toggle */}
          <View style={styles.modeRow}>
            <PressableScale
              style={[styles.modePill, mode === "search" && styles.modePillActive]}
              onPress={() => { setPreviewPlace(null); setMode("search"); }}
            >
              <Text style={[styles.modePillText, mode === "search" && styles.modePillTextActive]}>Ricerca</Text>
            </PressableScale>
            <PressableScale
              style={[styles.modePill, mode === "saved" && styles.modePillActive]}
              onPress={() => { void Haptics.selectionAsync(); void refreshSavedPlaces(); }}
            >
              <Text style={[styles.modePillText, mode === "saved" && styles.modePillTextActive]}>Salvati</Text>
            </PressableScale>
          </View>

          {/* Suggestions dropdown */}
          {(placeSuggestions.length > 0 || citySuggestions.length > 0) && mode === "search" ? (
            <View style={styles.suggestionsBox}>
              {placeSuggestions.length > 0 ? (
                <View>
                  <Text style={styles.suggestionGroupTitle}>Locali</Text>
                  {placeSuggestions.slice(0, 6).map((place) => (
                    <PressableScale
                      key={place.id}
                      style={styles.suggestionRow}
                      onPress={() => handlePlaceSuggestionPress(place)}
                    >
                      <View style={styles.suggestionTextBlock}>
                        <Text numberOfLines={1} style={styles.suggestionTitle}>{place.name}</Text>
                        <Text numberOfLines={1} style={styles.suggestionSubtitle}>
                          {place.detail ? `${place.category} · ${place.detail}` : place.category}
                        </Text>
                      </View>
                      <Text style={styles.suggestionArrow}>›</Text>
                    </PressableScale>
                  ))}
                </View>
              ) : null}
              {citySuggestions.length > 0 ? (
                <Text style={styles.suggestionGroupTitle}>Località</Text>
              ) : null}
              {citySuggestions.slice(0, 4).map((city) => (
                <PressableScale
                  key={`${city.cityLabel}-${city.latitude}-${city.longitude}`}
                  style={styles.suggestionRow}
                  onPress={() => searchPlacesAroundCity(city)}
                >
                  <View style={styles.suggestionTextBlock}>
                    <Text style={styles.suggestionTitle}>{city.cityLabel}</Text>
                    <Text style={styles.suggestionSubtitle}>Esplora questa zona</Text>
                  </View>
                  <Text style={styles.suggestionArrow}>›</Text>
                </PressableScale>
              ))}
            </View>
          ) : null}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          {/* Category pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillsContent}
          >
            {categories.map((category) => {
              const isActive = selectedCategory === category;
              return (
                <PressableScale
                  key={category}
                  style={[styles.filterPill, isActive && styles.filterPillSelected]}
                  onPress={() => { setPreviewPlace(null); setSelectedCategory(category); }}
                >
                  <Text style={[styles.filterPillText, isActive && styles.filterPillTextSelected]}>
                    {category}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* Bottom results panel */}
      <View style={[styles.bottomPanel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.panelHandle} />

        {previewPlace ? (
          <Animated.View
            style={[
              styles.previewRow,
              {
                opacity: previewAnim,
                transform: [{ translateY: previewAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
              },
            ]}
          >
            <View style={[styles.previewAvatar, { backgroundColor: `${getCategoryColor(previewPlace.categoryBase)}26` }]}>
              <Text style={[styles.previewAvatarText, { color: getCategoryColor(previewPlace.categoryBase) }]}>
                {previewPlace.name.trim().charAt(0).toUpperCase() || "M"}
              </Text>
            </View>
            <View style={styles.previewInfo}>
              <Text numberOfLines={1} style={styles.previewName}>{previewPlace.name}</Text>
              <Text numberOfLines={1} style={styles.previewMeta}>
                {previewPlace.detail
                  ? `${previewPlace.category} · ${previewPlace.detail}`
                  : previewPlace.category}
                {previewPlace.distance ? ` · ${previewPlace.distance}` : ""}
              </Text>
            </View>
            <PressableScale
              style={styles.previewOpenBtn}
              onPress={() => {
                const place = previewPlace;
                setPreviewPlace(null);
                pushPlaceDetail(place);
              }}
            >
              <Text style={styles.previewOpenBtnText}>Apri ›</Text>
            </PressableScale>
            <PressableScale style={styles.previewCloseBtn} onPress={() => setPreviewPlace(null)}>
              <Text style={styles.previewCloseBtnText}>×</Text>
            </PressableScale>
          </Animated.View>
        ) : visiblePlaces.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>
                {mode === "saved" ? "I tuoi luoghi" : selectedCity ? selectedCity.cityLabel : "In zona"}
              </Text>
              <Text style={styles.sectionCount}>
                {visiblePlaces.length} {visiblePlaces.length === 1 ? "posto" : "posti"}
              </Text>
            </View>
            <ScrollView style={styles.panelList} showsVerticalScrollIndicator={false}>
              {visiblePlaces.map((place) => (
                <PressableScale
                  key={place.id}
                  style={styles.placeRow}
                  onPress={() => openPlaceDetail(place.id)}
                >
                  <View style={[styles.placeAvatar, { backgroundColor: `${getCategoryColor(place.categoryBase)}18` }]}>
                    <Text style={[styles.placeAvatarText, { color: getCategoryColor(place.categoryBase) }]}>
                      {place.name.trim().charAt(0).toUpperCase() || "M"}
                    </Text>
                  </View>
                  <View style={styles.placeInfo}>
                    <Text numberOfLines={1} style={styles.placeName}>{place.name}</Text>
                    <Text numberOfLines={1} style={styles.placeSub}>
                      {place.category}{place.distance ? ` · ${place.distance}` : ""}
                      {place.statuses.length > 0 ? ` · ${getStatusLabel(place.statuses[0])}` : ""}
                    </Text>
                  </View>
                  <Text style={styles.placeChevron}>›</Text>
                </PressableScale>
              ))}
            </ScrollView>
          </>
        ) : !isMapLoading ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Cerca una città per iniziare.</Text>
            <PressableScale style={styles.emptyButton} onPress={() => void refreshSavedPlaces()}>
              <Text style={styles.emptyButtonText}>Mostra i salvati</Text>
            </PressableScale>
          </View>
        ) : (
          <View style={styles.panelLoading}>
            <ActivityIndicator color={colors.pink} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },

  // Dots loading indicator
  mapDotsCenter: { position: "absolute", top: "42%", left: 0, right: 0, alignItems: "center", zIndex: 6 },

  // Top floating controls
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 12 },
  topCard: { backgroundColor: "rgba(23,19,15,0.94)", borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 10 },
  searchBox: { height: 46, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingLeft: 14, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: 10 },
  searchIcon: { color: colors.textMuted, fontSize: 18 },
  searchInput: { flex: 1, color: colors.cream, fontSize: 15, fontWeight: "500" },
  locationButton: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.pink, alignItems: "center", justifyContent: "center" },
  locationDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  modeRow: { flexDirection: "row", gap: 7 },
  modePill: { height: 30, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  modePillActive: { backgroundColor: colors.cream, borderColor: colors.cream },
  modePillText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  modePillTextActive: { color: colors.black },

  suggestionsBox: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden", maxHeight: 260 },
  suggestionGroupTitle: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.4, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, textTransform: "uppercase" },
  suggestionRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.softBorder, flexDirection: "row", alignItems: "center", gap: 10 },
  suggestionTextBlock: { flex: 1, minWidth: 0 },
  suggestionTitle: { color: colors.cream, fontSize: 14, fontWeight: "600", marginBottom: 1 },
  suggestionSubtitle: { color: colors.muted, fontSize: 12 },
  suggestionArrow: { color: colors.muted, fontSize: 18 },
  errorText: { color: colors.orange, fontSize: 12, lineHeight: 18 },

  pillsContent: { gap: 7, paddingRight: 2 },
  filterPill: { height: 30, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  filterPillSelected: { backgroundColor: colors.cream, borderColor: colors.cream },
  filterPillText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  filterPillTextSelected: { color: colors.black },

  // Bottom sheet panel
  bottomPanel: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(23,19,15,0.96)", borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 0, zIndex: 10 },
  panelHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 10, marginBottom: 2 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { color: colors.cream, fontSize: 16, fontWeight: "700" },
  sectionCount: { color: colors.muted, fontSize: 13 },
  panelList: { maxHeight: 230 },
  placeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.softBorder },
  placeAvatar: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  placeAvatarText: { fontSize: 15, fontWeight: "700" },
  placeInfo: { flex: 1, minWidth: 0 },
  placeName: { color: colors.cream, fontSize: 15, fontWeight: "600", marginBottom: 2 },
  placeSub: { color: colors.muted, fontSize: 12 },
  placeChevron: { color: colors.muted, fontSize: 18 },

  previewRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  previewAvatar: { width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  previewAvatarText: { fontSize: 18, fontWeight: "700" },
  previewInfo: { flex: 1, minWidth: 0 },
  previewName: { color: colors.cream, fontSize: 16, fontWeight: "700", marginBottom: 3 },
  previewMeta: { color: colors.muted, fontSize: 13 },
  previewOpenBtn: { height: 36, borderRadius: 9, backgroundColor: colors.pink, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  previewOpenBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  previewCloseBtn: { width: 36, height: 36, borderRadius: 9, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  previewCloseBtnText: { color: colors.cream, fontSize: 20, lineHeight: 22 },

  emptyState: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  emptyTitle: { color: colors.muted, fontSize: 15, marginBottom: 14 },
  emptyButton: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 13, alignItems: "center" },
  emptyButtonText: { color: colors.cream, fontSize: 15, fontWeight: "600" },
  panelLoading: { paddingVertical: 20, alignItems: "center" },
});
