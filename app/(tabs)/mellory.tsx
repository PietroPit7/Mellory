import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { PressableScale } from "@/components/pressable-scale";
import { melloryThemeVars } from "@/contexts/mellory-theme";

const colors = melloryThemeVars;

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
    const nextFavoritePlaces = favoritePlaces.filter(
      (place) => place.id !== placeId
    );

    setFavoritePlaces(nextFavoritePlaces);
    await writeSavedPlaces(FAVORITES_STORAGE_KEY, nextFavoritePlaces);
    await removeStatusReferences(placeId, "favorite");
  }

  async function removeTry(placeId: string) {
    const nextTryPlaces = tryPlaces.filter((place) => place.id !== placeId);

    setTryPlaces(nextTryPlaces);
    await writeSavedPlaces(TRY_STORAGE_KEY, nextTryPlaces);
    await removeStatusReferences(placeId, "try");
  }

  async function removeVisited(placeId: string) {
    const nextVisitedPlaces = visitedPlaces.filter(
      (place) => place.id !== placeId
    );

    setVisitedPlaces(nextVisitedPlaces);
    await writeSavedPlaces(VISITED_STORAGE_KEY, nextVisitedPlaces);
    await removeStatusReferences(placeId, "visited");
  }

  async function removeRetry(placeId: string) {
    const nextRetryPlaces = retryPlaces.filter((place) => place.id !== placeId);

    setRetryPlaces(nextRetryPlaces);
    await writeSavedPlaces(RETRY_STORAGE_KEY, nextRetryPlaces);
    await removeStatusReferences(placeId, "retry");
  }

  function renderPlaceRow(
    place: SavedPlace,
    status: PlaceStatus,
    onRemove: () => void,
    statusColor: string
  ) {
    const enrichedPlace = allPlaces.find((item) => item.id === place.id);
    const experienceSummary = enrichedPlace
      ? getExperienceSummary(enrichedPlace)
      : "";

    return (
      <PressableScale
        key={place.id}
        style={styles.placeRow}
        onPress={() => openPlaceDetail(place, status)}
      >
        <View style={[styles.placeAvatar, { backgroundColor: `${statusColor}18` }]}>
          <Text style={[styles.placeAvatarText, { color: statusColor }]}>
            {getPlaceInitial(place.name)}
          </Text>
        </View>

        <View style={styles.placeInfo}>
          <Text numberOfLines={1} style={styles.placeName}>
            {place.name}
          </Text>
          <Text numberOfLines={1} style={styles.placeSub}>
            {place.category}
            {place.distance ? ` · ${place.distance}` : ""}
            {experienceSummary ? ` · ${experienceSummary}` : ""}
          </Text>
        </View>

        <PressableScale
          style={styles.removeButton}
          onPress={(event) => {
            event.stopPropagation?.();
            onRemove();
          }}
        >
          <Text style={styles.removeIcon}>×</Text>
        </PressableScale>
      </PressableScale>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.safeTop} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>My Mellory</Text>
        <PressableScale style={styles.settingsButton} onPress={openSettings}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </PressableScale>
      </View>

      {/* Stats */}
      {hasPlaces && (
        <Text style={styles.stats}>
          {favoritePlaces.length} preferiti · {tryPlaces.length} da provare
          {visitedPlaces.length > 0 ? ` · ${visitedPlaces.length} visitati` : ""}
          {customLists.length > 0 ? ` · ${customLists.length} liste` : ""}
        </Text>
      )}

      {/* Empty state */}
      {!hasPlaces && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            Apri la mappa, esplora una città e tocca ♡ per salvare un preferito
            o + per aggiungere un posto da provare.
          </Text>
          <PressableScale style={styles.emptyButton} onPress={openMap}>
            <Text style={styles.emptyButtonText}>Apri la mappa</Text>
          </PressableScale>
        </View>
      )}

      {/* Favorites */}
      {favoritePlaces.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Preferiti</Text>
            <Text style={styles.sectionCount}>{favoritePlaces.length}</Text>
          </View>
          <View style={styles.placeList}>
            {favoritePlaces.map((place) =>
              renderPlaceRow(place, "favorite", () => removeFavorite(place.id), colors.pink)
            )}
          </View>
        </>
      )}

      {/* Try */}
      {tryPlaces.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Da provare</Text>
            <Text style={styles.sectionCount}>{tryPlaces.length}</Text>
          </View>
          <View style={styles.placeList}>
            {tryPlaces.map((place) =>
              renderPlaceRow(place, "try", () => removeTry(place.id), colors.yellow)
            )}
          </View>
        </>
      )}

      {/* Visited */}
      {visitedPlaces.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Visitati</Text>
            <Text style={styles.sectionCount}>{visitedPlaces.length}</Text>
          </View>
          <View style={styles.placeList}>
            {visitedPlaces.map((place) =>
              renderPlaceRow(place, "visited", () => removeVisited(place.id), colors.green)
            )}
          </View>
        </>
      )}

      {/* Retry */}
      {retryPlaces.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Da rivalutare</Text>
            <Text style={styles.sectionCount}>{retryPlaces.length}</Text>
          </View>
          <View style={styles.placeList}>
            {retryPlaces.map((place) =>
              renderPlaceRow(place, "retry", () => removeRetry(place.id), colors.orange)
            )}
          </View>
        </>
      )}

      {/* Custom lists */}
      {customLists.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Le tue raccolte</Text>
            <PressableScale onPress={openLists}>
              <Text style={styles.sectionLink}>Gestisci ›</Text>
            </PressableScale>
          </View>
          <View style={styles.placeList}>
            {customLists.map((list) => (
              <PressableScale
                key={list.id}
                style={styles.customListRow}
                onPress={openLists}
              >
                <View
                  style={[styles.customListDot, { backgroundColor: list.color }]}
                />
                <View style={styles.placeInfo}>
                  <Text numberOfLines={1} style={styles.placeName}>
                    {list.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.placeSub}>
                    {getListCountLabel(list.placeIds.length)}
                  </Text>
                </View>
                <Text style={styles.placeChevron}>›</Text>
              </PressableScale>
            ))}
          </View>
        </>
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
    paddingHorizontal: 20,
  },
  safeTop: {
    height: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  title: {
    color: colors.cream,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  settingsButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: {
    color: colors.cream,
    fontSize: 17,
    lineHeight: 19,
  },
  stats: {
    color: colors.muted,
    fontSize: 14,
    marginBottom: 20,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginTop: 14,
    marginBottom: 20,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: colors.cream,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  emptyButtonText: {
    color: colors.black,
    fontSize: 15,
    fontWeight: "700",
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    color: colors.cream,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  sectionCount: {
    color: colors.muted,
    fontSize: 14,
  },
  sectionLink: {
    color: colors.pink,
    fontSize: 14,
    fontWeight: "600",
  },
  placeList: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginBottom: 14,
  },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.softBorder,
  },
  placeAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  placeAvatarText: {
    fontSize: 16,
    fontWeight: "700",
  },
  placeInfo: {
    flex: 1,
    minWidth: 0,
  },
  placeName: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  placeSub: {
    color: colors.muted,
    fontSize: 13,
  },
  placeChevron: {
    color: colors.muted,
    fontSize: 20,
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
  },
  removeIcon: {
    color: colors.muted,
    fontSize: 20,
    lineHeight: 22,
  },
  customListRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.softBorder,
  },
  customListDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  bottomSpace: {
    height: 118,
  },
});


