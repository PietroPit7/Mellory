import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/pressable-scale";
import {
  type MelloryThemeColors,
  useMelloryTheme,
} from "@/contexts/mellory-theme";

const FAVORITES_STORAGE_KEY = "mellory:favorites";
const TRY_STORAGE_KEY = "mellory:try";
const VISITED_STORAGE_KEY = "mellory:visited";
const RETRY_STORAGE_KEY = "mellory:retry";
const CUSTOM_LISTS_STORAGE_KEY = "mellory:custom-lists";
const PLACES_INDEX_STORAGE_KEY = "mellory:places-index";

type PlaceStatus = "favorite" | "try" | "visited" | "retry";

type ScoreKey =
  | "food"
  | "service"
  | "atmosphere"
  | "value"
  | "design"
  | "drinks"
  | "dessert"
  | "comfort"
  | "return";

type SavedPlace = {
  id: string;
  name: string;
  category: string;
  categoryBase?: string;
  detail: string;
  distance: string;
  distanceMeters?: number;
  savedAt?: string;
  status?: PlaceStatus;
  badges?: string[];
  coverImageUri?: string;
  note?: string;
  website?: string;
  phone?: string;
  openingHours?: string;
  editorialAwards?: string;
  latitude?: number;
  longitude?: number;
};

type PlaceExperience = {
  note: string;
  coverImageUri: string;
  galleryImageUris: string[];
  statuses: PlaceStatus[];
  badges: string[];
  customBadges: {
    id: string;
    label: string;
    emoji: string;
  }[];
  scores: Record<ScoreKey, number>;
  experiences: {
    id: string;
    occasion: string;
    withWho: string;
    dish: string;
    spend: string;
    wouldReturn: boolean | null;
    createdAt: string;
  }[];
  editorialRecognitions: {
    id: string;
    title: string;
    source: string;
    url: string;
    createdAt: string;
    isUserAdded: boolean;
  }[];
};

type EnrichedPlace = SavedPlace & {
  savedAt: string;
  statuses: PlaceStatus[];
  experience?: PlaceExperience | null;
};

type PlacesIndexItem = SavedPlace & {
  statuses: PlaceStatus[];
  badges?: string[];
  coverImageUri?: string;
  note?: string;
  updatedAt?: string;
};

type CustomList = {
  id: string;
  title: string;
  description: string;
  color: string;
  placeIds: string[];
  createdAt: string;
};

const defaultScores: Record<ScoreKey, number> = {
  food: 0,
  service: 0,
  atmosphere: 0,
  value: 0,
  design: 0,
  drinks: 0,
  dessert: 0,
  comfort: 0,
  return: 0,
};

const emptyExperience: PlaceExperience = {
  note: "",
  coverImageUri: "",
  galleryImageUris: [],
  statuses: [],
  badges: [],
  customBadges: [],
  scores: defaultScores,
  experiences: [],
  editorialRecognitions: [],
};

function getPlaceInitial(name: string) {
  const firstLetter = name.trim().charAt(0).toUpperCase();
  return firstLetter || "M";
}

function getSafeSavedAt(place: SavedPlace) {
  return place.savedAt || "";
}

function getExperienceStorageKey(placeId: string) {
  return `mellory:experience:${placeId}`;
}

function getPrimaryStatus(place: EnrichedPlace): PlaceStatus {
  if (place.statuses.includes("favorite")) return "favorite";
  if (place.statuses.includes("try")) return "try";
  if (place.statuses.includes("visited")) return "visited";
  if (place.statuses.includes("retry")) return "retry";
  return "try";
}

function getListCountLabel(count: number) {
  if (count === 1) return "1 locale salvato";
  return `${count} locali salvati`;
}

function getExperienceSummary(place: EnrichedPlace) {
  const experience = place.experience;

  if (!experience) return "";

  const pieces = [];

  if (experience.note.trim().length > 0) {
    pieces.push("nota");
  }

  if (experience.galleryImageUris.length > 0 || experience.coverImageUri) {
    pieces.push("foto");
  }

  if (experience.badges.length > 0) {
    pieces.push("badge");
  }

  if (experience.experiences.length > 0) {
    pieces.push("diario");
  }

  return pieces.join(" · ");
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
    typeof value.detail === "string" &&
    typeof value.distance === "string"
  );
}

function isCustomList(value: unknown): value is CustomList {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.color === "string" &&
    Array.isArray(value.placeIds)
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
    statuses: getStatusArray(record.statuses),
    badges: Array.isArray(record.badges)
      ? record.badges.filter((item): item is string => typeof item === "string")
      : [],
    coverImageUri:
      typeof record.coverImageUri === "string" ? record.coverImageUri : "",
    note: typeof record.note === "string" ? record.note : "",
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

async function readCustomLists() {
  try {
    const storedValue = await AsyncStorage.getItem(CUSTOM_LISTS_STORAGE_KEY);

    if (!storedValue) return [];

    const parsedValue = JSON.parse(storedValue) as unknown;

    if (!Array.isArray(parsedValue)) return [];

    return parsedValue.filter(isCustomList);
  } catch {
    return [];
  }
}

async function readExperience(placeId: string) {
  try {
    const storedValue = await AsyncStorage.getItem(
      getExperienceStorageKey(placeId)
    );

    if (!storedValue) return null;

    const parsedValue = JSON.parse(storedValue) as Partial<PlaceExperience>;

    return {
      ...emptyExperience,
      ...parsedValue,
      statuses: Array.isArray(parsedValue.statuses)
        ? parsedValue.statuses
        : [],
      badges: Array.isArray(parsedValue.badges) ? parsedValue.badges : [],
      customBadges: Array.isArray(parsedValue.customBadges)
        ? parsedValue.customBadges
        : [],
      galleryImageUris: Array.isArray(parsedValue.galleryImageUris)
        ? parsedValue.galleryImageUris
        : [],
      experiences: Array.isArray(parsedValue.experiences)
        ? parsedValue.experiences
        : [],
      editorialRecognitions: Array.isArray(parsedValue.editorialRecognitions)
        ? parsedValue.editorialRecognitions
        : [],
      scores: {
        ...defaultScores,
        ...(parsedValue.scores || {}),
      },
    };
  } catch {
    return null;
  }
}

async function writeExperience(placeId: string, experience: PlaceExperience) {
  await AsyncStorage.setItem(
    getExperienceStorageKey(placeId),
    JSON.stringify(experience)
  );
}

async function removeStatusFromPlacesIndex(
  placeId: string,
  status: PlaceStatus
) {
  const placesIndex = await readPlacesIndex();
  const nextPlacesIndex = placesIndex.flatMap((place) => {
    if (place.id !== placeId) return [place];

    const nextStatuses = place.statuses.filter((item) => item !== status);

    if (nextStatuses.length === 0) return [];

    return [
      {
        ...place,
        status: nextStatuses[0],
        statuses: nextStatuses,
        updatedAt: new Date().toISOString(),
      },
    ];
  });

  await writePlacesIndex(nextPlacesIndex);
}

async function removeStatusFromExperience(
  placeId: string,
  status: PlaceStatus
) {
  const experience = await readExperience(placeId);

  if (!experience || !experience.statuses.includes(status)) {
    return experience;
  }

  const nextExperience = {
    ...experience,
    statuses: experience.statuses.filter((item) => item !== status),
  };

  await writeExperience(placeId, nextExperience);

  return nextExperience;
}

function sortBySavedAtDesc(places: SavedPlace[]) {
  return [...places].sort((a, b) => {
    return getSafeSavedAt(b).localeCompare(getSafeSavedAt(a));
  });
}

function mergePlacesWithStatuses({
  favoritePlaces,
  tryPlaces,
  visitedPlaces,
  retryPlaces,
  experiencesById,
}: {
  favoritePlaces: SavedPlace[];
  tryPlaces: SavedPlace[];
  visitedPlaces: SavedPlace[];
  retryPlaces: SavedPlace[];
  experiencesById: Record<string, PlaceExperience | null>;
}) {
  const merged = new Map<string, EnrichedPlace>();

  function addPlaces(places: SavedPlace[], status: PlaceStatus) {
    places.forEach((place) => {
      const current = merged.get(place.id);
      const experience = experiencesById[place.id] || null;
      const experienceStatuses = experience?.statuses || [];

      const statuses = Array.from(
        new Set<PlaceStatus>([
          ...(current?.statuses || []),
          status,
          ...(place.status ? [place.status] : []),
          ...experienceStatuses,
        ])
      );

      const savedAt =
        place.savedAt || current?.savedAt || new Date(0).toISOString();

      merged.set(place.id, {
        ...current,
        ...place,
        savedAt,
        statuses,
        experience,
      });
    });
  }

  addPlaces(favoritePlaces, "favorite");
  addPlaces(tryPlaces, "try");
  addPlaces(visitedPlaces, "visited");
  addPlaces(retryPlaces, "retry");

  return [...merged.values()].sort((a, b) => {
    return b.savedAt.localeCompare(a.savedAt);
  });
}

export default function MyMelloryScreen() {
  const { colors } = useMelloryTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const screenFade = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      screenFade.setValue(0);
      Animated.timing(screenFade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }, [screenFade])
  );

  const [favoritePlaces, setFavoritePlaces] = useState<SavedPlace[]>([]);
  const [tryPlaces, setTryPlaces] = useState<SavedPlace[]>([]);
  const [visitedPlaces, setVisitedPlaces] = useState<SavedPlace[]>([]);
  const [retryPlaces, setRetryPlaces] = useState<SavedPlace[]>([]);
  const [customLists, setCustomLists] = useState<CustomList[]>([]);
  const [experiencesById, setExperiencesById] = useState<
    Record<string, PlaceExperience | null>
  >({});

  const totalSaved =
    favoritePlaces.length +
    tryPlaces.length +
    visitedPlaces.length +
    retryPlaces.length;

  const allPlaces = useMemo(
    () =>
      mergePlacesWithStatuses({
        favoritePlaces,
        tryPlaces,
        visitedPlaces,
        retryPlaces,
        experiencesById,
      }),
    [favoritePlaces, tryPlaces, visitedPlaces, retryPlaces, experiencesById]
  );

  const hasPlaces = allPlaces.length > 0 || customLists.length > 0;

  const latestPlaces = sortBySavedAtDesc(allPlaces).slice(0, 5);

  const personalDataCount = allPlaces.filter((place) => {
    const experience = place.experience;

    if (!experience) return false;

    return (
      experience.note.trim().length > 0 ||
      experience.coverImageUri.length > 0 ||
      experience.galleryImageUris.length > 0 ||
      experience.badges.length > 0 ||
      experience.experiences.length > 0
    );
  }).length;

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function loadSavedPlaces() {
        const [
          storedFavorites,
          storedTryPlaces,
          storedVisitedPlaces,
          storedRetryPlaces,
          storedCustomLists,
        ] = await Promise.all([
          readSavedPlaces(FAVORITES_STORAGE_KEY),
          readSavedPlaces(TRY_STORAGE_KEY),
          readSavedPlaces(VISITED_STORAGE_KEY),
          readSavedPlaces(RETRY_STORAGE_KEY),
          readCustomLists(),
        ]);

        const uniquePlaceIds = Array.from(
          new Set([
            ...storedFavorites.map((place) => place.id),
            ...storedTryPlaces.map((place) => place.id),
            ...storedVisitedPlaces.map((place) => place.id),
            ...storedRetryPlaces.map((place) => place.id),
            ...storedCustomLists.flatMap((list) => list.placeIds),
          ])
        );

        const experienceEntries = await Promise.all(
          uniquePlaceIds.map(async (placeId) => {
            const experience = await readExperience(placeId);
            return [placeId, experience] as const;
          })
        );

        if (!isActive) return;

        setFavoritePlaces(storedFavorites);
        setTryPlaces(storedTryPlaces);
        setVisitedPlaces(storedVisitedPlaces);
        setRetryPlaces(storedRetryPlaces);
        setCustomLists(storedCustomLists);
        setExperiencesById(Object.fromEntries(experienceEntries));
      }

      loadSavedPlaces();

      return () => {
        isActive = false;
      };
    }, [])
  );

  function getPlaceStatus(place: SavedPlace): PlaceStatus {
    const enrichedPlace = allPlaces.find((item) => item.id === place.id);

    if (enrichedPlace) return getPrimaryStatus(enrichedPlace);

    const isFavorite = favoritePlaces.some(
      (favoritePlace) => favoritePlace.id === place.id
    );

    if (isFavorite) return "favorite";

    const isVisited = visitedPlaces.some(
      (visitedPlace) => visitedPlace.id === place.id
    );

    if (isVisited) return "visited";

    const isRetry = retryPlaces.some((retryPlace) => retryPlace.id === place.id);

    if (isRetry) return "retry";

    return "try";
  }

  function openPlaceDetail(place: SavedPlace, status?: PlaceStatus) {
    router.push({
      pathname: "/place-detail",
      params: {
        id: place.id,
        name: place.name,
        category: place.category,
        detail: place.detail,
        distance: place.distance,
        distanceMeters:
          typeof place.distanceMeters === "number"
            ? String(place.distanceMeters)
            : "",
        status: status || getPlaceStatus(place),
        website: place.website || "",
        phone: place.phone || "",
        openingHours: place.openingHours || "",
        editorialAwards: place.editorialAwards || "",
        latitude:
          typeof place.latitude === "number" ? String(place.latitude) : "",
        longitude:
          typeof place.longitude === "number" ? String(place.longitude) : "",
      },
    } as never);
  }

  function openMap() {
    router.push("/map" as never);
  }

  function openLists() {
    router.push("/lists" as never);
  }

  function openSettings() {
    router.push("/settings" as never);
  }

  async function removeStatusReferences(placeId: string, status: PlaceStatus) {
    const nextExperience = await removeStatusFromExperience(placeId, status);
    await removeStatusFromPlacesIndex(placeId, status);

    if (!nextExperience) return;

    setExperiencesById((currentExperiences) => ({
      ...currentExperiences,
      [placeId]: nextExperience,
    }));
  }

  async function removeFavorite(placeId: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextFavoritePlaces = favoritePlaces.filter(
      (place) => place.id !== placeId
    );

    setFavoritePlaces(nextFavoritePlaces);
    await writeSavedPlaces(FAVORITES_STORAGE_KEY, nextFavoritePlaces);
    await removeStatusReferences(placeId, "favorite");
  }

  async function removeTry(placeId: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextTryPlaces = tryPlaces.filter((place) => place.id !== placeId);

    setTryPlaces(nextTryPlaces);
    await writeSavedPlaces(TRY_STORAGE_KEY, nextTryPlaces);
    await removeStatusReferences(placeId, "try");
  }

  async function removeVisited(placeId: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextVisitedPlaces = visitedPlaces.filter(
      (place) => place.id !== placeId
    );

    setVisitedPlaces(nextVisitedPlaces);
    await writeSavedPlaces(VISITED_STORAGE_KEY, nextVisitedPlaces);
    await removeStatusReferences(placeId, "visited");
  }

  async function removeRetry(placeId: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextRetryPlaces = retryPlaces.filter((place) => place.id !== placeId);

    setRetryPlaces(nextRetryPlaces);
    await writeSavedPlaces(RETRY_STORAGE_KEY, nextRetryPlaces);
    await removeStatusReferences(placeId, "retry");
  }

  return (
    <Animated.View style={{ flex: 1, opacity: screenFade }}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={{ height: insets.top + 16 }} />

      <View style={styles.topRule} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>ARCHIVIO PERSONALE</Text>
          <Text style={styles.title}>My Mellory</Text>
          <Text style={styles.subtitle}>
            I posti che vuoi ricordare, ritrovare e vivere di nuovo.
          </Text>
        </View>

        <PressableScale style={styles.settingsButton} onPress={openSettings} accessibilityLabel="Impostazioni" accessibilityRole="button">
          <View style={styles.sliderIcon}>
            <View style={styles.sliderRow}>
              <View style={styles.sliderKnob} />
              <View style={styles.sliderTrack} />
            </View>
            <View style={styles.sliderRow}>
              <View style={styles.sliderTrack} />
              <View style={styles.sliderKnob} />
            </View>
            <View style={styles.sliderRow}>
              <View style={styles.sliderKnob} />
              <View style={styles.sliderTrack} />
            </View>
          </View>
        </PressableScale>
      </View>

      {/* Hero card */}
      <View style={styles.heroCard}>
        <View style={styles.heroGlow} />

        <View style={styles.heroTop}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>M</Text>
          </View>

          <Text style={styles.heroMeta}>EDIZIONE PERSONALE</Text>
        </View>

        <Text style={styles.heroTitle}>
          La tua guida,{"\n"}scritta dai tuoi posti.
        </Text>

        <Text style={styles.heroText}>
          Qui restano i locali che hanno senso per te: quelli dove torneresti,
          quelli da provare e quelli da ricordare al momento giusto.
        </Text>

        <View style={styles.heroStatsRow}>
          <View style={styles.heroMiniStat}>
            <Text style={styles.heroMiniValue}>{favoritePlaces.length}</Text>
            <Text style={styles.heroMiniLabel}>Preferiti</Text>
          </View>

          <View style={styles.heroMiniDivider} />

          <View style={styles.heroMiniStat}>
            <Text style={styles.heroMiniValue}>{tryPlaces.length}</Text>
            <Text style={styles.heroMiniLabel}>Da provare</Text>
          </View>

          <View style={styles.heroMiniDivider} />

          <View style={styles.heroMiniStat}>
            <Text style={styles.heroMiniValue}>{totalSaved}</Text>
            <Text style={styles.heroMiniLabel}>Totali</Text>
          </View>
        </View>
      </View>

      {/* Empty state */}
      {!hasPlaces && (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <Text style={styles.emptyIcon}>✦</Text>
          </View>

          <Text style={styles.emptyTitle}>Il tuo archivio è pronto.</Text>
          <Text style={styles.emptyText}>
            Apri la mappa, esplora una città o usa la tua posizione. Tocca ♡ per
            salvare un preferito oppure + per aggiungere un posto da provare.
          </Text>

          <PressableScale style={styles.emptyButton} onPress={openMap}>
            <Text style={styles.emptyButtonText}>Apri la mappa</Text>
          </PressableScale>
        </View>
      )}

      {/* Quick stats panel */}
      {hasPlaces && (
        <View style={styles.quickPanel}>
          <Text style={styles.quickKicker}>IL TUO STATO</Text>

          <View style={styles.quickRow}>
            <View style={styles.quickCard}>
              <Text style={styles.quickIcon}>♥</Text>
              <Text style={styles.quickValue}>{favoritePlaces.length}</Text>
              <Text style={styles.quickLabel}>dove torneresti</Text>
            </View>

            <View style={styles.quickCardAccent}>
              <View style={styles.quickCardGlow} />
              <Text style={styles.quickIconAccent}>✓</Text>
              <Text style={styles.quickValueAccent}>{tryPlaces.length}</Text>
              <Text style={styles.quickLabelAccent}>da provare</Text>
            </View>
          </View>

          {(visitedPlaces.length > 0 ||
            retryPlaces.length > 0 ||
            customLists.length > 0 ||
            personalDataCount > 0) && (
            <View style={styles.extraQuickRow}>
              <View style={styles.extraQuickCard}>
                <Text style={styles.extraQuickValue}>{visitedPlaces.length}</Text>
                <Text style={styles.extraQuickLabel}>visitati</Text>
              </View>

              <View style={styles.extraQuickCard}>
                <Text style={styles.extraQuickValue}>{retryPlaces.length}</Text>
                <Text style={styles.extraQuickLabel}>da rivalutare</Text>
              </View>

              <View style={styles.extraQuickCard}>
                <Text style={styles.extraQuickValue}>{customLists.length}</Text>
                <Text style={styles.extraQuickLabel}>liste</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Latest places carousel */}
      {latestPlaces.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.overline}>ULTIMI SALVATAGGI</Text>
              <Text style={styles.sectionTitle}>Appena aggiunti</Text>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.latestRow}
          >
            {latestPlaces.map((place, index) => {
              const status = getPlaceStatus(place);

              return (
                <PressableScale
                  key={`${place.id}-${status}-${index}`}
                  style={styles.latestCard}
                  onPress={() => openPlaceDetail(place, status)}
                >
                  <View style={styles.latestMark}>
                    <Text style={styles.latestMarkText}>
                      {getPlaceInitial(place.name)}
                    </Text>
                  </View>

                  <Text numberOfLines={2} style={styles.latestName}>
                    {place.name}
                  </Text>

                  <Text numberOfLines={1} style={styles.latestCategory}>
                    {place.category}
                  </Text>

                  <Text style={styles.latestDistance}>{place.distance}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Favorites */}
      {favoritePlaces.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.overline}>PREFERITI</Text>
              <Text style={styles.sectionTitle}>Dove torneresti subito</Text>
            </View>

            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{favoritePlaces.length}</Text>
            </View>
          </View>

          {favoritePlaces.map((place) => {
            const enrichedPlace = allPlaces.find((item) => item.id === place.id);
            const experienceSummary = enrichedPlace
              ? getExperienceSummary(enrichedPlace)
              : "";

            return (
              <PressableScale
                key={place.id}
                style={styles.placeCard}
                onPress={() => openPlaceDetail(place, "favorite")}
              >
                <View style={styles.placeAccent} />

                <View style={styles.placeMark}>
                  <Text style={styles.placeMarkText}>
                    {getPlaceInitial(place.name)}
                  </Text>
                </View>

                <View style={styles.placeBody}>
                  <Text numberOfLines={1} style={styles.placeName}>
                    {place.name}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeCategory}>
                    {place.category}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeDetail}>
                    {place.detail}
                  </Text>

                  {experienceSummary.length > 0 && (
                    <Text numberOfLines={1} style={styles.placeExtraDetail}>
                      {experienceSummary}
                    </Text>
                  )}

                  <View style={styles.placeFooter}>
                    <Text style={styles.placeDistance}>{place.distance}</Text>
                    <Text style={styles.placeTag}>♥ Preferito</Text>
                  </View>
                </View>

                <PressableScale
                  style={styles.removeButton}
                  onPress={(event) => {
                    event.stopPropagation?.();
                    void removeFavorite(place.id);
                  }}
                  accessibilityLabel="Rimuovi"
                  accessibilityRole="button"
                >
                  <Text style={styles.removeIcon}>×</Text>
                </PressableScale>
              </PressableScale>
            );
          })}
        </View>
      )}

      {/* Try */}
      {tryPlaces.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.overline}>DA PROVARE</Text>
              <Text style={styles.sectionTitle}>La prossima uscita</Text>
            </View>

            <View style={styles.countPillPink}>
              <Text style={styles.countPillTextPink}>{tryPlaces.length}</Text>
            </View>
          </View>

          {tryPlaces.map((place) => {
            const enrichedPlace = allPlaces.find((item) => item.id === place.id);
            const experienceSummary = enrichedPlace
              ? getExperienceSummary(enrichedPlace)
              : "";

            return (
              <PressableScale
                key={place.id}
                style={styles.placeCard}
                onPress={() => openPlaceDetail(place, "try")}
              >
                <View style={styles.placeAccentPink} />

                <View style={styles.placeMarkSecondary}>
                  <Text style={styles.placeMarkText}>
                    {getPlaceInitial(place.name)}
                  </Text>
                </View>

                <View style={styles.placeBody}>
                  <Text numberOfLines={1} style={styles.placeName}>
                    {place.name}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeCategory}>
                    {place.category}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeDetail}>
                    {place.detail}
                  </Text>

                  {experienceSummary.length > 0 && (
                    <Text numberOfLines={1} style={styles.placeExtraDetail}>
                      {experienceSummary}
                    </Text>
                  )}

                  <View style={styles.placeFooter}>
                    <Text style={styles.placeDistance}>{place.distance}</Text>
                    <Text style={styles.placeTagPink}>✓ Da provare</Text>
                  </View>
                </View>

                <PressableScale
                  style={styles.removeButton}
                  onPress={(event) => {
                    event.stopPropagation?.();
                    void removeTry(place.id);
                  }}
                  accessibilityLabel="Rimuovi"
                  accessibilityRole="button"
                >
                  <Text style={styles.removeIcon}>×</Text>
                </PressableScale>
              </PressableScale>
            );
          })}
        </View>
      )}

      {/* Visited */}
      {visitedPlaces.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.overline}>VISITATI</Text>
              <Text style={styles.sectionTitle}>Posti già vissuti</Text>
            </View>

            <View style={styles.countPillGreen}>
              <Text style={styles.countPillTextGreen}>{visitedPlaces.length}</Text>
            </View>
          </View>

          {visitedPlaces.map((place) => {
            const enrichedPlace = allPlaces.find((item) => item.id === place.id);
            const experienceSummary = enrichedPlace
              ? getExperienceSummary(enrichedPlace)
              : "";

            return (
              <PressableScale
                key={place.id}
                style={styles.placeCard}
                onPress={() => openPlaceDetail(place, "visited")}
              >
                <View style={styles.placeAccentGreen} />

                <View style={styles.placeMarkMuted}>
                  <Text style={styles.placeMarkText}>
                    {getPlaceInitial(place.name)}
                  </Text>
                </View>

                <View style={styles.placeBody}>
                  <Text numberOfLines={1} style={styles.placeName}>
                    {place.name}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeCategory}>
                    {place.category}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeDetail}>
                    {place.detail}
                  </Text>

                  {experienceSummary.length > 0 && (
                    <Text numberOfLines={1} style={styles.placeExtraDetail}>
                      {experienceSummary}
                    </Text>
                  )}

                  <View style={styles.placeFooter}>
                    <Text style={styles.placeDistance}>{place.distance}</Text>
                    <Text style={styles.placeTagGreen}>✓ Visitato</Text>
                  </View>
                </View>

                <PressableScale
                  style={styles.removeButton}
                  onPress={(event) => {
                    event.stopPropagation?.();
                    void removeVisited(place.id);
                  }}
                  accessibilityLabel="Rimuovi"
                  accessibilityRole="button"
                >
                  <Text style={styles.removeIcon}>×</Text>
                </PressableScale>
              </PressableScale>
            );
          })}
        </View>
      )}

      {/* Retry */}
      {retryPlaces.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.overline}>DA RIVALUTARE</Text>
              <Text style={styles.sectionTitle}>Da riprovare con calma</Text>
            </View>

            <View style={styles.countPillOrange}>
              <Text style={styles.countPillTextOrange}>{retryPlaces.length}</Text>
            </View>
          </View>

          {retryPlaces.map((place) => {
            const enrichedPlace = allPlaces.find((item) => item.id === place.id);
            const experienceSummary = enrichedPlace
              ? getExperienceSummary(enrichedPlace)
              : "";

            return (
              <PressableScale
                key={place.id}
                style={styles.placeCard}
                onPress={() => openPlaceDetail(place, "retry")}
              >
                <View style={styles.placeAccentOrange} />

                <View style={styles.placeMarkMuted}>
                  <Text style={styles.placeMarkText}>
                    {getPlaceInitial(place.name)}
                  </Text>
                </View>

                <View style={styles.placeBody}>
                  <Text numberOfLines={1} style={styles.placeName}>
                    {place.name}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeCategory}>
                    {place.category}
                  </Text>

                  <Text numberOfLines={1} style={styles.placeDetail}>
                    {place.detail}
                  </Text>

                  {experienceSummary.length > 0 && (
                    <Text numberOfLines={1} style={styles.placeExtraDetail}>
                      {experienceSummary}
                    </Text>
                  )}

                  <View style={styles.placeFooter}>
                    <Text style={styles.placeDistance}>{place.distance}</Text>
                    <Text style={styles.placeTagOrange}>↻ Da rivalutare</Text>
                  </View>
                </View>

                <PressableScale
                  style={styles.removeButton}
                  onPress={(event) => {
                    event.stopPropagation?.();
                    void removeRetry(place.id);
                  }}
                  accessibilityLabel="Rimuovi"
                  accessibilityRole="button"
                >
                  <Text style={styles.removeIcon}>×</Text>
                </PressableScale>
              </PressableScale>
            );
          })}
        </View>
      )}

      {/* Custom lists */}
      {customLists.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.overline}>LISTE PERSONALIZZATE</Text>
              <Text style={styles.sectionTitle}>Le tue raccolte</Text>
            </View>

            <PressableScale style={styles.openListsButton} onPress={openLists}>
              <Text style={styles.openListsButtonText}>Apri</Text>
            </PressableScale>
          </View>

          {customLists.map((list) => (
            <PressableScale key={list.id} style={styles.customListCard} onPress={openLists}>
              <View
                style={[
                  styles.customListAccent,
                  { backgroundColor: list.color },
                ]}
              />

              <View style={styles.customListBody}>
                <Text numberOfLines={1} style={styles.customListTitle}>
                  {list.title}
                </Text>

                <Text numberOfLines={2} style={styles.customListText}>
                  {list.description || getListCountLabel(list.placeIds.length)}
                </Text>

                <Text style={styles.customListMeta}>
                  {getListCountLabel(list.placeIds.length)}
                </Text>
              </View>

              <Text style={styles.customListArrow}>›</Text>
            </PressableScale>
          ))}
        </View>
      )}

      {/* Bottom editorial card */}
      {hasPlaces && (
        <View style={styles.bottomCard}>
          <Text style={styles.bottomKicker}>LA SCHEDA PERSONALE</Text>
          <Text style={styles.bottomTitle}>Ogni posto ha una storia.</Text>
          <Text style={styles.bottomText}>
            Tocca un locale salvato per aprire note, voto personale, ricordi,
            foto, badge e diario esperienze.
          </Text>
        </View>
      )}

      <View style={styles.bottomSpace} />
    </ScrollView>
    </Animated.View>
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
    },
    topRule: {
      height: 1,
      backgroundColor: colors.yellow,
      opacity: 0.95,
      marginBottom: 28,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 16,
      marginBottom: 26,
    },
    headerText: {
      flex: 1,
    },
    kicker: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 3,
      marginBottom: 8,
    },
    title: {
      color: colors.cream,
      fontSize: 52,
      lineHeight: 56,
      fontWeight: "900",
      letterSpacing: -1.8,
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 19,
      lineHeight: 26,
      marginTop: 7,
      maxWidth: 315,
    },
    settingsButton: {
      width: 58,
      height: 58,
      borderRadius: 999,
      backgroundColor: colors.softBorder,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
    },
    sliderIcon: {
      gap: 5,
      width: 22,
    },
    sliderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    sliderTrack: {
      flex: 1,
      height: 1.5,
      borderRadius: 1,
      backgroundColor: colors.cream,
    },
    sliderKnob: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      borderWidth: 1.5,
      borderColor: colors.cream,
      backgroundColor: colors.card2,
    },
    heroCard: {
      backgroundColor: colors.card,
      borderRadius: 34,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      marginBottom: 18,
      overflow: "hidden",
    },
    heroGlow: {
      position: "absolute",
      right: -55,
      top: -70,
      width: 180,
      height: 180,
      borderRadius: 999,
      backgroundColor: `${colors.pink}1A`,
    },
    heroTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 28,
    },
    heroBadge: {
      width: 52,
      height: 52,
      borderRadius: 999,
      backgroundColor: colors.paper,
      alignItems: "center",
      justifyContent: "center",
    },
    heroBadgeText: {
      color: colors.paperText,
      fontSize: 28,
      fontWeight: "900",
    },
    heroMeta: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 3,
    },
    heroTitle: {
      color: colors.cream,
      fontSize: 39,
      lineHeight: 43,
      fontWeight: "900",
      letterSpacing: -1.1,
      marginBottom: 13,
    },
    heroText: {
      color: colors.textMuted,
      fontSize: 16,
      lineHeight: 25,
      maxWidth: 310,
    },
    heroStatsRow: {
      minHeight: 86,
      borderRadius: 26,
      backgroundColor: colors.softBorder,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 24,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 6,
    },
    heroMiniStat: {
      flex: 1,
      alignItems: "center",
    },
    heroMiniValue: {
      color: colors.cream,
      fontSize: 30,
      lineHeight: 34,
      fontWeight: "900",
    },
    heroMiniLabel: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "900",
      marginTop: 4,
    },
    heroMiniDivider: {
      width: 1,
      height: 38,
      backgroundColor: colors.border,
    },
    emptyCard: {
      backgroundColor: colors.paper,
      borderRadius: 32,
      padding: 24,
      marginBottom: 18,
    },
    emptyIconWrap: {
      width: 52,
      height: 52,
      borderRadius: 999,
      backgroundColor: `${colors.pink}14`,
      borderWidth: 1,
      borderColor: `${colors.pink}29`,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 22,
    },
    emptyIcon: {
      color: colors.pink,
      fontSize: 25,
      fontWeight: "900",
    },
    emptyTitle: {
      color: colors.paperText,
      fontSize: 32,
      lineHeight: 37,
      fontWeight: "900",
      marginBottom: 10,
    },
    emptyText: {
      color: colors.paperText,
      fontSize: 16,
      lineHeight: 25,
    },
    emptyButton: {
      minHeight: 52,
      borderRadius: 999,
      backgroundColor: colors.black,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 20,
    },
    emptyButtonText: {
      color: colors.cream,
      fontSize: 15,
      fontWeight: "900",
    },
    quickPanel: {
      marginBottom: 24,
    },
    quickKicker: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 3,
      marginBottom: 14,
    },
    quickRow: {
      flexDirection: "row",
      gap: 12,
    },
    quickCard: {
      flex: 1,
      minHeight: 130,
      borderRadius: 20,
      backgroundColor: colors.paper,
      padding: 18,
      justifyContent: "space-between",
    },
    quickCardAccent: {
      flex: 1,
      minHeight: 130,
      borderRadius: 20,
      backgroundColor: colors.card2,
      borderWidth: 1.5,
      borderColor: `${colors.pink}55`,
      padding: 18,
      justifyContent: "space-between",
      overflow: "hidden",
    },
    quickCardGlow: {
      position: "absolute",
      right: -22,
      top: -22,
      width: 90,
      height: 90,
      borderRadius: 45,
      backgroundColor: `${colors.pink}1E`,
    },
    quickIcon: {
      color: colors.pink,
      fontSize: 28,
      fontWeight: "900",
    },
    quickIconAccent: {
      color: colors.pink,
      fontSize: 27,
      fontWeight: "900",
    },
    quickValue: {
      color: colors.paperText,
      fontSize: 39,
      lineHeight: 42,
      fontWeight: "900",
    },
    quickValueAccent: {
      color: colors.pink,
      fontSize: 39,
      lineHeight: 42,
      fontWeight: "900",
    },
    quickLabel: {
      color: colors.paperText,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "900",
    },
    quickLabelAccent: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "900",
    },
    extraQuickRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 12,
    },
    extraQuickCard: {
      flex: 1,
      minHeight: 78,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      padding: 14,
      justifyContent: "space-between",
    },
    extraQuickValue: {
      color: colors.cream,
      fontSize: 25,
      lineHeight: 29,
      fontWeight: "900",
    },
    extraQuickLabel: {
      color: colors.muted,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "900",
    },
    section: {
      marginBottom: 24,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 14,
    },
    sectionHeaderText: {
      flex: 1,
    },
    overline: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 2.5,
      marginBottom: 8,
      textTransform: "uppercase",
    },
    sectionTitle: {
      color: colors.cream,
      fontSize: 28,
      lineHeight: 33,
      fontWeight: "900",
      letterSpacing: -1,
    },
    countPill: {
      minWidth: 44,
      height: 44,
      borderRadius: 999,
      backgroundColor: colors.paper,
      alignItems: "center",
      justifyContent: "center",
    },
    countPillPink: {
      minWidth: 44,
      height: 44,
      borderRadius: 999,
      backgroundColor: colors.pink,
      alignItems: "center",
      justifyContent: "center",
    },
    countPillGreen: {
      minWidth: 44,
      height: 44,
      borderRadius: 999,
      backgroundColor: colors.green,
      alignItems: "center",
      justifyContent: "center",
    },
    countPillOrange: {
      minWidth: 44,
      height: 44,
      borderRadius: 999,
      backgroundColor: colors.orange,
      alignItems: "center",
      justifyContent: "center",
    },
    countPillText: {
      color: colors.paperText,
      fontSize: 18,
      fontWeight: "900",
    },
    countPillTextPink: {
      color: colors.cream,
      fontSize: 18,
      fontWeight: "900",
    },
    countPillTextGreen: {
      color: colors.cream,
      fontSize: 18,
      fontWeight: "900",
    },
    countPillTextOrange: {
      color: colors.cream,
      fontSize: 18,
      fontWeight: "900",
    },
    latestRow: {
      gap: 12,
      paddingRight: 22,
    },
    latestCard: {
      width: 178,
      minHeight: 196,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      padding: 18,
      justifyContent: "space-between",
    },
    latestMark: {
      width: 50,
      height: 50,
      borderRadius: 999,
      backgroundColor: `${colors.pink}14`,
      borderWidth: 1,
      borderColor: `${colors.pink}2E`,
      alignItems: "center",
      justifyContent: "center",
    },
    latestMarkText: {
      color: colors.pink,
      fontSize: 25,
      fontWeight: "900",
    },
    latestName: {
      color: colors.cream,
      fontSize: 18,
      lineHeight: 23,
      fontWeight: "900",
      marginTop: 14,
      letterSpacing: -0.3,
    },
    latestCategory: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "600",
      marginTop: 6,
    },
    latestDistance: {
      color: colors.pink,
      fontSize: 13,
      fontWeight: "900",
      marginTop: 10,
    },
    placeCard: {
      minHeight: 108,
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      marginBottom: 10,
      flexDirection: "row",
      overflow: "hidden",
    },
    placeAccent: {
      width: 4,
      backgroundColor: colors.paper,
    },
    placeAccentPink: {
      width: 4,
      backgroundColor: colors.pink,
    },
    placeAccentGreen: {
      width: 4,
      backgroundColor: colors.green,
    },
    placeAccentOrange: {
      width: 4,
      backgroundColor: colors.orange,
    },
    placeMark: {
      width: 62,
      backgroundColor: colors.card2,
      alignItems: "center",
      justifyContent: "center",
    },
    placeMarkSecondary: {
      width: 62,
      backgroundColor: `${colors.pink}12`,
      alignItems: "center",
      justifyContent: "center",
    },
    placeMarkMuted: {
      width: 62,
      backgroundColor: colors.softBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    placeMarkText: {
      color: colors.pink,
      fontSize: 26,
      fontWeight: "900",
    },
    placeBody: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 14,
      paddingHorizontal: 13,
      justifyContent: "center",
    },
    placeName: {
      color: colors.cream,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "800",
      letterSpacing: -0.2,
      marginBottom: 4,
    },
    placeCategory: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 5,
    },
    placeDetail: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
      marginBottom: 9,
    },
    placeExtraDetail: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
      marginTop: -2,
      marginBottom: 8,
    },
    placeFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 6,
      flexWrap: "wrap",
    },
    placeDistance: {
      color: colors.pink,
      fontSize: 12,
      fontWeight: "900",
    },
    placeTag: {
      color: colors.paperText,
      backgroundColor: colors.paper,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: "900",
      overflow: "hidden",
    },
    placeTagPink: {
      color: colors.cream,
      backgroundColor: colors.pink,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: "900",
      overflow: "hidden",
    },
    placeTagGreen: {
      color: colors.cream,
      backgroundColor: colors.green,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: "900",
      overflow: "hidden",
    },
    placeTagOrange: {
      color: colors.cream,
      backgroundColor: colors.orange,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      fontSize: 10,
      fontWeight: "900",
      overflow: "hidden",
    },
    removeButton: {
      width: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    removeIcon: {
      color: colors.muted,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "700",
    },
    openListsButton: {
      minHeight: 42,
      borderRadius: 999,
      backgroundColor: colors.pink,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    openListsButtonText: {
      color: colors.cream,
      fontSize: 12,
      fontWeight: "900",
    },
    customListCard: {
      minHeight: 104,
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 0.5,
      borderColor: colors.softBorder,
      marginBottom: 10,
      flexDirection: "row",
      overflow: "hidden",
    },
    customListAccent: {
      width: 7,
    },
    customListBody: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 16,
      paddingHorizontal: 16,
      justifyContent: "center",
    },
    customListTitle: {
      color: colors.cream,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "800",
      letterSpacing: -0.2,
      marginBottom: 5,
    },
    customListText: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 7,
    },
    customListMeta: {
      color: colors.pink,
      fontSize: 11,
      fontWeight: "900",
    },
    customListArrow: {
      width: 36,
      color: colors.muted,
      fontSize: 24,
      textAlign: "center",
      alignSelf: "center",
    },
    bottomCard: {
      backgroundColor: colors.paper,
      borderRadius: 22,
      padding: 24,
      marginTop: 4,
      marginBottom: 0,
    },
    bottomKicker: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 3,
      marginBottom: 14,
    },
    bottomTitle: {
      color: colors.paperText,
      fontSize: 32,
      lineHeight: 37,
      fontWeight: "900",
      marginBottom: 10,
    },
    bottomText: {
      color: colors.paperText,
      fontSize: 16,
      lineHeight: 25,
    },
    bottomSpace: {
      height: 118,
    },
  });
}
