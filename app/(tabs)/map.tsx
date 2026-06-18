import AsyncStorage from "@react-native-async-storage/async-storage";
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

import MelloryMap from "@/components/MelloryMap";
import { PressableScale } from "@/components/pressable-scale";
import { melloryThemeVars } from "@/contexts/mellory-theme";
import {
  fetchCitySuggestions,
  fetchNearbyPlaces,
  fetchPlaceSuggestions,
  hasGeoapifyApiKey,
} from "@/services/geoapify";

type PlaceStatus = "try" | "favorite" | "visited" | "retry";

type CitySuggestion = Awaited<ReturnType<typeof fetchCitySuggestions>>[number];

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

function getMapCenter(places: MapPlace[], selectedCity: CitySuggestion | null) {
  if (selectedCity) {
    return {
      latitude: selectedCity.latitude,
      longitude: selectedCity.longitude,
      zoom: 13,
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
  };
}

export default function MapScreen() {
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

        if (!isActive) return;

        setCitySuggestions(cityResults);
        setPlaceSuggestions(
          placeResults
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
      detail: "Locali intorno alla mappa",
      latitude: mapRegion.latitude,
      longitude: mapRegion.longitude,
      cityLabel: "Questa zona",
      detailLabel: "Locali intorno alla mappa",
    };

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
        mapRegion.longitude
      );
      const nextPlaces = places
        .map(nearbyPlaceToMapPlace)
        .filter((place): place is MapPlace => Boolean(place));

      setSearchedPlaces(nextPlaces);
      setLastSearchCenter(mapRegion);

      if (nextPlaces.length === 0) {
        setErrorMessage("Non ho trovato locali qui. Sposta un po' la mappa.");
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
    };

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

    if (query.length < 3) {
      setErrorMessage("Scrivi almeno tre lettere per cercare una città.");
      return;
    }

    if (citySuggestions.length > 0) {
      await searchPlacesAroundCity(citySuggestions[0]);
      return;
    }

    if (placeSuggestions.length > 0) {
      handlePlaceSuggestionPress(placeSuggestions[0]);
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
      const nextPlaces = placeResults
        .map(nearbyPlaceToMapPlace)
        .filter((place): place is MapPlace => Boolean(place));

      if (cityResults.length === 0 && nextPlaces.length === 0) {
        setErrorMessage("Non ho trovato questa città. Prova con un nome più preciso.");
        return;
      }

      if (cityResults[0]) {
        await searchPlacesAroundCity(cityResults[0]);
        return;
      }

      handlePlaceSuggestionPress(nextPlaces[0]);
    } catch {
      setErrorMessage("Non riesco a cercare questa città adesso.");
    } finally {
      setIsSuggesting(false);
    }
  }

  async function refreshSavedPlaces() {
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

    // Nessuna ricerca ancora fatta: appena la mappa si muove, permetti di
    // cercare la zona inquadrata.
    if (!lastSearchCenter) return true;

    // Basta un piccolo spostamento perché compaia "Cerca in questa zona".
    return (
      getDistanceMeters(
        mapRegion.latitude,
        mapRegion.longitude,
        lastSearchCenter.latitude,
        lastSearchCenter.longitude
      ) > 40
    );
  }, [isMapLoading, lastSearchCenter, mapRegion, mode]);

  const handleMapRegionChange = useCallback((region: MapRegionCenter) => {
    setMapRegion(region);
  }, []);

  const areaSearchAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(areaSearchAnim, {
      toValue: shouldShowAreaSearch ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [areaSearchAnim, shouldShowAreaSearch]);

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
    });
    // searchPlacesAroundCity è stabile (function declaration); eseguiamo una volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.latitude, params.longitude, params.cityLabel]);

  return (
    <View style={styles.root}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.safeTop} />

        <View style={styles.hero}>
          <Text style={styles.kicker}>MAPPA</Text>

          <Text style={styles.title}>Esplora la città</Text>

          <Text style={styles.subtitle}>
            Scegli una città e lascia che Mellory prepari una selezione di
            luoghi intorno alla zona che vuoi scoprire.
          </Text>

          <View style={styles.searchBox}>
            <View style={styles.searchLens}>
              <View style={styles.searchLensCircle} />
              <View style={styles.searchLensHandle} />
            </View>

            <TextInput
              value={searchQuery}
              onChangeText={(value) => {
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
              <ActivityIndicator color={colors.pink} />
            ) : null}

            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Usa la mia posizione"
              style={[
                styles.positionButton,
                (isLocatingUser || isSearchingPlaces) &&
                  styles.positionButtonDisabled,
              ]}
              onPress={searchPlacesAroundUser}
              disabled={isLocatingUser || isSearchingPlaces}
            >
              <View style={styles.positionIcon}>
                <View
                  style={[
                    styles.positionDot,
                    isLocatingUser && styles.positionDotLoading,
                  ]}
                />
              </View>

              <Text numberOfLines={1} style={styles.positionText}>
                {isLocatingUser ? "Ti localizzo" : "Mia posizione"}
              </Text>
            </PressableScale>
          </View>

          {(placeSuggestions.length > 0 || citySuggestions.length > 0) &&
          mode === "search" ? (
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
                        <Text numberOfLines={1} style={styles.suggestionTitle}>
                          {place.name}
                        </Text>
                        <Text numberOfLines={1} style={styles.suggestionSubtitle}>
                          {place.detail
                            ? `${place.category} - ${place.detail}`
                            : place.category}
                        </Text>
                      </View>

                      <Text style={styles.suggestionArrow}>›</Text>
                    </PressableScale>
                  ))}
                </View>
              ) : null}

              {citySuggestions.length > 0 ? (
                <Text style={styles.suggestionGroupTitle}>Citta e zone</Text>
              ) : null}

              {citySuggestions.slice(0, 5).map((city) => (
                <PressableScale
                  key={`${city.cityLabel}-${city.latitude}-${city.longitude}`}
                  style={styles.suggestionRow}
                  onPress={() => searchPlacesAroundCity(city)}
                >
                  <View>
                    <Text style={styles.suggestionTitle}>{city.cityLabel}</Text>
                    <Text style={styles.suggestionSubtitle}>
                      Tocca per esplorare questa zona
                    </Text>
                  </View>

                  <Text style={styles.suggestionArrow}>›</Text>
                </PressableScale>
              ))}
            </View>
          ) : null}

          {errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : null}

          <View style={styles.modeRow}>
            <PressableScale
              style={[
                styles.modeButton,
                mode === "search" && styles.modeButtonActive,
              ]}
              onPress={() => setMode("search")}
            >
              <Text
                style={[
                  styles.modeButtonText,
                  mode === "search" && styles.modeButtonTextActive,
                ]}
              >
                Ricerca
              </Text>
            </PressableScale>

            <PressableScale
              style={[
                styles.modeButton,
                mode === "saved" && styles.modeButtonActive,
              ]}
              onPress={refreshSavedPlaces}
            >
              <Text
                style={[
                  styles.modeButtonText,
                  mode === "saved" && styles.modeButtonTextActive,
                ]}
              >
                Salvati
              </Text>
            </PressableScale>
          </View>
        </View>

        <View style={styles.categoryRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryContent}
          >
            {categories.map((category) => {
              const isActive = selectedCategory === category;

              return (
                <PressableScale
                  key={category}
                  style={[
                    styles.categoryChip,
                    isActive && styles.categoryChipActive,
                  ]}
                  onPress={() => setSelectedCategory(category)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      isActive && styles.categoryChipTextActive,
                    ]}
                  >
                    {category}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{visiblePlaces.length}</Text>
            <Text style={styles.statLabel}>
              {mode === "saved" ? "Luoghi salvati" : "Locali in zona"}
            </Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {selectedCity && mode === "search" ? "1" : "—"}
            </Text>
            <Text style={styles.statLabel}>Città scelta</Text>
          </View>
        </View>

        <View style={styles.mapCard}>
          <MelloryMap
            markers={mapMarkers}
            center={mapCenter}
            onMarkerPress={handleMarkerPress}
            onRegionChange={handleMapRegionChange}
          />

          {previewPlace ? (
            <View pointerEvents="box-none" style={styles.previewWrap}>
              <PressableScale
                style={styles.previewCard}
                onPress={() => {
                  const place = previewPlace;
                  setPreviewPlace(null);
                  pushPlaceDetail(place);
                }}
              >
                <View
                  style={[
                    styles.previewMark,
                    {
                      backgroundColor: `${getCategoryColor(
                        previewPlace.categoryBase
                      )}26`,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.previewMarkText,
                      { color: getCategoryColor(previewPlace.categoryBase) },
                    ]}
                  >
                    {previewPlace.name.trim().charAt(0).toUpperCase() || "M"}
                  </Text>
                </View>

                <View style={styles.previewBody}>
                  <Text numberOfLines={1} style={styles.previewName}>
                    {previewPlace.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.previewMeta}>
                    {previewPlace.detail
                      ? `${previewPlace.category} · ${previewPlace.detail}`
                      : previewPlace.category}
                  </Text>
                  <Text style={styles.previewCta}>Apri scheda ›</Text>
                </View>

                <PressableScale
                  style={styles.previewClose}
                  onPress={() => setPreviewPlace(null)}
                >
                  <Text style={styles.previewCloseText}>×</Text>
                </PressableScale>
              </PressableScale>
            </View>
          ) : null}

          <Animated.View
            pointerEvents={shouldShowAreaSearch ? "box-none" : "none"}
            style={[
              styles.searchAreaButtonWrap,
              {
                opacity: areaSearchAnim,
                transform: [
                  {
                    translateY: areaSearchAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-12, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <PressableScale
              style={styles.searchAreaButton}
              onPress={searchPlacesAroundMapRegion}
            >
              <View style={styles.searchAreaDot} />
              <Text style={styles.searchAreaButtonText}>
                Cerca in questa zona
              </Text>
            </PressableScale>
          </Animated.View>

          {isMapLoading ? (
            <View style={styles.mapLoadingOverlay}>
              <ActivityIndicator color={colors.yellow} />
              <Text style={styles.mapLoadingText}>
                {isLocatingUser
                  ? "Trovo la tua zona..."
                  : mode === "saved"
                    ? "Preparo i tuoi luoghi..."
                    : "Cerco locali..."}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.listHeader}>
          <View>
            <Text style={styles.sectionKicker}>
              {mode === "saved" ? "LOCALI SALVATI" : "LUOGHI IN ZONA"}
            </Text>

            <Text style={styles.sectionTitle}>
              {visiblePlaces.length > 0
                ? "Locali selezionati"
                : "Pronto quando vuoi"}
            </Text>
          </View>

          {mode === "saved" ? (
            <PressableScale style={styles.smallRefreshButton} onPress={refreshSavedPlaces}>
              <Text style={styles.smallRefreshButtonText}>Aggiorna</Text>
            </PressableScale>
          ) : null}
        </View>

        {visiblePlaces.length > 0 ? (
          <View style={styles.placeList}>
            {visiblePlaces.map((place) => (
              <PressableScale
                key={place.id}
                style={styles.placeCard}
                onPress={() => openPlaceDetail(place.id)}
              >
                <View style={styles.placeCardTop}>
                  <View
                    style={[
                      styles.placeInitial,
                      {
                        backgroundColor: `${getCategoryColor(place.categoryBase)}26`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.placeInitialText,
                        {
                          color: getCategoryColor(place.categoryBase),
                        },
                      ]}
                    >
                      {place.name.trim().charAt(0).toUpperCase() || "M"}
                    </Text>
                  </View>

                  <View style={styles.placeMain}>
                    <Text numberOfLines={1} style={styles.placeName}>
                      {place.name}
                    </Text>

                    <Text numberOfLines={1} style={styles.placeCategory}>
                      {place.category}
                    </Text>
                  </View>

                  <Text style={styles.placeArrow}>›</Text>
                </View>

                <Text numberOfLines={2} style={styles.placeDetail}>
                  {place.detail}
                </Text>

                <View style={styles.placeFooter}>
                  <Text style={styles.placeDistance}>{place.distance}</Text>

                  {place.statuses.length > 0 ? (
                    <View style={styles.statusRow}>
                      {place.statuses.slice(0, 2).map((status) => (
                        <View
                          key={status}
                          style={[
                            styles.statusChip,
                            { backgroundColor: `${getStatusColor(status)}26` },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusChipText,
                              { color: getStatusColor(status) },
                            ]}
                          >
                            {getStatusLabel(status)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </PressableScale>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Cerca una città per iniziare.</Text>
            <Text style={styles.emptyText}>
              Scrivi una città, scegli un suggerimento e Mellory preparerà i
              luoghi intorno alla zona scelta. Puoi anche partire dai tuoi
              salvati.
            </Text>

            <PressableScale style={styles.emptyButton} onPress={refreshSavedPlaces}>
              <Text style={styles.emptyButtonText}>Mostra locali salvati</Text>
            </PressableScale>
          </View>
        )}

        <View style={styles.bottomSpace} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    paddingHorizontal: 14,
  },
  safeTop: {
    height: 18,
  },
  hero: {
    backgroundColor: colors.card,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 20,
    marginBottom: 14,
  },
  kicker: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.4,
    marginBottom: 8,
  },
  title: {
    color: colors.cream,
    fontSize: 38,
    lineHeight: 42,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -0.8,
    marginBottom: 10,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 18,
  },
  searchBox: {
    minHeight: 72,
    borderRadius: 999,
    backgroundColor: colors.paper,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 8,
    gap: 11,
  },
  searchLens: {
    width: 24,
    height: 24,
    position: "relative",
  },
  searchLensCircle: {
    width: 15,
    height: 15,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.muted,
    position: "absolute",
    left: 2,
    top: 2,
  },
  searchLensHandle: {
    width: 9,
    height: 2,
    borderRadius: 999,
    backgroundColor: colors.muted,
    position: "absolute",
    right: 2,
    bottom: 4,
    transform: [{ rotate: "45deg" }],
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.paperText,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "600",
  },
  positionButton: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: colors.paperText,
    borderWidth: 1,
    borderColor: colors.softBorder,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    flexShrink: 0,
    maxWidth: 150,
  },
  positionButtonDisabled: {
    opacity: 0.72,
  },
  positionIcon: {
    width: 19,
    height: 19,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  positionDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.paper,
  },
  positionDotLoading: {
    backgroundColor: colors.pink,
  },
  positionText: {
    color: colors.paper,
    fontSize: 12,
    fontWeight: "900",
    flexShrink: 1,
  },
  suggestionsBox: {
    backgroundColor: colors.black,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    marginTop: 10,
    overflow: "hidden",
  },
  suggestionGroupTitle: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    textTransform: "uppercase",
  },
  suggestionRow: {
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,248,239,0.06)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  suggestionTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  suggestionTitle: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 3,
  },
  suggestionSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  suggestionArrow: {
    color: colors.pink,
    fontSize: 26,
    fontWeight: "900",
  },
  errorText: {
    color: colors.orange,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 11,
    fontWeight: "800",
  },
  modeRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 14,
  },
  modeButton: {
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  modeButtonActive: {
    backgroundColor: colors.cream,
    borderColor: colors.cream,
  },
  modeButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  modeButtonTextActive: {
    color: colors.black,
  },
  categoryRow: {
    marginBottom: 14,
  },
  categoryContent: {
    gap: 8,
    paddingRight: 14,
  },
  categoryChip: {
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryChipActive: {
    backgroundColor: colors.pink,
    borderColor: colors.pink,
  },
  categoryChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  categoryChipTextActive: {
    color: colors.cream,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    minHeight: 88,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 16,
    justifyContent: "center",
  },
  statValue: {
    color: colors.cream,
    fontSize: 30,
    lineHeight: 34,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 4,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  mapCard: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    marginBottom: 24,
    position: "relative",
  },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,6,4,0.48)",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  previewWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 14,
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.paper,
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  previewMark: {
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  previewMarkText: {
    fontSize: 19,
    fontFamily: "serif",
    fontWeight: "900",
  },
  previewBody: {
    flex: 1,
    minWidth: 0,
  },
  previewName: {
    color: colors.paperText,
    fontSize: 17,
    lineHeight: 21,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 2,
  },
  previewMeta: {
    color: "#6F665C",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  previewCta: {
    color: colors.pink,
    fontSize: 12.5,
    fontWeight: "900",
  },
  previewClose: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "rgba(7,6,4,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewCloseText: {
    color: colors.paperText,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "800",
  },
  searchAreaButtonWrap: {
    position: "absolute",
    top: 14,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  searchAreaButton: {
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.3)",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  searchAreaDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  searchAreaButtonText: {
    color: colors.paperText,
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  mapLoadingText: {
    color: colors.cream,
    fontSize: 14,
    fontWeight: "900",
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 12,
  },
  sectionKicker: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.3,
    marginBottom: 7,
  },
  sectionTitle: {
    color: colors.cream,
    fontSize: 28,
    lineHeight: 33,
    fontFamily: "serif",
    fontWeight: "900",
  },
  smallRefreshButton: {
    minHeight: 38,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  smallRefreshButtonText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  placeList: {
    gap: 10,
  },
  placeCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 16,
  },
  placeCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  placeInitial: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(216,78,127,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  placeInitialText: {
    color: colors.pink,
    fontSize: 18,
    fontFamily: "serif",
    fontWeight: "900",
  },
  placeMain: {
    flex: 1,
  },
  placeName: {
    color: colors.cream,
    fontSize: 20,
    lineHeight: 24,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 3,
  },
  placeCategory: {
    color: colors.pink,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  placeArrow: {
    color: colors.pink,
    fontSize: 26,
    lineHeight: 28,
    fontWeight: "900",
  },
  placeDetail: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  placeFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 14,
  },
  placeDistance: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  statusChip: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: "900",
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 20,
    marginBottom: 24,
  },
  emptyTitle: {
    color: colors.cream,
    fontSize: 27,
    lineHeight: 32,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 9,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 16,
  },
  emptyButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  emptyButtonText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "900",
  },
  bottomSpace: {
    height: 124,
  },
});
