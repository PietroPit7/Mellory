/// <reference types="expo/types" />

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fetchCitySuggestions as fetchGeoapifyCitySuggestions,
  fetchNearbyPlaces as fetchGeoapifyNearbyPlaces,
  hasGeoapifyApiKey as hasGeoapifyServiceApiKey,
} from "@/services/geoapify";
import { melloryThemeVars } from "@/contexts/mellory-theme";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const GEOAPIFY_API_KEY =
  process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY?.trim() ?? "";

const colors = melloryThemeVars;

const FAVORITES_STORAGE_KEY = "mellory:favorites";
const TRY_STORAGE_KEY = "mellory:try";
const PLACES_INDEX_STORAGE_KEY = "mellory:places-index";

const categories = [
  "Tutti",
  "Ristoranti",
  "Bar",
  "Caffè",
  "Pizzerie",
  "Gelaterie",
];

type SearchMode = "nearby" | "city";

type PlaceStatus = "favorite" | "try" | "visited" | "retry";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type SearchArea = {
  latitude: number;
  longitude: number;
  cityLabel: string;
  detailLabel: string;
  mode: SearchMode;
};

type CitySuggestion = {
  id: string;
  label: string;
  detail: string;
  latitude: number;
  longitude: number;
  cityLabel: string;
  detailLabel: string;
};

type Place = {
  id: string;
  name: string;
  category: string;
  categoryBase: string;
  detail: string;
  distance: string;
  distanceMeters: number;
  latitude: number;
  longitude: number;
  website: string;
  phone: string;
  openingHours: string;
  editorialAwards: string;
};

type SavedPlace = Place & {
  savedAt: string;
  status?: PlaceStatus;
};

type PlacesIndexItem = SavedPlace & {
  statuses: PlaceStatus[];
  badges: string[];
  coverImageUri: string;
  note: string;
  updatedAt: string;
};

type NearbyPlacesResult = {
  places: Place[];
  inferredCity: string;
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

function hasGeoapifyApiKey() {
  return hasGeoapifyServiceApiKey();
}

function getCitySearchUnavailableMessage() {
  return "Manca EXPO_PUBLIC_GEOAPIFY_API_KEY. Aggiungila al file .env.local e riavvia Expo con npx expo start -c.";
}

function getPlacesUnavailableMessage() {
  return "Non riesco a leggere bene questa zona adesso. Prova con una città vicina o aggiorna la posizione.";
}

function getPlaceInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "M";
}

function toSavedPlace(place: Place): SavedPlace {
  return {
    ...place,
    savedAt: new Date().toISOString(),
  };
}

function stopPressEvent(event: unknown) {
  if (
    event &&
    typeof event === "object" &&
    "stopPropagation" in event &&
    typeof (event as { stopPropagation?: () => void }).stopPropagation ===
      "function"
  ) {
    (event as { stopPropagation: () => void }).stopPropagation();
  }
}

function getParamValue(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

function parseOptionalNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getCategoryFromRouteParam(value: string) {
  if (value === "restaurant") return "Ristoranti";
  if (value === "cafe") return "Caffè";
  if (value === "bar") return "Bar";
  if (value === "ice_cream") return "Gelaterie";
  if (value === "pizza") return "Pizzerie";
  if (categories.includes(value)) return value;
  return "";
}

function matchesCategory(place: Place, selectedCategory: string) {
  const category = place.category.toLowerCase();
  const detail = place.detail.toLowerCase();

  if (selectedCategory === "Tutti") return true;

  if (selectedCategory === "Ristoranti") {
    return place.categoryBase === "Ristorante";
  }

  if (selectedCategory === "Bar") {
    return place.categoryBase === "Bar" || place.categoryBase === "Pub";
  }

  if (selectedCategory === "Caffè") {
    return place.categoryBase === "Caffè";
  }

  if (selectedCategory === "Pizzerie") {
    return category.includes("pizza") || detail.includes("pizza");
  }

  if (selectedCategory === "Gelaterie") {
    return place.categoryBase === "Gelateria";
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlaceStatus(value: unknown): value is PlaceStatus {
  return (
    value === "favorite" ||
    value === "try" ||
    value === "visited" ||
    value === "retry"
  );
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function getStatusArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlaceStatus);
}

function isSavedPlace(value: unknown): value is SavedPlace {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.category === "string" &&
    typeof value.categoryBase === "string" &&
    typeof value.detail === "string" &&
    typeof value.distance === "string" &&
    typeof value.distanceMeters === "number" &&
    typeof value.savedAt === "string"
  );
}

async function readSavedPlaces(storageKey: string) {
  try {
    const storedValue = await AsyncStorage.getItem(storageKey);
    if (!storedValue) return [];

    const parsedValue = JSON.parse(storedValue) as unknown;

    if (!Array.isArray(parsedValue)) return [];

    return parsedValue.filter(isSavedPlace);
  } catch {
    return [];
  }
}

async function writeSavedPlaces(storageKey: string, places: SavedPlace[]) {
  await AsyncStorage.setItem(storageKey, JSON.stringify(places));
}

function toPlacesIndexItem(value: unknown): PlacesIndexItem | null {
  if (!isRecord(value) || !isSavedPlace(value)) return null;

  const record = value as SavedPlace & Record<string, unknown>;

  return {
    ...record,
    badges: getStringArray(record.badges),
    coverImageUri:
      typeof record.coverImageUri === "string" ? record.coverImageUri : "",
    note: typeof record.note === "string" ? record.note : "",
    statuses: getStatusArray(record.statuses),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

async function readPlacesIndex() {
  try {
    const storedValue = await AsyncStorage.getItem(PLACES_INDEX_STORAGE_KEY);
    if (!storedValue) return [];

    const parsedValue = JSON.parse(storedValue) as unknown;

    if (!Array.isArray(parsedValue)) return [];

    return parsedValue
      .map(toPlacesIndexItem)
      .filter((place): place is PlacesIndexItem => Boolean(place));
  } catch {
    return [];
  }
}

async function writePlacesIndex(places: PlacesIndexItem[]) {
  await AsyncStorage.setItem(PLACES_INDEX_STORAGE_KEY, JSON.stringify(places));
}

async function syncPlaceIndexStatus(
  place: Place,
  status: PlaceStatus,
  shouldSave: boolean
) {
  const placesIndex = await readPlacesIndex();
  const currentPlace = placesIndex.find((item) => item.id === place.id);
  const withoutCurrentPlace = placesIndex.filter((item) => item.id !== place.id);
  const nextStatusSet = new Set<PlaceStatus>(currentPlace?.statuses || []);

  if (shouldSave) {
    nextStatusSet.add(status);
  } else {
    nextStatusSet.delete(status);
  }

  const nextStatuses = Array.from(nextStatusSet);

  if (nextStatuses.length === 0) {
    await writePlacesIndex(withoutCurrentPlace);
    return;
  }

  const now = new Date().toISOString();
  const savedAt = currentPlace?.savedAt || now;
  const indexedPlace: PlacesIndexItem = {
    ...place,
    savedAt,
    status: nextStatuses[0],
    statuses: nextStatuses,
    badges: currentPlace?.badges || [],
    coverImageUri: currentPlace?.coverImageUri || "",
    note: currentPlace?.note || "",
    updatedAt: now,
  };

  await writePlacesIndex([indexedPlace, ...withoutCurrentPlace]);
}

async function getUserPosition(): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    throw new Error(
      "Per trovare locali vicino a te devi autorizzare l’accesso alla posizione."
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
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&lang=it&apiKey=${encodeURIComponent(
      GEOAPIFY_API_KEY
    )}`;
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

    return {
      cityLabel,
      detailLabel:
        cityLabel === "La tua zona"
          ? "Locali selezionati vicino a te"
          : `Locali selezionati vicino a ${cityLabel}`,
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

async function fetchNearbyPlaces(
  searchArea: SearchArea
): Promise<NearbyPlacesResult> {
  const places = await fetchGeoapifyNearbyPlaces(
    searchArea.latitude,
    searchArea.longitude
  );

  return {
    places,
    inferredCity: searchArea.cityLabel,
  };
}

export default function ExploreScreen() {
  const params = useLocalSearchParams();
  const routeLatitude = getParamValue(params.latitude);
  const routeLongitude = getParamValue(params.longitude);
  const routeCityLabel = getParamValue(params.cityLabel);
  const routeDetailLabel = getParamValue(params.detailLabel);
  const routeMode = getParamValue(params.mode);
  const routeCategory = getParamValue(params.category);
  const routeQuery = getParamValue(params.query);
  const hydratedRouteKeyRef = useRef("");

  const [searchArea, setSearchArea] = useState<SearchArea | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("Tutti");
  const [cityQuery, setCityQuery] = useState("");
  const [selectedCityLabel, setSelectedCityLabel] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const [isSuggestingCity, setIsSuggestingCity] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [screenMessage, setScreenMessage] = useState("");
  const [favoritePlaces, setFavoritePlaces] = useState<SavedPlace[]>([]);
  const [tryPlaces, setTryPlaces] = useState<SavedPlace[]>([]);

  const filteredPlaces = useMemo(
    () => places.filter((place) => matchesCategory(place, selectedCategory)),
    [places, selectedCategory]
  );

  const favoriteIds = useMemo(
    () => new Set(favoritePlaces.map((place) => place.id)),
    [favoritePlaces]
  );

  const tryIds = useMemo(
    () => new Set(tryPlaces.map((place) => place.id)),
    [tryPlaces]
  );

  const favoriteCount = favoritePlaces.length;
  const tryCount = tryPlaces.length;
  const hasSelection = favoriteCount > 0 || tryCount > 0;

  const locationHint =
    searchArea?.mode === "city"
      ? "Risultati ordinati rispetto alla città scelta."
      : "Risultati ordinati rispetto alla tua posizione.";

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function loadSavedPlaces() {
      const storedFavorites = await readSavedPlaces(FAVORITES_STORAGE_KEY);
      const storedTryPlaces = await readSavedPlaces(TRY_STORAGE_KEY);

      if (!isActive) return;

      setFavoritePlaces(storedFavorites);
      setTryPlaces(storedTryPlaces);
    }

    loadSavedPlaces();

      return () => {
        isActive = false;
      };
    }, [])
  );

  useEffect(() => {
    const query = cityQuery.trim();

    if (query.length < 3 || query === selectedCityLabel) {
      setCitySuggestions([]);
      setShowCitySuggestions(false);
      setIsSuggestingCity(false);
      return;
    }

    let isActive = true;

    const timeout = setTimeout(async () => {
      setIsSuggestingCity(true);

      const suggestions = await fetchCitySuggestions(query);

      if (isActive) {
        setCitySuggestions(suggestions);
        setShowCitySuggestions(suggestions.length > 0);
        setIsSuggestingCity(false);
      }
    }, 350);

    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [cityQuery, selectedCityLabel]);

  const loadPlacesForArea = useCallback(async (nextSearchArea: SearchArea) => {
    setIsLoading(true);
    setScreenMessage("");
    setPlaces([]);
    setSearchArea(nextSearchArea);

    try {
      const nearbyResult = await fetchNearbyPlaces(nextSearchArea);

      const finalCityLabel =
        nearbyResult.inferredCity || nextSearchArea.cityLabel || "Questa zona";

      setSearchArea({
        ...nextSearchArea,
        cityLabel: finalCityLabel,
        detailLabel:
          finalCityLabel === "La tua zona"
            ? "Locali selezionati vicino a te"
            : nextSearchArea.detailLabel,
      });

      setPlaces(nearbyResult.places);

      if (nearbyResult.places.length === 0) {
        setScreenMessage(
          "Qui ho trovato pochi locali. Prova una zona più centrale o aggiorna la posizione."
        );
      }
    } catch {
      setScreenMessage(getPlacesUnavailableMessage());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const routeKey = [
      routeLatitude,
      routeLongitude,
      routeCityLabel,
      routeDetailLabel,
      routeMode,
      routeCategory,
      routeQuery,
    ].join("|");

    if (!routeKey || hydratedRouteKeyRef.current === routeKey) return;

    const nextCategory = getCategoryFromRouteParam(routeCategory);
    if (nextCategory) {
      setSelectedCategory(nextCategory);
    }

    const latitude = parseOptionalNumber(routeLatitude);
    const longitude = parseOptionalNumber(routeLongitude);

    hydratedRouteKeyRef.current = routeKey;

    if (typeof latitude === "number" && typeof longitude === "number") {
      const cityLabel = routeCityLabel || "Questa zona";

      setCityQuery(cityLabel);
      setSelectedCityLabel(cityLabel);
      setShowCitySuggestions(false);
      setCitySuggestions([]);

      loadPlacesForArea({
        latitude,
        longitude,
        cityLabel,
        detailLabel:
          routeDetailLabel || `Locali selezionati vicino a ${cityLabel}`,
        mode: routeMode === "nearby" ? "nearby" : "city",
      });
      return;
    }

    if (routeQuery.trim().length > 0) {
      setCityQuery(routeQuery.trim());
    }
  }, [
    loadPlacesForArea,
    routeCategory,
    routeCityLabel,
    routeDetailLabel,
    routeLatitude,
    routeLongitude,
    routeMode,
    routeQuery,
  ]);

  async function handleNearMePress() {
    setScreenMessage("");
    setShowCitySuggestions(false);
    setCitySuggestions([]);
    Keyboard.dismiss();

    try {
      setIsLoading(true);

      const currentUserPosition = await getUserPosition();
      const locationLabel = await fetchLocationLabel(
        currentUserPosition.latitude,
        currentUserPosition.longitude
      );

      setCityQuery(locationLabel.cityLabel);
      setSelectedCityLabel(locationLabel.cityLabel);
      setSelectedCategory("Tutti");

      await loadPlacesForArea(
        {
          latitude: currentUserPosition.latitude,
          longitude: currentUserPosition.longitude,
          cityLabel: locationLabel.cityLabel,
          detailLabel: locationLabel.detailLabel,
          mode: "nearby",
        }
      );
    } catch (error) {
      setScreenMessage(
        error instanceof Error
          ? error.message
          : "Non riesco a usare la posizione in questo momento."
      );
      setIsLoading(false);
    }
  }

  async function handleCitySuggestionPress(suggestion: CitySuggestion) {
    Keyboard.dismiss();

    const nextSearchArea: SearchArea = {
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      cityLabel: suggestion.cityLabel,
      detailLabel: suggestion.detailLabel,
      mode: "city",
    };

    setCityQuery(suggestion.cityLabel);
    setSelectedCityLabel(suggestion.cityLabel);
    setCitySuggestions([]);
    setShowCitySuggestions(false);
    setSelectedCategory("Tutti");

    await loadPlacesForArea(nextSearchArea);
  }

  async function handleCitySubmit() {
    const query = cityQuery.trim();

    if (query.length < 3) {
      setScreenMessage("Scrivi almeno tre lettere o usa la tua posizione.");
      return;
    }

    if (!hasGeoapifyApiKey()) {
      setScreenMessage(getCitySearchUnavailableMessage());
      return;
    }

    Keyboard.dismiss();
    setScreenMessage("");
    setShowCitySuggestions(false);
    setIsSuggestingCity(true);

    const suggestions =
      citySuggestions.length > 0
        ? citySuggestions
        : await fetchCitySuggestions(query);

    setIsSuggestingCity(false);

    const firstSuggestion = suggestions[0];

    if (!firstSuggestion) {
      setScreenMessage("Non ho trovato questa città. Prova con un nome più preciso.");
      return;
    }

    await handleCitySuggestionPress(firstSuggestion);
  }

  async function toggleFavorite(place: Place) {
    const alreadySaved = favoriteIds.has(place.id);

    const nextFavoritePlaces = alreadySaved
      ? favoritePlaces.filter((savedPlace) => savedPlace.id !== place.id)
      : [toSavedPlace(place), ...favoritePlaces];

    setFavoritePlaces(nextFavoritePlaces);
    await writeSavedPlaces(FAVORITES_STORAGE_KEY, nextFavoritePlaces);
    await syncPlaceIndexStatus(place, "favorite", !alreadySaved);
  }

  async function toggleTry(place: Place) {
    const alreadySaved = tryIds.has(place.id);

    const nextTryPlaces = alreadySaved
      ? tryPlaces.filter((savedPlace) => savedPlace.id !== place.id)
      : [toSavedPlace(place), ...tryPlaces];

    setTryPlaces(nextTryPlaces);
    await writeSavedPlaces(TRY_STORAGE_KEY, nextTryPlaces);
    await syncPlaceIndexStatus(place, "try", !alreadySaved);
  }

  function openPlaceDetail(place: Place) {
    const isFavorite = favoriteIds.has(place.id);
    const isToTry = tryIds.has(place.id);
    const status = isFavorite ? "favorite" : isToTry ? "try" : "none";

    router.push({
      pathname: "/place-detail",
      params: {
        id: place.id,
        name: place.name,
        category: place.category,
        detail: place.detail,
        distance: place.distance,
        distanceMeters: String(place.distanceMeters),
        status,
        website: place.website,
        phone: place.phone,
        openingHours: place.openingHours,
        editorialAwards: place.editorialAwards,
        latitude: String(place.latitude),
        longitude: String(place.longitude),
      },
    } as never);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.title}>Cerca</Text>
          <Text style={styles.subtitle}>
            Scegli una città o usa la tua posizione.
          </Text>
        </View>
      </View>

      <View style={styles.searchCityBlock}>
        <View style={styles.searchCityBox}>
          <View style={styles.searchLens}>
            <View style={styles.searchLensCircle} />
            <View style={styles.searchLensHandle} />
          </View>

          <TextInput
            value={cityQuery}
            onChangeText={(text) => {
              setCityQuery(text);
              setScreenMessage("");

              if (text.trim() !== selectedCityLabel) {
                setSelectedCityLabel("");
              }
            }}
            placeholder="Cerca una città"
            placeholderTextColor={colors.muted}
            style={styles.searchCityInput}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            editable={!isLoading}
            onSubmitEditing={handleCitySubmit}
            onFocus={() => {
              if (citySuggestions.length > 0) {
                setShowCitySuggestions(true);
              }
            }}
          />

          {isSuggestingCity && <ActivityIndicator color={colors.pink} />}
        </View>

        {showCitySuggestions && (
          <View style={styles.citySuggestionsBox}>
            {citySuggestions.map((suggestion) => (
              <Pressable
                key={suggestion.id}
                style={styles.citySuggestionItem}
                onPress={() => handleCitySuggestionPress(suggestion)}
              >
                <View style={styles.suggestionPin}>
                  <View style={styles.suggestionPinDot} />
                </View>

                <View style={styles.suggestionTextBlock}>
                  <Text style={styles.citySuggestionTitle}>
                    {suggestion.label}
                  </Text>
                  <Text numberOfLines={1} style={styles.citySuggestionDetail}>
                    {suggestion.detail}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          style={[styles.primaryPill, isLoading && styles.primaryPillDisabled]}
          onPress={handleNearMePress}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.paperText} />
          ) : (
            <>
              <View style={styles.locationIcon}>
                <View style={styles.locationDot} />
              </View>
              <Text style={styles.primaryPillText}>
                {searchArea?.mode === "nearby"
                  ? "Aggiorna posizione"
                  : "Vicino a me"}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {searchArea && places.length > 0 && (
        <View style={styles.locationCard}>
          <View style={styles.locationCardIcon}>
            <View style={styles.locationCardDot} />
          </View>

          <View style={styles.locationCardText}>
            <Text style={styles.locationCardTitle}>{searchArea.cityLabel}</Text>

            <Text style={styles.locationCardDescription}>
              {searchArea.detailLabel}
            </Text>

            <Text style={styles.locationCardHint}>{locationHint}</Text>

            {hasSelection && (
              <View style={styles.selectionSummary}>
                {favoriteCount > 0 && (
                  <Text style={styles.selectionSummaryText}>
                    ♥ {favoriteCount} preferiti
                  </Text>
                )}

                {tryCount > 0 && (
                  <Text style={styles.selectionSummaryText}>
                    ✓ {tryCount} da provare
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>
      )}

      {screenMessage.length > 0 && (
        <View style={styles.messageCard}>
          <Text style={styles.messageTitle}>Prova un’altra ricerca</Text>
          <Text style={styles.messageText}>{screenMessage}</Text>
        </View>
      )}

      {!searchArea && !isLoading && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Da dove vuoi partire?</Text>
          <Text style={styles.emptyText}>
            Cerca una città e scegli un suggerimento, oppure usa “Vicino a me”
            per leggere i locali reali intorno alla tua posizione.
          </Text>
        </View>
      )}

      {isLoading && (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colors.pink} />
          <Text style={styles.loadingTitle}>Cerco locali reali...</Text>
          <Text style={styles.loadingText}>
            Sto preparando una selezione ordinata per questa zona.
          </Text>
        </View>
      )}

      {searchArea && places.length > 0 && (
        <>
          <View style={styles.categorySection}>
            <Text style={styles.overline}>CATEGORIE</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
            >
              {categories.map((category) => {
                const isSelected = selectedCategory === category;

                return (
                  <Pressable
                    key={category}
                    style={[
                      styles.categoryChip,
                      isSelected && styles.categoryChipSelected,
                    ]}
                    onPress={() => setSelectedCategory(category)}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        isSelected && styles.categoryTextSelected,
                      ]}
                    >
                      {category}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.resultsHeader}>
            <Text style={styles.resultsTitle}>
              {filteredPlaces.length} locali trovati
            </Text>
            <Text style={styles.resultsMeta}>MELLORY</Text>
          </View>

          <View style={styles.divider} />
        </>
      )}

      {filteredPlaces.map((place) => {
        const isFavorite = favoriteIds.has(place.id);
        const isToTry = tryIds.has(place.id);
        const hasExtraData =
          place.website.length > 0 ||
          place.phone.length > 0 ||
          place.openingHours.length > 0 ||
          place.editorialAwards.length > 0;

        return (
          <Pressable
            key={place.id}
            style={styles.resultCard}
            onPress={() => openPlaceDetail(place)}
          >
            <View style={styles.resultMark}>
              <Text style={styles.resultMarkText}>
                {getPlaceInitial(place.name)}
              </Text>
            </View>

            <View style={styles.resultBody}>
              <Text numberOfLines={1} style={styles.placeName}>
                {place.name}
              </Text>

              <Text numberOfLines={1} style={styles.placeCategory}>
                {place.category}
              </Text>

              <View style={styles.placeMetaRow}>
                <View style={styles.smallPin}>
                  <View style={styles.smallPinDot} />
                </View>
                <Text numberOfLines={1} style={styles.placeMeta}>
                  {place.detail}
                </Text>
              </View>

              <View style={styles.placeBottomRow}>
                <Text style={styles.distance}>{place.distance}</Text>

                {hasExtraData && (
                  <Text style={styles.realDataTag}>dati reali</Text>
                )}
              </View>
            </View>

            <View style={styles.placeActions}>
              <Pressable
                style={[
                  styles.placeActionButton,
                  isFavorite && styles.placeActionButtonActive,
                ]}
                onPress={(event) => {
                  stopPressEvent(event);
                  toggleFavorite(place);
                }}
              >
                <Text
                  style={[
                    styles.favoriteIcon,
                    isFavorite && styles.favoriteIconActive,
                  ]}
                >
                  {isFavorite ? "♥" : "♡"}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.placeActionButtonSecondary,
                  isToTry && styles.placeActionButtonSecondaryActive,
                ]}
                onPress={(event) => {
                  stopPressEvent(event);
                  toggleTry(place);
                }}
              >
                <Text style={[styles.tryIcon, isToTry && styles.tryIconActive]}>
                  {isToTry ? "✓" : "ï¼‹"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        );
      })}

      {searchArea &&
        places.length > 0 &&
        filteredPlaces.length === 0 &&
        !isLoading && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              Nessun risultato in questa categoria.
            </Text>
            <Text style={styles.emptyText}>
              Prova con “Tutti” oppure cerca un’altra zona.
            </Text>
          </View>
        )}

      {searchArea && places.length > 0 && (
        <View style={styles.endCard}>
          <Text style={styles.endTitle}>Hai trovato qualcosa di interessante?</Text>
          <Text style={styles.endText}>
            I tuoi preferiti e i posti da provare restano salvati in My Mellory.
          </Text>
        </View>
      )}

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 44,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 28,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonText: {
    color: colors.cream,
    fontSize: 38,
    lineHeight: 40,
    fontWeight: "700",
    marginTop: -3,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.cream,
    fontSize: 45,
    lineHeight: 50,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -1.2,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 27,
    marginTop: 2,
    maxWidth: 310,
  },
  searchCityBlock: {
    marginBottom: 18,
  },
  searchCityBox: {
    minHeight: 72,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginBottom: 12,
  },
  searchLens: {
    width: 24,
    height: 24,
    position: "relative",
  },
  searchLensCircle: {
    width: 16,
    height: 16,
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
    bottom: 5,
    transform: [{ rotate: "45deg" }],
  },
  searchCityInput: {
    flex: 1,
    color: colors.cream,
    fontSize: 18,
    fontWeight: "700",
  },
  citySuggestionsBox: {
    backgroundColor: colors.card,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.1)",
    marginBottom: 12,
    overflow: "hidden",
  },
  citySuggestionItem: {
    minHeight: 70,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 248, 239, 0.06)",
  },
  suggestionPin: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionPinDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  suggestionTextBlock: {
    flex: 1,
  },
  citySuggestionTitle: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 3,
  },
  citySuggestionDetail: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  primaryPill: {
    minHeight: 56,
    backgroundColor: colors.paper,
    borderRadius: 999,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    alignSelf: "flex-start",
  },
  primaryPillDisabled: {
    opacity: 0.82,
  },
  primaryPillText: {
    color: colors.paperText,
    fontSize: 16,
    fontWeight: "900",
  },
  locationIcon: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.paperText,
    alignItems: "center",
    justifyContent: "center",
  },
  locationDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  locationCard: {
    backgroundColor: colors.paper,
    borderRadius: 28,
    padding: 20,
    flexDirection: "row",
    gap: 16,
    marginBottom: 24,
  },
  locationCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.paperText,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  locationCardDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  locationCardText: {
    flex: 1,
  },
  locationCardTitle: {
    color: colors.paperText,
    fontSize: 28,
    lineHeight: 32,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 4,
  },
  locationCardDescription: {
    color: colors.paperText,
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 8,
  },
  locationCardHint: {
    color: colors.paperText,
    fontSize: 15,
    lineHeight: 22,
  },
  selectionSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  selectionSummaryText: {
    color: colors.paperText,
    backgroundColor: "rgba(216, 78, 127, 0.13)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 13,
    fontWeight: "900",
    overflow: "hidden",
  },
  messageCard: {
    backgroundColor: "rgba(255, 248, 239, 0.08)",
    borderColor: "rgba(255, 248, 239, 0.12)",
    borderWidth: 1,
    borderRadius: 26,
    padding: 18,
    marginBottom: 24,
  },
  messageTitle: {
    color: colors.cream,
    fontSize: 21,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 7,
  },
  messageText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 22,
    marginBottom: 14,
  },
  emptyTitle: {
    color: colors.cream,
    fontSize: 28,
    lineHeight: 32,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 10,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  loadingCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 22,
    marginBottom: 14,
    alignItems: "flex-start",
    gap: 12,
  },
  loadingTitle: {
    color: colors.cream,
    fontSize: 25,
    lineHeight: 29,
    fontFamily: "serif",
    fontWeight: "900",
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  categorySection: {
    marginBottom: 34,
  },
  overline: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 14,
  },
  categoryRow: {
    gap: 10,
    paddingRight: 24,
  },
  categoryChip: {
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    paddingVertical: 13,
    paddingHorizontal: 17,
  },
  categoryChipSelected: {
    backgroundColor: colors.paper,
    borderColor: colors.paper,
  },
  categoryText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "900",
  },
  categoryTextSelected: {
    color: colors.paperText,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 16,
  },
  resultsTitle: {
    color: colors.textMuted,
    fontSize: 19,
    fontWeight: "900",
  },
  resultsMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255, 248, 239, 0.08)",
    marginBottom: 20,
  },
  resultCard: {
    minHeight: 132,
    borderRadius: 26,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    marginBottom: 14,
    flexDirection: "row",
    overflow: "hidden",
  },
  resultMark: {
    width: 78,
    backgroundColor: colors.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  resultMarkText: {
    color: colors.pink,
    fontSize: 35,
    fontFamily: "serif",
    fontWeight: "900",
  },
  resultBody: {
    flex: 1,
    paddingVertical: 17,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  placeName: {
    color: colors.cream,
    fontSize: 23,
    lineHeight: 27,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 7,
  },
  placeCategory: {
    color: colors.textMuted,
    fontSize: 16,
    marginBottom: 12,
  },
  placeMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 9,
  },
  smallPin: {
    width: 15,
    height: 15,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  smallPinDot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.muted,
  },
  placeMeta: {
    flex: 1,
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  placeBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  distance: {
    color: colors.pink,
    fontSize: 13,
    fontWeight: "900",
  },
  realDataTag: {
    color: colors.yellow,
    backgroundColor: "rgba(226, 189, 53, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  placeActions: {
    width: 56,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "space-between",
  },
  placeActionButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 248, 239, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.12)",
  },
  placeActionButtonActive: {
    backgroundColor: "rgba(255, 248, 239, 0.12)",
    borderColor: "rgba(255, 248, 239, 0.32)",
  },
  placeActionButtonSecondary: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(216, 78, 127, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(216, 78, 127, 0.32)",
  },
  placeActionButtonSecondaryActive: {
    backgroundColor: colors.pink,
    borderColor: colors.pink,
  },
  favoriteIcon: {
    color: colors.cream,
    fontSize: 23,
    lineHeight: 25,
  },
  favoriteIconActive: {
    color: colors.pink,
  },
  tryIcon: {
    color: colors.pink,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "900",
  },
  tryIconActive: {
    color: colors.cream,
    fontSize: 20,
  },
  endCard: {
    backgroundColor: colors.paper,
    borderRadius: 30,
    padding: 24,
    marginTop: 12,
  },
  endTitle: {
    color: colors.paperText,
    fontSize: 30,
    lineHeight: 35,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -0.8,
    marginBottom: 10,
  },
  endText: {
    color: colors.paperText,
    fontSize: 16,
    lineHeight: 25,
  },
  bottomSpace: {
    height: 118,
  },
});


