import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MelloryMap from "@/components/MelloryMap";
import { PressableScale } from "@/components/pressable-scale";
import { melloryDarkColors } from "@/contexts/mellory-theme";
import {
  fetchCitySuggestions,
  fetchNearbyPlaces,
  fetchPlaceSuggestions,
  hasPreciseCitySuggestion,
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

const colors = melloryDarkColors;

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

  if (latitude === 0 && longitude === 0) {
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
  const [mode, setMode] = useState<"search" | "saved">("saved");
  const [mapRegion, setMapRegion] = useState<MapRegionCenter | null>(null);
  const [lastSearchCenter, setLastSearchCenter] =
    useState<MapRegionCenter | null>(null);

  const [previewPlace, setPreviewPlace] = useState<MapPlace | null>(null);
  const [showList, setShowList] = useState(false);
  const [overlayHeight, setOverlayHeight] = useState(0);

  const params = useLocalSearchParams();
  const consumedParamsRef = useRef(false);
  const previewAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;

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
    // Don't fire while the user is actively typing — wait until they've selected
    // a result (searchQuery === selectedSearchLabel) or cleared the input.
    if (searchQuery.trim() !== "" && searchQuery !== selectedSearchLabel) return false;

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
  }, [areaSearchProfile.radiusMeters, isMapLoading, lastSearchCenter, mapRegion, mode, previewPlace, searchQuery, selectedSearchLabel]);

  const handleMapRegionChange = useCallback((region: MapRegionCenter) => {
    setPreviewPlace(null);
    setMapRegion(region);
  }, []);

  const handlePoiPress = useCallback(
    (poi: { name: string; placeId: string; latitude: number; longitude: number }) => {
      const quickId = poi.placeId || `poi-${poi.latitude.toFixed(6)}-${poi.longitude.toFixed(6)}`;
      const quickPlace: MapPlace = {
        id: quickId,
        name: poi.name,
        category: "Locale",
        categoryBase: "Locale",
        detail: "",
        distance: "",
        distanceMeters: 0,
        website: "",
        phone: "",
        openingHours: "",
        editorialAwards: "",
        latitude: poi.latitude,
        longitude: poi.longitude,
        statuses: [],
        coverImageUri: "",
        note: "",
      };
      setPreviewPlace(quickPlace);

      void (async () => {
        try {
          const results = await fetchPlaceSuggestions(poi.name, {
            latitude: poi.latitude,
            longitude: poi.longitude,
          });
          const best = results[0] ? nearbyPlaceToMapPlace(results[0]) : null;
          if (!best) return;
          setPreviewPlace((current) => {
            if (!current || current.id !== quickId) return current;
            return mergeMapPlaces(quickPlace, { ...best, id: quickId, name: poi.name });
          });
        } catch {
          // silently ignore enrichment failures
        }
      })();
    },
    []
  );

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
    // Only animate when a new place appears, not when enrichment updates the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAnim, previewPlace?.id]);

  useEffect(() => {
    Animated.spring(listAnim, {
      toValue: showList ? 1 : 0,
      damping: 22,
      stiffness: 220,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [listAnim, showList]);

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

  const listTranslateY = listAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  return (
    <View style={styles.root}>
      {/* Full-screen map */}
      <MelloryMap
        markers={mapMarkers}
        center={mapCenter}
        onMarkerPress={handleMarkerPress}
        onRegionChange={handleMapRegionChange}
        onPoiPress={handlePoiPress}
        fullScreen
      />

      {/* Dots loader — centered on map while loading */}
      {isMapLoading ? (
        <View style={styles.mapDotsCenter} pointerEvents="none">
          <DotsLoader />
        </View>
      ) : null}

      {/* Dark shield sized to match the top overlay so controls don't bleed into map tiles */}
      <View
        style={[styles.topShield, { height: overlayHeight }]}
        pointerEvents="none"
      />

      {/* Top floating controls — minimal */}
      <View
        style={[styles.topOverlay, { paddingTop: insets.top + 10 }]}
        onLayout={(e) => setOverlayHeight(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        {/* Search row */}
        <View pointerEvents="auto" style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={searchQuery}
              onChangeText={(value) => {
                setPreviewPlace(null);
                setShowList(false);
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
              inputMode="search"
              clearButtonMode="while-editing"
              returnKeyType="search"
              onSubmitEditing={handleSearchPress}
              style={styles.searchInput}
            />
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Usa la mia posizione"
            style={[styles.locationButton, (isLocatingUser || isSearchingPlaces) && { opacity: 0.5 }]}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void searchPlacesAroundUser();
            }}
            disabled={isLocatingUser || isSearchingPlaces}
          >
            <View style={styles.locationDot} />
          </PressableScale>
          <PressableScale
            style={[styles.savedToggle, mode === "saved" && styles.savedToggleActive]}
            onPress={() => {
              void Haptics.selectionAsync();
              if (mode === "saved") {
                setPreviewPlace(null);
                setMode("search");
              } else {
                void refreshSavedPlaces();
              }
            }}
          >
            <Text style={[styles.savedToggleText, mode === "saved" && styles.savedToggleTextActive]}>♥</Text>
          </PressableScale>
        </View>

        {/* Suggestions dropdown */}
        {(placeSuggestions.length > 0 || citySuggestions.length > 0) && mode === "search" ? (
          <View pointerEvents="auto" style={styles.suggestionsBox}>
            {placeSuggestions.length > 0 ? (
              <View>
                <Text style={styles.suggestionGroupTitle}>Locali</Text>
                {placeSuggestions.slice(0, 5).map((place) => (
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
              <Text style={styles.suggestionGroupTitle}>Città</Text>
            ) : null}
            {citySuggestions.slice(0, 4).map((city) => (
              <PressableScale
                key={`${city.cityLabel}-${city.latitude}-${city.longitude}`}
                style={styles.suggestionRow}
                onPress={() => void searchPlacesAroundCity(city)}
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

        {errorMessage ? (
          <View pointerEvents="auto" style={styles.errorBubble}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Category pills */}
        <ScrollView
          pointerEvents="auto"
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentContainerStyle={styles.pillsContent}
          style={styles.pillsRow}
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

      {/* Preview card — floats above bottom controls when a place is selected */}
      {previewPlace ? (
        <Animated.View
          style={[
            styles.previewCard,
            { bottom: insets.bottom + 72 },
            {
              opacity: previewAnim,
              transform: [
                { translateY: previewAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                { scale: previewAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              ],
            },
          ]}
        >
          <View style={[styles.previewAccentBar, { backgroundColor: getCategoryColor(previewPlace.categoryBase) }]} />
          <View style={styles.previewContent}>
            <View style={styles.previewTop}>
              <View style={[styles.previewAvatar, { backgroundColor: `${getCategoryColor(previewPlace.categoryBase)}22` }]}>
                <Text style={[styles.previewAvatarText, { color: getCategoryColor(previewPlace.categoryBase) }]}>
                  {previewPlace.name.trim().charAt(0).toUpperCase() || "M"}
                </Text>
              </View>
              <View style={styles.previewInfo}>
                <Text style={styles.previewCategory}>{previewPlace.category}</Text>
                <Text numberOfLines={1} style={styles.previewName}>{previewPlace.name}</Text>
                {previewPlace.detail ? (
                  <Text numberOfLines={1} style={styles.previewMeta}>{previewPlace.detail}</Text>
                ) : null}
              </View>
              <PressableScale style={styles.previewCloseBtn} onPress={() => setPreviewPlace(null)}>
                <Text style={styles.previewCloseBtnText}>×</Text>
              </PressableScale>
            </View>
            <PressableScale
              style={styles.previewOpenBtn}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const place = previewPlace;
                setPreviewPlace(null);
                pushPlaceDetail(place);
              }}
            >
              <Text style={styles.previewOpenBtnText}>Apri scheda completa</Text>
              <Text style={styles.previewOpenBtnArrow}>›</Text>
            </PressableScale>
          </View>
        </Animated.View>
      ) : null}

      {/* Floating bottom bar: list pill + empty state */}
      <View
        style={[styles.floatingBottom, { bottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        {!isMapLoading && visiblePlaces.length === 0 && !previewPlace ? (
          <View pointerEvents="auto" style={styles.emptyPill}>
            <Text style={styles.emptyPillText}>
              {mode === "saved"
                ? "Nessun salvato su mappa."
                : "Cerca una città per iniziare."}
            </Text>
            {mode === "saved" ? (
              <PressableScale onPress={() => {
                void Haptics.selectionAsync();
                if (mapRegion) void searchPlacesAroundMapRegion();
                else setMode("search");
              }}>
                <Text style={styles.emptyPillAction}>Cerca qui ›</Text>
              </PressableScale>
            ) : (
              <PressableScale onPress={() => void refreshSavedPlaces()}>
                <Text style={styles.emptyPillAction}>I salvati ›</Text>
              </PressableScale>
            )}
          </View>
        ) : visiblePlaces.length > 0 && !previewPlace ? (
          <View pointerEvents="auto" style={styles.bottomPillsRow}>
            <PressableScale
              style={styles.listPill}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowList((v) => !v);
              }}
            >
              <Text style={styles.listPillIcon}>☰</Text>
              <Text style={styles.listPillText}>
                {visiblePlaces.length} {visiblePlaces.length === 1 ? "posto" : "posti"}
              </Text>
            </PressableScale>

            {mode === "saved" && mapRegion !== null && !showList ? (
              <PressableScale
                style={styles.searchHerePill}
                onPress={() => {
                  void Haptics.selectionAsync();
                  void searchPlacesAroundMapRegion();
                }}
              >
                <Text style={styles.searchHerePillText}>Cerca qui ›</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Results list sheet (slides up) */}
      {showList ? (
        <Animated.View
          style={[
            styles.listSheet,
            { paddingBottom: Math.max(insets.bottom, 16) },
            { transform: [{ translateY: listTranslateY }] },
          ]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetKicker}>
                {mode === "saved" ? "SALVATI" : selectedCity ? selectedCity.cityLabel.toUpperCase() : "IN ZONA"}
              </Text>
              <Text style={styles.sheetTitle}>
                {mode === "saved" ? "I tuoi luoghi" : "Locali trovati"}
              </Text>
            </View>
            <PressableScale
              style={styles.sheetCloseBtn}
              onPress={() => {
                void Haptics.selectionAsync();
                setShowList(false);
              }}
            >
              <Text style={styles.sheetCloseBtnText}>×</Text>
            </PressableScale>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.sheetList}>
            {visiblePlaces.map((place) => {
              const catColor = getCategoryColor(place.categoryBase);
              const hasStatus = place.statuses.length > 0;
              const statusColor = hasStatus ? getStatusColor(place.statuses[0]) : null;
              return (
                <PressableScale
                  key={place.id}
                  style={styles.placeRow}
                  onPress={() => {
                    setShowList(false);
                    openPlaceDetail(place.id);
                  }}
                >
                  <View style={[styles.placeAccent, { backgroundColor: catColor }]} />
                  <View style={[styles.placeAvatar, { backgroundColor: `${catColor}18` }]}>
                    <Text style={[styles.placeAvatarText, { color: catColor }]}>
                      {place.name.trim().charAt(0).toUpperCase() || "M"}
                    </Text>
                  </View>
                  <View style={styles.placeInfo}>
                    <Text numberOfLines={1} style={styles.placeName}>{place.name}</Text>
                    <Text numberOfLines={1} style={styles.placeSub}>
                      {place.category}{place.distance ? ` · ${place.distance}` : ""}
                    </Text>
                  </View>
                  {hasStatus && statusColor ? (
                    <View style={[styles.statusPill, { backgroundColor: `${statusColor}1A` }]}>
                      <Text style={[styles.statusPillText, { color: statusColor }]}>
                        {getStatusLabel(place.statuses[0])}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.placeChevron}>›</Text>
                  )}
                </PressableScale>
              );
            })}
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },

  // Dots loading indicator
  mapDotsCenter: { position: "absolute", top: "42%", left: 0, right: 0, alignItems: "center", zIndex: 6, pointerEvents: "none" },

  // ── Top floating overlay ──────────────────────────────────────────────
  topShield: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9,
    backgroundColor: "rgba(7,6,4,0.60)",
  },
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 12, paddingBottom: 14, gap: 10 },

  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchBox: { flex: 1, height: 46, borderRadius: 23, backgroundColor: "rgba(23,19,15,0.90)", borderWidth: 1, borderColor: "rgba(255,248,239,0.12)", paddingLeft: 14, paddingRight: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  searchIcon: { color: colors.textMuted, fontSize: 18 },
  searchInput: { flex: 1, color: colors.cream, fontSize: 15, fontWeight: "500" },
  locationButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.pink, alignItems: "center", justifyContent: "center" },
  locationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  savedToggle: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(23,19,15,0.90)", borderWidth: 1, borderColor: "rgba(255,248,239,0.12)", alignItems: "center", justifyContent: "center" },
  savedToggleActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  savedToggleText: { color: colors.muted, fontSize: 18, lineHeight: 22 },
  savedToggleTextActive: { color: "#fff" },

  suggestionsBox: { backgroundColor: "rgba(23,19,15,0.96)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,248,239,0.10)", overflow: "hidden", maxHeight: 280 },
  suggestionGroupTitle: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.4, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, textTransform: "uppercase" },
  suggestionRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.softBorder, flexDirection: "row", alignItems: "center", gap: 10 },
  suggestionTextBlock: { flex: 1, minWidth: 0 },
  suggestionTitle: { color: colors.cream, fontSize: 14, fontWeight: "600", marginBottom: 1 },
  suggestionSubtitle: { color: colors.muted, fontSize: 12 },
  suggestionArrow: { color: colors.muted, fontSize: 18 },

  errorBubble: { backgroundColor: "rgba(23,19,15,0.90)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: `${colors.orange}44` },
  errorText: { color: colors.orange, fontSize: 12, lineHeight: 18 },

  pillsRow: { flexGrow: 0 },
  pillsContent: { gap: 7, paddingRight: 4 },
  filterPill: { height: 32, borderRadius: 16, backgroundColor: "rgba(23,19,15,0.88)", borderWidth: 1, borderColor: "rgba(255,248,239,0.12)", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  filterPillSelected: { backgroundColor: colors.cream, borderColor: colors.cream },
  filterPillText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  filterPillTextSelected: { color: colors.black },

  // ── Floating preview card ─────────────────────────────────────────────
  previewCard: { position: "absolute", left: 12, right: 12, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.softBorder, overflow: "hidden", zIndex: 20 },
  previewAccentBar: { height: 3, width: "100%" },
  previewContent: { padding: 14 },
  previewTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  previewAvatar: { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  previewAvatarText: { fontSize: 20, fontWeight: "800" },
  previewInfo: { flex: 1, minWidth: 0, paddingTop: 2 },
  previewCategory: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 3 },
  previewName: { color: colors.cream, fontSize: 18, fontWeight: "800", letterSpacing: -0.4, marginBottom: 2 },
  previewMeta: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  previewOpenBtn: { height: 46, borderRadius: 12, backgroundColor: colors.pink, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  previewOpenBtnText: { color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  previewOpenBtnArrow: { color: "rgba(255,255,255,0.7)", fontSize: 20, lineHeight: 24, fontWeight: "400" },
  previewCloseBtn: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.card2, alignItems: "center", justifyContent: "center" },
  previewCloseBtnText: { color: colors.muted, fontSize: 18, lineHeight: 20 },

  // ── Floating bottom controls ──────────────────────────────────────────
  floatingBottom: { position: "absolute", left: 0, right: 0, zIndex: 20, alignItems: "center" },
  bottomPillsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  listPill: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 28, backgroundColor: "rgba(23,19,15,0.92)", borderWidth: 1, borderColor: "rgba(255,248,239,0.14)" },
  listPillIcon: { color: colors.cream, fontSize: 16 },
  listPillText: { color: colors.cream, fontSize: 14, fontWeight: "700", letterSpacing: -0.2 },
  searchHerePill: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 28, backgroundColor: colors.pink },
  searchHerePillText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  emptyPill: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 28, backgroundColor: "rgba(23,19,15,0.90)", borderWidth: 1, borderColor: "rgba(255,248,239,0.12)" },
  emptyPillText: { color: colors.muted, fontSize: 13 },
  emptyPillAction: { color: colors.pink, fontSize: 13, fontWeight: "700" },

  // ── Slide-up list sheet ───────────────────────────────────────────────
  listSheet: { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 30, backgroundColor: "rgba(17,13,9,0.98)", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderTopColor: "rgba(255,248,239,0.10)", maxHeight: "72%" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,248,239,0.18)", alignSelf: "center", marginTop: 12, marginBottom: 4 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14 },
  sheetKicker: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 2, marginBottom: 2 },
  sheetTitle: { color: colors.cream, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  sheetCloseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  sheetCloseBtnText: { color: colors.muted, fontSize: 20, lineHeight: 22 },
  sheetList: { flexGrow: 0 },

  // ── Place rows (inside sheet) ─────────────────────────────────────────
  placeRow: { flexDirection: "row", alignItems: "center", paddingLeft: 0, paddingRight: 16, paddingVertical: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.softBorder },
  placeAccent: { width: 3, alignSelf: "stretch", borderRadius: 99, marginLeft: 16, flexShrink: 0 },
  placeAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  placeAvatarText: { fontSize: 14, fontWeight: "800" },
  placeInfo: { flex: 1, minWidth: 0 },
  placeName: { color: colors.cream, fontSize: 15, fontWeight: "700", marginBottom: 2, letterSpacing: -0.2 },
  placeSub: { color: colors.muted, fontSize: 12 },
  placeChevron: { color: colors.muted, fontSize: 18 },
  statusPill: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
});
