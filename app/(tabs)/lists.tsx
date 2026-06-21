import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Alert,
  Animated,
  Platform,
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

const FAVORITES_STORAGE_KEY = "mellory:favorites";
const TRY_STORAGE_KEY = "mellory:try";
const VISITED_STORAGE_KEY = "mellory:visited";
const RETRY_STORAGE_KEY = "mellory:retry";
const CUSTOM_LISTS_STORAGE_KEY = "mellory:custom-lists";
const PLACES_INDEX_STORAGE_KEY = "mellory:places-index";

type PlaceStatus = "favorite" | "try" | "visited" | "retry";

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

type PlacesIndexItem = SavedPlace & {
  statuses?: PlaceStatus[];
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

type CollectionKind = "status" | "custom";

type Collection = {
  id: string;
  kind: CollectionKind;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  count: number;
  status?: PlaceStatus;
  customListId?: string;
};

function getStatusCollections(colors: MelloryThemeColors): {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  status: PlaceStatus;
  storageKey: string;
}[] {
  return [
    {
      id: "favorite",
      title: "Preferiti",
      subtitle: "Dove torneresti subito.",
      icon: "♥",
      color: colors.pink,
      status: "favorite",
      storageKey: FAVORITES_STORAGE_KEY,
    },
    {
      id: "try",
      title: "Da provare",
      subtitle: "Posti che vuoi tenere a mente.",
      icon: "✦",
      color: colors.yellow,
      status: "try",
      storageKey: TRY_STORAGE_KEY,
    },
    {
      id: "visited",
      title: "Visitati",
      subtitle: "Locali già vissuti e ricordati.",
      icon: "✓",
      color: colors.green,
      status: "visited",
      storageKey: VISITED_STORAGE_KEY,
    },
    {
      id: "retry",
      title: "Da rivalutare",
      subtitle: "Da riprovare con calma.",
      icon: "↻",
      color: colors.orange,
      status: "retry",
      storageKey: RETRY_STORAGE_KEY,
    },
  ];
}

function createId() {
  return `${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function getPlaceInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "M";
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
    Array.isArray(value.placeIds) &&
    typeof value.createdAt === "string"
  );
}

function toIndexPlace(value: unknown): PlacesIndexItem | null {
  if (!isRecord(value) || !isSavedPlace(value)) return null;

  const place = value as SavedPlace & {
    statuses?: unknown;
    updatedAt?: unknown;
  };

  return {
    ...place,
    statuses: getStatusArray(place.statuses),
    savedAt: typeof place.savedAt === "string" ? place.savedAt : "",
    updatedAt: typeof place.updatedAt === "string" ? place.updatedAt : "",
  };
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

async function writeCustomLists(lists: CustomList[]) {
  await AsyncStorage.setItem(CUSTOM_LISTS_STORAGE_KEY, JSON.stringify(lists));
}

async function readPlacesIndex() {
  try {
    const storedValue = await AsyncStorage.getItem(PLACES_INDEX_STORAGE_KEY);

    if (!storedValue) return [];

    const parsedValue = JSON.parse(storedValue) as unknown;

    if (!Array.isArray(parsedValue)) return [];

    return parsedValue
      .map(toIndexPlace)
      .filter((place): place is PlacesIndexItem => Boolean(place));
  } catch {
    return [];
  }
}

function mergePlace(currentPlace: SavedPlace | undefined, nextPlace: SavedPlace) {
  if (!currentPlace) return nextPlace;

  return {
    ...currentPlace,
    ...nextPlace,
    savedAt: nextPlace.savedAt || currentPlace.savedAt,
    badges: nextPlace.badges || currentPlace.badges,
    coverImageUri: nextPlace.coverImageUri || currentPlace.coverImageUri,
    note: nextPlace.note || currentPlace.note,
  };
}

function sortPlaces(places: SavedPlace[]) {
  return [...places].sort((firstPlace, secondPlace) => {
    const firstDate = firstPlace.savedAt || "";
    const secondDate = secondPlace.savedAt || "";

    return secondDate.localeCompare(firstDate);
  });
}

function getStatusLabel(status: PlaceStatus) {
  if (status === "favorite") return "Preferito";
  if (status === "try") return "Da provare";
  if (status === "visited") return "Visitato";
  return "Da rivalutare";
}

function getStatusColor(status: PlaceStatus, colors: MelloryThemeColors) {
  if (status === "favorite") return colors.pink;
  if (status === "try") return colors.yellow;
  if (status === "visited") return colors.green;
  return colors.orange;
}

export default function ListsScreen() {
  const { colors } = useMelloryTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const statusCollections = useMemo(() => getStatusCollections(colors), [colors]);
  const customListColors = useMemo(
    () => [colors.pink, colors.gold, colors.green, colors.orange, colors.blue],
    [colors]
  );

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
  const [placesIndex, setPlacesIndex] = useState<PlacesIndexItem[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("favorite");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftColor, setDraftColor] = useState(colors.pink);

  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const params = useLocalSearchParams();

  // Arrivo dalla Home su una raccolta specifica: la apro subito.
  useEffect(() => {
    const focus = typeof params.focus === "string" ? params.focus : "";
    if (focus) setSelectedCollectionId(focus);
  }, [params.focus]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function loadLists() {
        const [
          storedFavorites,
          storedTryPlaces,
          storedVisitedPlaces,
          storedRetryPlaces,
          storedCustomLists,
          storedPlacesIndex,
        ] = await Promise.all([
          readSavedPlaces(FAVORITES_STORAGE_KEY),
          readSavedPlaces(TRY_STORAGE_KEY),
          readSavedPlaces(VISITED_STORAGE_KEY),
          readSavedPlaces(RETRY_STORAGE_KEY),
          readCustomLists(),
          readPlacesIndex(),
        ]);

        if (!isActive) return;

        setFavoritePlaces(storedFavorites);
        setTryPlaces(storedTryPlaces);
        setVisitedPlaces(storedVisitedPlaces);
        setRetryPlaces(storedRetryPlaces);
        setCustomLists(storedCustomLists);
        setPlacesIndex(storedPlacesIndex);
      }

      loadLists();

      return () => {
        isActive = false;
      };
    }, [])
  );

  const placeById = useMemo(() => {
    const map = new Map<string, SavedPlace>();

    placesIndex.forEach((place) => {
      map.set(place.id, place);
    });

    [
      ...favoritePlaces,
      ...tryPlaces,
      ...visitedPlaces,
      ...retryPlaces,
    ].forEach((place) => {
      map.set(place.id, mergePlace(map.get(place.id), place));
    });

    return map;
  }, [favoritePlaces, placesIndex, retryPlaces, tryPlaces, visitedPlaces]);

  const collections = useMemo<Collection[]>(() => {
    const statusCounts: Record<PlaceStatus, number> = {
      favorite: favoritePlaces.length,
      try: tryPlaces.length,
      visited: visitedPlaces.length,
      retry: retryPlaces.length,
    };

    const baseCollections = statusCollections.map((collection) => ({
      id: collection.id,
      kind: "status" as const,
      title: collection.title,
      subtitle: collection.subtitle,
      icon: collection.icon,
      color: collection.color,
      count: statusCounts[collection.status],
      status: collection.status,
    }));

    const userCollections = customLists.map((list) => ({
      id: `custom:${list.id}`,
      kind: "custom" as const,
      title: list.title,
      subtitle: list.description || "Raccolta personale",
      icon: "☰",
      color: list.color,
      count: list.placeIds.length,
      customListId: list.id,
    }));

    return [...baseCollections, ...userCollections];
  }, [
    customLists,
    favoritePlaces.length,
    retryPlaces.length,
    tryPlaces.length,
    visitedPlaces.length,
  ]);

  const selectedCollection =
    collections.find((collection) => collection.id === selectedCollectionId) ||
    collections[0];

  const selectedPlaces = useMemo(() => {
    if (!selectedCollection) return [];

    if (selectedCollection.status === "favorite") {
      return sortPlaces(favoritePlaces);
    }

    if (selectedCollection.status === "try") {
      return sortPlaces(tryPlaces);
    }

    if (selectedCollection.status === "visited") {
      return sortPlaces(visitedPlaces);
    }

    if (selectedCollection.status === "retry") {
      return sortPlaces(retryPlaces);
    }

    const customList = customLists.find(
      (list) => list.id === selectedCollection.customListId
    );

    if (!customList) return [];

    return customList.placeIds
      .map((placeId) => placeById.get(placeId))
      .filter((place): place is SavedPlace => Boolean(place));
  }, [
    customLists,
    favoritePlaces,
    placeById,
    retryPlaces,
    selectedCollection,
    tryPlaces,
    visitedPlaces,
  ]);

  const totalPlaces = new Set([
    ...favoritePlaces.map((place) => place.id),
    ...tryPlaces.map((place) => place.id),
    ...visitedPlaces.map((place) => place.id),
    ...retryPlaces.map((place) => place.id),
    ...placesIndex.map((place) => place.id),
  ]).size;

  async function refreshCustomLists(nextLists: CustomList[]) {
    setCustomLists(nextLists);
    await writeCustomLists(nextLists);
  }

  async function createCustomList() {
    const title = draftTitle.trim();

    if (!title) return;

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const newList: CustomList = {
      id: createId(),
      title,
      description: draftDescription.trim(),
      color: draftColor,
      placeIds: [],
      createdAt: new Date().toISOString(),
    };

    const nextLists = [newList, ...customLists];

    await refreshCustomLists(nextLists);
    setSelectedCollectionId(`custom:${newList.id}`);
    setDraftTitle("");
    setDraftDescription("");
    setDraftColor(customListColors[0] ?? colors.pink);
  }

  async function removePlaceFromCustomList(placeId: string) {
    if (selectedCollection?.kind !== "custom") return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const nextLists = customLists.map((list) => {
      if (list.id !== selectedCollection.customListId) return list;

      return {
        ...list,
        placeIds: list.placeIds.filter((id) => id !== placeId),
      };
    });

    await refreshCustomLists(nextLists);
  }

  function startRenameSelectedList() {
    if (selectedCollection?.kind !== "custom") return;

    const customList = customLists.find(
      (list) => list.id === selectedCollection.customListId
    );

    if (!customList) return;

    setRenamingListId(customList.id);
    setRenameTitle(customList.title);
  }

  function cancelRename() {
    setRenamingListId(null);
    setRenameTitle("");
  }

  async function saveRename() {
    const title = renameTitle.trim();

    if (!renamingListId || !title) {
      cancelRename();
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const nextLists = customLists.map((list) =>
      list.id === renamingListId ? { ...list, title } : list
    );

    await refreshCustomLists(nextLists);
    cancelRename();
  }

  async function moveSelectedList(direction: -1 | 1) {
    if (selectedCollection?.kind !== "custom") return;

    void Haptics.selectionAsync();

    const index = customLists.findIndex(
      (list) => list.id === selectedCollection.customListId
    );

    if (index === -1) return;

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= customLists.length) return;

    const nextLists = [...customLists];
    [nextLists[index], nextLists[nextIndex]] = [
      nextLists[nextIndex],
      nextLists[index],
    ];

    await refreshCustomLists(nextLists);
  }

  async function performDeleteSelectedList() {
    if (selectedCollection?.kind !== "custom") return;

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    const selectedListId = selectedCollection.customListId;
    const nextLists = customLists.filter((list) => list.id !== selectedListId);

    await refreshCustomLists(nextLists);
    setSelectedCollectionId("favorite");
  }

  function deleteSelectedCustomList() {
    if (selectedCollection?.kind !== "custom") return;

    const title = "Elimina lista";
    const message = "Vuoi eliminare questa raccolta personale?";

    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`${title}\n\n${message}`)) {
        void performDeleteSelectedList();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina",
        style: "destructive",
        onPress: () => {
          void performDeleteSelectedList();
        },
      },
    ]);
  }

  function openPlaceDetail(place: SavedPlace) {
    const status = place.status || selectedCollection?.status || "none";

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
        status,
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

  return (
    <Animated.View style={{ flex: 1, opacity: screenFade }}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={{ height: insets.top + 8 }} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.kicker}>LE TUE RACCOLTE</Text>
        <Text style={styles.title}>Liste</Text>
        <Text style={styles.stats}>
          {totalPlaces} {totalPlaces === 1 ? "locale" : "locali"} · {collections.length} {collections.length === 1 ? "raccolta" : "raccolte"}
        </Text>
      </View>

      {/* Collection pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
        style={styles.pillScroll}
      >
        {collections.map((collection) => {
          const isSelected = selectedCollection?.id === collection.id;
          return (
            <PressableScale
              key={collection.id}
              style={[
                styles.collectionPill,
                isSelected && {
                  backgroundColor: `${collection.color}22`,
                  borderColor: collection.color,
                },
              ]}
              onPress={() => {
                void Haptics.selectionAsync();
                setSelectedCollectionId(collection.id);
              }}
            >
              <Text
                style={[
                  styles.collectionPillIcon,
                  { color: collection.color },
                ]}
              >
                {collection.icon}
              </Text>
              <Text
                style={[
                  styles.collectionPillText,
                  isSelected && { color: colors.cream },
                ]}
              >
                {collection.title}
              </Text>
              <Text
                style={[
                  styles.collectionPillCount,
                  isSelected && { color: collection.color },
                ]}
              >
                {collection.count}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* Selected collection detail */}
      {selectedCollection && (
        <>
          <View style={styles.sectionRow}>
            {selectedCollection.kind === "custom" &&
            renamingListId === selectedCollection.customListId ? (
              <View style={styles.renameRow}>
                <TextInput
                  value={renameTitle}
                  onChangeText={setRenameTitle}
                  placeholder="Nome lista"
                  placeholderTextColor={colors.muted}
                  style={styles.renameInput}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={saveRename}
                />
                <PressableScale style={styles.renameSaveButton} onPress={saveRename}>
                  <Text style={styles.renameSaveText}>Salva</Text>
                </PressableScale>
                <PressableScale style={styles.renameCancelButton} onPress={cancelRename}>
                  <Text style={styles.renameCancelText}>×</Text>
                </PressableScale>
              </View>
            ) : (
              <Text style={styles.sectionTitle}>{selectedCollection.title}</Text>
            )}
            <Text style={styles.sectionCount}>
              {selectedCollection.count === 1
                ? "1 locale"
                : `${selectedCollection.count} locali`}
            </Text>
          </View>

          {selectedCollection.kind === "custom" &&
          renamingListId !== selectedCollection.customListId ? (
            <View style={styles.listActionsRow}>
              <PressableScale style={styles.listActionButton} onPress={startRenameSelectedList}>
                <Text style={styles.listActionText}>Rinomina</Text>
              </PressableScale>
              <PressableScale
                style={styles.listActionButton}
                onPress={() => moveSelectedList(-1)}
              >
                <Text style={styles.listActionText}>↑</Text>
              </PressableScale>
              <PressableScale
                style={styles.listActionButton}
                onPress={() => moveSelectedList(1)}
              >
                <Text style={styles.listActionText}>↓</Text>
              </PressableScale>
              <PressableScale style={styles.listActionDanger} onPress={deleteSelectedCustomList}>
                <Text style={styles.listActionDangerText}>Elimina</Text>
              </PressableScale>
            </View>
          ) : null}

          {selectedPlaces.length > 0 ? (
            <View style={styles.placeList}>
              {selectedPlaces.map((place) => {
                const placeStatus = place.status || selectedCollection.status;
                const statusColor = placeStatus
                  ? getStatusColor(placeStatus, colors)
                  : selectedCollection.color;

                return (
                  <PressableScale
                    key={place.id}
                    style={styles.placeRow}
                    onPress={() => openPlaceDetail(place)}
                  >
                    <View style={[styles.placeAccentBar, { backgroundColor: statusColor }]} />
                    <View
                      style={[
                        styles.placeAvatar,
                        { backgroundColor: `${statusColor}18` },
                      ]}
                    >
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
                      </Text>
                    </View>

                    {selectedCollection.kind === "custom" ? (
                      <PressableScale
                        style={styles.removeButton}
                        onPress={(event) => {
                          event.stopPropagation?.();
                          removePlaceFromCustomList(place.id);
                        }}
                      >
                        <Text style={styles.removeText}>×</Text>
                      </PressableScale>
                    ) : (
                      <Text style={styles.placeChevron}>›</Text>
                    )}
                  </PressableScale>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                Aggiungi locali dalla mappa o dalla scheda dettaglio.
              </Text>
              <PressableScale
                style={styles.emptyButton}
                onPress={() => router.push("/map" as never)}
              >
                <Text style={styles.emptyButtonText}>Apri la mappa</Text>
              </PressableScale>
            </View>
          )}
        </>
      )}

      {/* Create new list */}
      <View style={styles.createCard}>
        <Text style={styles.createTitle}>Nuova raccolta</Text>

        <TextInput
          value={draftTitle}
          onChangeText={setDraftTitle}
          placeholder="Nome lista"
          placeholderTextColor={colors.muted}
          returnKeyType="next"
          style={styles.input}
        />

        <TextInput
          value={draftDescription}
          onChangeText={setDraftDescription}
          placeholder="Descrizione opzionale"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          onSubmitEditing={createCustomList}
          style={styles.input}
        />

        <View style={styles.colorRow}>
          {customListColors.map((color) => (
            <PressableScale
              key={color}
              style={[
                styles.colorDot,
                { backgroundColor: color },
                draftColor === color && styles.colorDotActive,
              ]}
              onPress={() => setDraftColor(color)}
            />
          ))}
        </View>

        <PressableScale
          style={[
            styles.createButton,
            draftTitle.trim().length === 0 && styles.createButtonDisabled,
          ]}
          onPress={createCustomList}
          disabled={draftTitle.trim().length === 0}
        >
          <Text style={styles.createButtonText}>Crea lista</Text>
        </PressableScale>
      </View>

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
    paddingHorizontal: 20,
  },
  safeTop: {
    height: 16,
  },
  header: {
    marginBottom: 22,
  },
  kicker: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2.5,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  title: {
    color: colors.cream,
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: -1.4,
    lineHeight: 42,
    marginBottom: 4,
  },
  stats: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },
  pillScroll: {
    marginBottom: 20,
  },
  pillRow: {
    gap: 7,
    paddingRight: 20,
  },
  collectionPill: {
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  collectionPillIcon: {
    fontSize: 13,
    fontWeight: "700",
  },
  collectionPillText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  collectionPillCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
    marginTop: 4,
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
  listActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  listActionButton: {
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  listActionText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "600",
  },
  listActionDanger: {
    height: 34,
    borderRadius: 17,
    borderWidth: 0.5,
    borderColor: colors.red,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  listActionDangerText: {
    color: colors.red,
    fontSize: 13,
    fontWeight: "600",
  },
  renameRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  renameInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.cream,
    fontSize: 16,
    fontWeight: "600",
    paddingHorizontal: 12,
  },
  renameSaveButton: {
    height: 40,
    borderRadius: 9,
    backgroundColor: colors.pink,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  renameSaveText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  renameCancelButton: {
    width: 40,
    height: 40,
    borderRadius: 9,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  renameCancelText: {
    color: colors.muted,
    fontSize: 20,
    fontWeight: "400",
  },
  placeList: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    overflow: "hidden",
    marginBottom: 20,
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
    marginLeft: 16,
    flexShrink: 0,
  },
  placeAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  placeAvatarText: {
    fontSize: 15,
    fontWeight: "800",
  },
  placeInfo: {
    flex: 1,
    minWidth: 0,
  },
  placeName: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
    letterSpacing: -0.1,
  },
  placeSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
  },
  placeChevron: {
    color: colors.softBorder,
    fontSize: 20,
  },
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 20,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    padding: 22,
    marginBottom: 20,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  emptyButton: {
    backgroundColor: colors.cream,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: "center",
  },
  emptyButtonText: {
    color: colors.black,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  createCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    padding: 20,
    marginBottom: 20,
  },
  createTitle: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: 16,
  },
  input: {
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.black,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    color: colors.cream,
    fontSize: 15,
    fontWeight: "500",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  colorRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: "transparent",
  },
  colorDotActive: {
    borderColor: colors.cream,
  },
  createButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonDisabled: {
    opacity: 0.35,
  },
  createButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  bottomSpace: {
    height: 110,
  },
  });
}
