import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { PressableScale } from "@/components/pressable-scale";
import { melloryThemeVars } from "@/contexts/mellory-theme";
import { enrichPlaceWithOpenData } from "@/services/placeOpenDataEnrichment";
import type { OpenDataEnrichment } from "@/services/placeOpenDataEnrichment";

type PlaceStatus = "try" | "favorite" | "visited" | "retry";

type SheetType =
  | "none"
  | "lists"
  | "note"
  | "experience"
  | "badges"
  | "gallery"
  | "editorial"
  | "customLists"
  | "details";

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

type ExperienceEntry = {
  id: string;
  occasion: string;
  withWho: string;
  dish: string;
  spend: string;
  wouldReturn: boolean | null;
  createdAt: string;
};

type CustomBadge = {
  id: string;
  label: string;
  emoji: string;
};

type EditorialRecognition = {
  id: string;
  title: string;
  source: string;
  url: string;
  createdAt: string;
  isUserAdded: boolean;
};

type PersonalDetails = {
  address: string;
  phone: string;
  website: string;
  openingHours: string;
  practicalNotes: string;
};

type PlaceExperience = {
  note: string;
  coverImageUri: string;
  galleryImageUris: string[];
  statuses: PlaceStatus[];
  badges: string[];
  customBadges: CustomBadge[];
  scores: Record<ScoreKey, number>;
  experiences: ExperienceEntry[];
  editorialRecognitions: EditorialRecognition[];
  personalDetails: PersonalDetails;
};

type SavedPlace = {
  id: string;
  name: string;
  category: string;
  categoryBase: string;
  detail: string;
  distance: string;
  distanceMeters: number;
  savedAt: string;
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
  statuses: PlaceStatus[];
  badges: string[];
  coverImageUri: string;
  note: string;
  updatedAt: string;
};

type BadgeCategory = "occasione" | "gusto" | "atmosfera" | "personale";

type StandardBadge = {
  id: string;
  label: string;
  icon: string;
  category: BadgeCategory;
  color: string;
};

type CustomList = {
  id: string;
  title: string;
  description: string;
  color: string;
  placeIds: string[];
  createdAt: string;
};

const colors = melloryThemeVars;

const FAVORITES_STORAGE_KEY = "mellory:favorites";
const TRY_STORAGE_KEY = "mellory:try";
const VISITED_STORAGE_KEY = "mellory:visited";
const RETRY_STORAGE_KEY = "mellory:retry";
const CUSTOM_LISTS_STORAGE_KEY = "mellory:custom-lists";
const PLACES_INDEX_STORAGE_KEY = "mellory:places-index";

const statusStorageKeys: Record<PlaceStatus, string> = {
  try: TRY_STORAGE_KEY,
  favorite: FAVORITES_STORAGE_KEY,
  visited: VISITED_STORAGE_KEY,
  retry: RETRY_STORAGE_KEY,
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

const emptyPersonalDetails: PersonalDetails = {
  address: "",
  phone: "",
  website: "",
  openingHours: "",
  practicalNotes: "",
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
  personalDetails: emptyPersonalDetails,
};

const listOptions: {
  status: PlaceStatus;
  emoji: string;
  title: string;
  text: string;
  color: string;
}[] = [
  {
    status: "try",
    emoji: "✦",
    title: "Da provare",
    text: "Posti che vuoi visitare prossimamente.",
    color: colors.yellow,
  },
  {
    status: "favorite",
    emoji: "♥",
    title: "Preferito",
    text: "Posti in cui torneresti senza pensarci.",
    color: colors.pink,
  },
  {
    status: "visited",
    emoji: "✓",
    title: "Visitato",
    text: "Posti dove sei già stato e vuoi ricordare.",
    color: colors.green,
  },
  {
    status: "retry",
    emoji: "↻",
    title: "Da rivalutare",
    text: "Posti da riprovare prima di decidere.",
    color: colors.orange,
  },
];

const scoreRows: { key: ScoreKey; label: string }[] = [
  { key: "food", label: "Cibo" },
  { key: "service", label: "Servizio" },
  { key: "atmosphere", label: "Atmosfera" },
  { key: "value", label: "Prezzo / valore" },
  { key: "design", label: "Design / Location" },
  { key: "drinks", label: "Cocktail / Vino" },
  { key: "dessert", label: "Dessert" },
  { key: "comfort", label: "Comfort" },
  { key: "return", label: "Voglia di tornarci" },
];

const standardBadges: StandardBadge[] = [
  {
    id: "romantico",
    label: "romantico",
    icon: "♡",
    category: "occasione",
    color: colors.pink,
  },
  {
    id: "amici",
    label: "amici",
    icon: "♢",
    category: "occasione",
    color: colors.gold,
  },
  {
    id: "business",
    label: "business",
    icon: "◆",
    category: "occasione",
    color: colors.blue,
  },
  {
    id: "famiglia",
    label: "famiglia",
    icon: "⌂",
    category: "occasione",
    color: colors.sage,
  },
  {
    id: "gourmet",
    label: "gourmet",
    icon: "✦",
    category: "gusto",
    color: colors.yellow,
  },
  {
    id: "vino",
    label: "vino",
    icon: "♕",
    category: "gusto",
    color: colors.red,
  },
  {
    id: "cocktail",
    label: "cocktail",
    icon: "◒",
    category: "gusto",
    color: colors.violet,
  },
  {
    id: "dolci",
    label: "dolci",
    icon: "◌",
    category: "gusto",
    color: colors.orange,
  },
  {
    id: "hidden-gem",
    label: "hidden gem",
    icon: "◇",
    category: "personale",
    color: colors.gold,
  },
  {
    id: "vista",
    label: "vista bella",
    icon: "◐",
    category: "atmosfera",
    color: colors.blue,
  },
  {
    id: "design",
    label: "design",
    icon: "▧",
    category: "atmosfera",
    color: colors.violet,
  },
  {
    id: "verde",
    label: "verde",
    icon: "♧",
    category: "atmosfera",
    color: colors.green,
  },
];

const badgeEmojis = [
  "✦",
  "◇",
  "◆",
  "♡",
  "♢",
  "◌",
  "◐",
  "◒",
  "▧",
  "♧",
  "☕",
  "🍷",
  "🍰",
  "🍸",
  "🌿",
  "🌊",
  "🌅",
  "✨",
];

const customListColors = [
  colors.pink,
  colors.yellow,
  colors.green,
  colors.orange,
  colors.blue,
  colors.violet,
  colors.gold,
];

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function getParamValue(value: string | string[] | undefined, fallback: string) {
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

function normalizeInitialStatus(value: string): PlaceStatus | null {
  if (value === "try") return "try";
  if (value === "favorite") return "favorite";
  if (value === "visited") return "visited";
  if (value === "retry") return "retry";
  return null;
}

function isPlaceStatus(value: unknown): value is PlaceStatus {
  return (
    value === "try" ||
    value === "favorite" ||
    value === "visited" ||
    value === "retry"
  );
}

function parseOptionalNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getExperienceStorageKey(placeId: string) {
  return `mellory:experience:${placeId}`;
}

function createId() {
  return `${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "M";
}

function getAverageScore(scores: Record<ScoreKey, number>) {
  const active = Object.values(scores).filter((value) => value > 0);

  if (active.length === 0) return null;

  const total = active.reduce((sum, value) => sum + value, 0);
  return Number(((total / active.length) * 2).toFixed(1));
}

function getScoreLabel(score: number | null) {
  if (!score) return "Non valutato";
  if (score >= 9) return "Eccellente";
  if (score >= 7.5) return "Ottimo";
  if (score >= 6) return "Interessante";
  if (score >= 4) return "Da rivedere";
  return "Debole";
}

function getScoreColor(score: number | null) {
  if (!score) return colors.muted;
  if (score >= 8.5) return colors.green;
  if (score >= 7) return colors.gold;
  if (score >= 6) return colors.yellow;
  if (score >= 4) return colors.orange;
  return colors.red;
}

function parseDelimitedList(value: string) {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getOpeningHoursRows(openingHours: string) {
  return openingHours
    .split(";")
    .map((row) => row.trim())
    .filter(Boolean);
}

function getEditorialRecognitionsFromParams(rawValue: string) {
  const items = parseDelimitedList(rawValue);

  return items.map((item, index): EditorialRecognition => {
    const parts = item.split("::").map((part) => part.trim());

    return {
      id: `param-editorial-${index}`,
      title: parts[0] || item,
      source: parts[1] || "Fonte editoriale",
      url: parts[2] || "",
      createdAt: "",
      isUserAdded: false,
    };
  });
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();

  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function getStandardBadge(label: string) {
  return standardBadges.find((badge) => badge.label === label);
}

function getBadgeIcon(label: string, customBadges: CustomBadge[]) {
  const customBadge = customBadges.find((badge) => badge.label === label);
  if (customBadge) return customBadge.emoji;

  const standardBadge = getStandardBadge(label);
  return standardBadge?.icon || "✦";
}

function getBadgeColor(label: string) {
  const standardBadge = getStandardBadge(label);
  return standardBadge?.color || colors.pink;
}

function getBadgeCategory(label: string): BadgeCategory {
  const standardBadge = getStandardBadge(label);
  if (standardBadge) return standardBadge.category;

  const normalized = label.toLowerCase();

  if (
    normalized.includes("romantico") ||
    normalized.includes("amici") ||
    normalized.includes("famiglia") ||
    normalized.includes("business")
  ) {
    return "occasione";
  }

  if (
    normalized.includes("gourmet") ||
    normalized.includes("cocktail") ||
    normalized.includes("vino") ||
    normalized.includes("dolci") ||
    normalized.includes("colazione")
  ) {
    return "gusto";
  }

  if (
    normalized.includes("vista") ||
    normalized.includes("design") ||
    normalized.includes("mare") ||
    normalized.includes("verde") ||
    normalized.includes("comfort")
  ) {
    return "atmosfera";
  }

  return "personale";
}

function getStatusLabel(status: PlaceStatus) {
  return listOptions.find((item) => item.status === status)?.title || status;
}

function getStatusColor(status: PlaceStatus) {
  return listOptions.find((item) => item.status === status)?.color || colors.pink;
}

function getCurrentPlaceSummary({
  placeId,
  name,
  category,
  detail,
  distance,
  distanceMeters = 0,
  status,
  badges,
  coverImageUri,
  note,
  website,
  phone,
  openingHours,
  editorialAwards,
  latitude,
  longitude,
}: {
  placeId: string;
  name: string;
  category: string;
  detail: string;
  distance: string;
  distanceMeters?: number;
  status: PlaceStatus;
  badges: string[];
  coverImageUri: string;
  note: string;
  website?: string;
  phone?: string;
  openingHours?: string;
  editorialAwards?: string;
  latitude?: number;
  longitude?: number;
}): SavedPlace {
  return {
    id: placeId,
    name,
    category,
    categoryBase: category,
    detail,
    distance,
    distanceMeters,
    savedAt: new Date().toISOString(),
    status,
    badges,
    coverImageUri,
    note,
    website,
    phone,
    openingHours,
    editorialAwards,
    latitude,
    longitude,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function getStringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function getNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function getStatusArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlaceStatus);
}

function getPersonalDetails(value: unknown): PersonalDetails {
  if (!isRecord(value)) return emptyPersonalDetails;

  return {
    address: getStringValue(value.address),
    phone: getStringValue(value.phone),
    website: getStringValue(value.website),
    openingHours: getStringValue(value.openingHours),
    practicalNotes: getStringValue(value.practicalNotes),
  };
}

function hasUsablePlaceDetail(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    normalized.length > 0 &&
    normalized !== "dettagli in arrivo" &&
    normalized !== "dettagli non disponibili"
  );
}

function toPlacesIndexItem(value: unknown): PlacesIndexItem | null {
  if (!isSavedPlace(value) || !isRecord(value)) return null;

  const savedPlace = value as SavedPlace & Record<string, unknown>;
  const status = isPlaceStatus(savedPlace.status) ? savedPlace.status : null;
  const statuses = getStatusArray(savedPlace.statuses);

  return {
    ...savedPlace,
    categoryBase: getStringValue(savedPlace.categoryBase, savedPlace.category),
    distanceMeters: getNumberValue(savedPlace.distanceMeters) ?? 0,
    savedAt: getStringValue(savedPlace.savedAt, new Date(0).toISOString()),
    badges: getStringArray(savedPlace.badges),
    coverImageUri: getStringValue(savedPlace.coverImageUri),
    note: getStringValue(savedPlace.note),
    website: getStringValue(savedPlace.website),
    phone: getStringValue(savedPlace.phone),
    openingHours: getStringValue(savedPlace.openingHours),
    editorialAwards: getStringValue(savedPlace.editorialAwards),
    latitude: getNumberValue(savedPlace.latitude),
    longitude: getNumberValue(savedPlace.longitude),
    statuses: statuses.length > 0 ? statuses : status ? [status] : [],
    updatedAt: getStringValue(
      savedPlace.updatedAt,
      getStringValue(savedPlace.savedAt, new Date().toISOString())
    ),
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

async function writeCustomLists(lists: CustomList[]) {
  await AsyncStorage.setItem(CUSTOM_LISTS_STORAGE_KEY, JSON.stringify(lists));
}

async function readExperienceState(placeId: string) {
  try {
    const stored = await AsyncStorage.getItem(getExperienceStorageKey(placeId));

    if (!stored) {
      return {
        exists: false,
        experience: emptyExperience,
      };
    }

    const parsed = JSON.parse(stored);

    return {
      exists: true,
      experience: {
        ...emptyExperience,
        ...parsed,
        statuses: Array.isArray(parsed.statuses) ? parsed.statuses : [],
        badges: Array.isArray(parsed.badges) ? parsed.badges : [],
        customBadges: Array.isArray(parsed.customBadges)
          ? parsed.customBadges
          : [],
        galleryImageUris: Array.isArray(parsed.galleryImageUris)
          ? parsed.galleryImageUris
          : [],
        experiences: Array.isArray(parsed.experiences)
          ? parsed.experiences
          : [],
        editorialRecognitions: Array.isArray(parsed.editorialRecognitions)
          ? parsed.editorialRecognitions
          : [],
        scores: {
          ...defaultScores,
          ...(parsed.scores || {}),
        },
        personalDetails: getPersonalDetails(parsed.personalDetails),
      } as PlaceExperience,
    };
  } catch {
    return {
      exists: false,
      experience: emptyExperience,
    };
  }
}

async function writeExperience(placeId: string, experience: PlaceExperience) {
  await AsyncStorage.setItem(
    getExperienceStorageKey(placeId),
    JSON.stringify(experience)
  );
}

async function readGlobalStatuses(placeId: string) {
  const statuses: PlaceStatus[] = [];

  for (const status of Object.keys(statusStorageKeys) as PlaceStatus[]) {
    const places = await readSavedPlaces(statusStorageKeys[status]);
    if (places.some((place) => place.id === placeId)) {
      statuses.push(status);
    }
  }

  return statuses;
}

export default function PlaceDetailScreen() {
  const params = useLocalSearchParams();

  const placeId = getParamValue(params.id, "mellory-place");
  const name = getParamValue(params.name, "Locale salvato");
  const category = getParamValue(params.category, "Locale");
  const detail = getParamValue(params.detail, "");
  const distance = getParamValue(params.distance, "Distanza da te");
  const initialStatus = normalizeInitialStatus(getParamValue(params.status, "none"));

  const website = getParamValue(params.website, "");
  const phone = getParamValue(params.phone, "");
  const openingHours = getParamValue(params.openingHours, "");
  const editorialAwards = getParamValue(params.editorialAwards, "");
  const latitude = parseOptionalNumber(getParamValue(params.latitude, ""));
  const longitude = parseOptionalNumber(getParamValue(params.longitude, ""));
  const distanceMeters =
    parseOptionalNumber(getParamValue(params.distanceMeters, "")) ?? 0;

  const [experience, setExperience] = useState<PlaceExperience>(emptyExperience);
  const [customLists, setCustomLists] = useState<CustomList[]>([]);
  const [activeSheet, setActiveSheet] = useState<SheetType>("none");
  const [isHoursExpanded, setIsHoursExpanded] = useState(false);
  const [hasLoadedExperience, setHasLoadedExperience] = useState(false);
  const [openDataEnrichment, setOpenDataEnrichment] =
    useState<OpenDataEnrichment | null>(null);

  const [draftNote, setDraftNote] = useState("");
  const [draftOccasion, setDraftOccasion] = useState("");
  const [draftWithWho, setDraftWithWho] = useState("");
  const [draftDish, setDraftDish] = useState("");
  const [draftSpend, setDraftSpend] = useState("");
  const [draftWouldReturn, setDraftWouldReturn] = useState<boolean | null>(null);
  const [draftBadgeName, setDraftBadgeName] = useState("");
  const [draftBadgeEmoji, setDraftBadgeEmoji] = useState("✦");
  const [draftEditorialTitle, setDraftEditorialTitle] = useState("");
  const [draftEditorialSource, setDraftEditorialSource] = useState("");
  const [draftEditorialUrl, setDraftEditorialUrl] = useState("");
  const [draftListTitle, setDraftListTitle] = useState("");
  const [draftListDescription, setDraftListDescription] = useState("");
  const [draftListColor, setDraftListColor] = useState(colors.pink);
  const [draftDetailAddress, setDraftDetailAddress] = useState("");
  const [draftDetailPhone, setDraftDetailPhone] = useState("");
  const [draftDetailWebsite, setDraftDetailWebsite] = useState("");
  const [draftDetailOpeningHours, setDraftDetailOpeningHours] = useState("");
  const [draftDetailPracticalNotes, setDraftDetailPracticalNotes] = useState("");

  const score = getAverageScore(experience.scores);
  const scoreLabel = getScoreLabel(score);
  const scoreColor = getScoreColor(score);

  const enrichedWebsite = openDataEnrichment?.website || "";
  const enrichedPhone = openDataEnrichment?.phone || "";
  const enrichedOpeningHours = openDataEnrichment?.openingHours || "";
  const enrichedAddress = openDataEnrichment?.address || "";
  const routeAddress = hasUsablePlaceDetail(detail) ? detail.trim() : "";
  const automaticDetails = useMemo(
    () => ({
      address: routeAddress || enrichedAddress.trim(),
      phone: phone.trim() || enrichedPhone.trim(),
      website: website.trim() || enrichedWebsite.trim(),
      openingHours: openingHours.trim() || enrichedOpeningHours.trim(),
      practicalNotes: "",
    }),
    [
      enrichedAddress,
      enrichedOpeningHours,
      enrichedPhone,
      enrichedWebsite,
      openingHours,
      phone,
      routeAddress,
      website,
    ]
  );
  const displayDetails = useMemo(
    () => ({
      address:
        experience.personalDetails.address.trim() || automaticDetails.address,
      phone: experience.personalDetails.phone.trim() || automaticDetails.phone,
      website:
        experience.personalDetails.website.trim() || automaticDetails.website,
      openingHours:
        experience.personalDetails.openingHours.trim() ||
        automaticDetails.openingHours,
      practicalNotes: experience.personalDetails.practicalNotes.trim(),
    }),
    [automaticDetails, experience.personalDetails]
  );

  const effectiveWebsite = displayDetails.website;
  const effectivePhone = displayDetails.phone;
  const effectiveOpeningHours = displayDetails.openingHours;
  const effectiveDetail = displayDetails.address || routeAddress;

  const coverDisplayUri = experience.coverImageUri;
  const hasCover = coverDisplayUri.length > 0;
  const hasGallery = experience.galleryImageUris.length > 0;
  const hasWebsite = effectiveWebsite.length > 0;
  const hasPhone = effectivePhone.length > 0;
  const hasRealContacts = hasWebsite || hasPhone;
  const hasRealHours = effectiveOpeningHours.length > 0;
  const hasDistance = distance.trim().length > 0 && distance !== "Distanza da te";
  const infoRows = useMemo(
    () =>
      [
        { label: "Indirizzo o zona", value: displayDetails.address, symbol: "●" },
        { label: "Distanza", value: hasDistance ? distance : "", symbol: "↗" },
        { label: "Note pratiche", value: displayDetails.practicalNotes },
      ].filter((row) => row.value.trim().length > 0),
    [displayDetails.address, displayDetails.practicalNotes, distance, hasDistance]
  );

  useEffect(() => {
    let isActive = true;

    async function loadOpenDataEnrichment() {
      try {
        const enrichment = await enrichPlaceWithOpenData({
          id: placeId,
          name,
          category,
          categoryBase: category,
          detail,
          website,
          phone,
          openingHours,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        });

        if (isActive) {
          setOpenDataEnrichment(enrichment);
        }
      } catch {
        if (isActive) {
          setOpenDataEnrichment(null);
        }
      }
    }

    loadOpenDataEnrichment();

    return () => {
      isActive = false;
    };
  }, [
    category,
    detail,
    latitude,
    longitude,
    name,
    openingHours,
    phone,
    placeId,
    website,
  ]);

  const openingHoursRows = useMemo(
    () => getOpeningHoursRows(effectiveOpeningHours),
    [effectiveOpeningHours]
  );

  const visibleOpeningHoursRows = isHoursExpanded
    ? openingHoursRows
    : openingHoursRows.slice(0, 2);

  const editorialRecognitionsFromParams = useMemo(
    () => getEditorialRecognitionsFromParams(editorialAwards),
    [editorialAwards]
  );

  const allEditorialRecognitions = useMemo(
    () => [
      ...editorialRecognitionsFromParams,
      ...experience.editorialRecognitions,
    ],
    [editorialRecognitionsFromParams, experience.editorialRecognitions]
  );

  const activeStatuses = experience.statuses;

  const allBadges = useMemo(
    () => [
      ...standardBadges,
      ...experience.customBadges
        .filter(
          (customBadge) =>
            !standardBadges.some(
              (standardBadge) => standardBadge.label === customBadge.label
            )
        )
        .map((customBadge): StandardBadge => ({
          id: customBadge.id,
          label: customBadge.label,
          icon: customBadge.emoji,
          category: getBadgeCategory(customBadge.label),
          color: colors.pink,
        })),
    ],
    [experience.customBadges]
  );

  const coverBadges = experience.badges.slice(0, 3);
  const stateBadgesPreview = experience.badges.slice(0, 6);
  const customListsForPlace = customLists.filter((list) =>
    list.placeIds.includes(placeId)
  );

  const recapItems = [
    {
      id: "status",
      label: "Stato",
      value:
        activeStatuses.length > 0
          ? activeStatuses.map(getStatusLabel).join(", ")
          : "Da scegliere",
      color:
        activeStatuses.length > 0
          ? getStatusColor(activeStatuses[0])
          : colors.muted,
    },
    {
      id: "score",
      label: "Voto",
      value: score ? `${score.toFixed(1)}/10` : "Non valutato",
      color: scoreColor,
    },
    {
      id: "badges",
      label: "Badge",
      value:
        experience.badges.length > 0
          ? `${experience.badges.length} salvati`
          : "Nessuno",
      color: experience.badges.length > 0 ? colors.pink : colors.muted,
    },
    {
      id: "photos",
      label: "Foto",
      value:
        experience.galleryImageUris.length > 0
          ? `${experience.galleryImageUris.length} foto`
          : "Nessuna",
      color: experience.galleryImageUris.length > 0 ? colors.yellow : colors.muted,
    },
    {
      id: "notes",
      label: "Nota",
      value: experience.note.trim().length > 0 ? "Scritta" : "Manca",
      color: experience.note.trim().length > 0 ? colors.green : colors.muted,
    },
    {
      id: "lists",
      label: "Liste",
      value:
        customListsForPlace.length > 0
          ? `${customListsForPlace.length} liste`
          : "Nessuna",
      color: customListsForPlace.length > 0 ? colors.blue : colors.muted,
    },
  ];

  const syncGlobalStatusLists = useCallback(
    async (nextExperience: PlaceExperience) => {
      const statuses = nextExperience.statuses;
      const now = new Date().toISOString();

      for (const status of Object.keys(statusStorageKeys) as PlaceStatus[]) {
        const storageKey = statusStorageKeys[status];
        const places = await readSavedPlaces(storageKey);
        const withoutCurrentPlace = places.filter(
          (place) => place.id !== placeId
        );

        if (statuses.includes(status)) {
          const savedPlace = getCurrentPlaceSummary({
            placeId,
            name,
            category,
            detail: effectiveDetail,
            distance,
            distanceMeters,
            status,
            badges: nextExperience.badges,
            coverImageUri: nextExperience.coverImageUri,
            note: nextExperience.note,
            website: effectiveWebsite,
            phone: effectivePhone,
            openingHours: effectiveOpeningHours,
            editorialAwards,
            latitude,
            longitude,
          });

          await writeSavedPlaces(storageKey, [
            savedPlace,
            ...withoutCurrentPlace,
          ]);
        } else {
          await writeSavedPlaces(storageKey, withoutCurrentPlace);
        }
      }

      const placesIndex = await readPlacesIndex();
      const withoutCurrentPlace = placesIndex.filter(
        (place) => place.id !== placeId
      );

      if (statuses.length === 0) {
        await writePlacesIndex(withoutCurrentPlace);
        return;
      }

      const primaryStatus = statuses[0];
      const indexedPlace: PlacesIndexItem = {
        ...getCurrentPlaceSummary({
          placeId,
          name,
          category,
          detail: effectiveDetail,
          distance,
          distanceMeters,
          status: primaryStatus,
          badges: nextExperience.badges,
          coverImageUri: nextExperience.coverImageUri,
          note: nextExperience.note,
          website: effectiveWebsite,
          phone: effectivePhone,
          openingHours: effectiveOpeningHours,
          editorialAwards,
          latitude,
          longitude,
        }),
        badges: nextExperience.badges,
        coverImageUri: nextExperience.coverImageUri,
        note: nextExperience.note,
        statuses,
        updatedAt: now,
      };

      await writePlacesIndex([indexedPlace, ...withoutCurrentPlace]);
    },
    [
      category,
      distance,
      distanceMeters,
      editorialAwards,
      effectiveDetail,
      effectiveOpeningHours,
      effectivePhone,
      effectiveWebsite,
      latitude,
      longitude,
      name,
      placeId,
    ]
  );

  useEffect(() => {
    let isActive = true;
    setHasLoadedExperience(false);

    async function load() {
      const storedState = await readExperienceState(placeId);
      const globalStatuses = await readGlobalStatuses(placeId);
      const storedLists = await readCustomLists();

      const mergedStatusSet = new Set<PlaceStatus>([
        ...storedState.experience.statuses,
        ...globalStatuses,
      ]);

      if (!storedState.exists && globalStatuses.length === 0 && initialStatus) {
        mergedStatusSet.add(initialStatus);
      }

      const nextExperience = {
        ...storedState.experience,
        statuses: Array.from(mergedStatusSet),
      };

      if (!isActive) return;

      setExperience(nextExperience);
      setDraftNote(nextExperience.note);
      setCustomLists(storedLists);
      setHasLoadedExperience(true);

      await writeExperience(placeId, nextExperience);
    }

    load();

    return () => {
      isActive = false;
    };
  }, [placeId, initialStatus]);

  useEffect(() => {
    if (!hasLoadedExperience) return;

    syncGlobalStatusLists(experience);
  }, [experience, hasLoadedExperience, syncGlobalStatusLists]);

  async function refreshCustomLists() {
    const lists = await readCustomLists();
    setCustomLists(lists);
  }

  async function saveExperience(nextExperience: PlaceExperience) {
    setExperience(nextExperience);
    await writeExperience(placeId, nextExperience);
    await syncGlobalStatusLists(nextExperience);
  }

  async function saveCustomLists(nextLists: CustomList[]) {
    setCustomLists(nextLists);
    await writeCustomLists(nextLists);
  }

  function handleBackPress() {
    if (activeSheet !== "none") {
      setActiveSheet("none");
      return;
    }

    try {
      if (router.canGoBack()) {
        router.back();
        return;
      }

      router.replace("/(tabs)" as never);
    } catch {
      router.replace("/(tabs)" as never);
    }
  }

  function openSheet(sheet: SheetType) {
    if (sheet === "note") {
      setDraftNote(experience.note);
    }

    if (sheet === "customLists") {
      refreshCustomLists();
    }

    if (sheet === "details") {
      setDraftDetailAddress(displayDetails.address);
      setDraftDetailPhone(displayDetails.phone);
      setDraftDetailWebsite(displayDetails.website);
      setDraftDetailOpeningHours(displayDetails.openingHours);
      setDraftDetailPracticalNotes(displayDetails.practicalNotes);
    }

    setActiveSheet(sheet);
  }

  function closeSheet() {
    setActiveSheet("none");
  }

  async function toggleStatus(status: PlaceStatus) {
    const isActive = activeStatuses.includes(status);

    const nextStatuses = isActive
      ? activeStatuses.filter((item) => item !== status)
      : [...activeStatuses, status];

    await saveExperience({
      ...experience,
      statuses: nextStatuses,
    });
  }

  async function toggleBadge(badge: string) {
    const isActive = experience.badges.includes(badge);

    await saveExperience({
      ...experience,
      badges: isActive
        ? experience.badges.filter((item) => item !== badge)
        : [...experience.badges, badge],
    });
  }

  async function toggleCustomList(listId: string) {
    const nextLists = customLists.map((list) => {
      if (list.id !== listId) return list;

      const isSaved = list.placeIds.includes(placeId);

      return {
        ...list,
        placeIds: isSaved
          ? list.placeIds.filter((id) => id !== placeId)
          : [placeId, ...list.placeIds],
      };
    });

    await saveCustomLists(nextLists);
  }

  async function createCustomList() {
    const title = draftListTitle.trim();

    if (!title) return;

    const newList: CustomList = {
      id: createId(),
      title,
      description: draftListDescription.trim(),
      color: draftListColor,
      placeIds: [placeId],
      createdAt: new Date().toISOString(),
    };

    await saveCustomLists([newList, ...customLists]);

    setDraftListTitle("");
    setDraftListDescription("");
    setDraftListColor(colors.pink);
  }

  async function updateScore(key: ScoreKey, value: number) {
    await saveExperience({
      ...experience,
      scores: {
        ...experience.scores,
        [key]: experience.scores[key] === value ? 0 : value,
      },
    });
  }

  async function saveNote() {
    await saveExperience({
      ...experience,
      note: draftNote,
    });

    closeSheet();
  }

  async function savePersonalDetails() {
    await saveExperience({
      ...experience,
      personalDetails: {
        address: draftDetailAddress.trim(),
        phone: draftDetailPhone.trim(),
        website: draftDetailWebsite.trim(),
        openingHours: draftDetailOpeningHours.trim(),
        practicalNotes: draftDetailPracticalNotes.trim(),
      },
    });

    closeSheet();
  }

  async function saveExperienceEntry() {
    const entry: ExperienceEntry = {
      id: createId(),
      occasion: draftOccasion.trim(),
      withWho: draftWithWho.trim(),
      dish: draftDish.trim(),
      spend: draftSpend.trim(),
      wouldReturn: draftWouldReturn,
      createdAt: new Date().toISOString(),
    };

    await saveExperience({
      ...experience,
      experiences: [entry, ...experience.experiences],
    });

    setDraftOccasion("");
    setDraftWithWho("");
    setDraftDish("");
    setDraftSpend("");
    setDraftWouldReturn(null);
    closeSheet();
  }

  async function createCustomBadge() {
    const label = draftBadgeName.trim();

    if (!label) return;

    const newBadge: CustomBadge = {
      id: createId(),
      label,
      emoji: draftBadgeEmoji,
    };

    await saveExperience({
      ...experience,
      customBadges: [newBadge, ...experience.customBadges],
      badges: experience.badges.includes(label)
        ? experience.badges
        : [label, ...experience.badges],
    });

    setDraftBadgeName("");
    setDraftBadgeEmoji("✦");
    closeSheet();
  }

  async function createEditorialRecognition() {
    const title = draftEditorialTitle.trim();
    const source = draftEditorialSource.trim();
    const url = draftEditorialUrl.trim();

    if (!title) return;

    const newRecognition: EditorialRecognition = {
      id: createId(),
      title,
      source: source || "Aggiunto da te",
      url,
      createdAt: new Date().toISOString(),
      isUserAdded: true,
    };

    await saveExperience({
      ...experience,
      editorialRecognitions: [
        newRecognition,
        ...experience.editorialRecognitions,
      ],
    });

    setDraftEditorialTitle("");
    setDraftEditorialSource("");
    setDraftEditorialUrl("");
    closeSheet();
  }

  async function pickGalleryImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permesso necessario",
        "Per aggiungere foto, Mellory ha bisogno di accedere alla tua galleria."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: 8,
    });

    if (result.canceled) return;

    const selectedUris = result.assets
      .map((asset) => asset.uri)
      .filter((uri): uri is string => typeof uri === "string" && uri.length > 0);

    if (selectedUris.length === 0) return;

    const nextGallery = [
      ...selectedUris,
      ...experience.galleryImageUris,
    ].filter((uri, index, list) => list.indexOf(uri) === index);

    await saveExperience({
      ...experience,
      coverImageUri: experience.coverImageUri || selectedUris[0],
      galleryImageUris: nextGallery.slice(0, 12),
    });
  }

  async function setCover(imageUri: string) {
    await saveExperience({
      ...experience,
      coverImageUri: imageUri,
    });
  }

  async function removeGalleryImage(imageUri: string) {
    const nextGallery = experience.galleryImageUris.filter((uri) => uri !== imageUri);
    const nextCover =
      experience.coverImageUri === imageUri
        ? nextGallery[0] || ""
        : experience.coverImageUri;

    await saveExperience({
      ...experience,
      galleryImageUris: nextGallery,
      coverImageUri: nextCover,
    });
  }

  function openMaps() {
    const query = encodeURIComponent(`${name} ${displayDetails.address}`);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  }

  function openWebsite() {
    const normalizedWebsite = normalizeUrl(effectiveWebsite);

    if (!normalizedWebsite) return;

    Linking.openURL(normalizedWebsite);
  }

  function callPhone() {
    const cleanPhone = effectivePhone.trim();

    if (!cleanPhone) return;

    Linking.openURL(`tel:${cleanPhone}`);
  }

  function openEditorialRecognition(recognition: EditorialRecognition) {
    const normalizedUrl = normalizeUrl(recognition.url);

    if (normalizedUrl) {
      Linking.openURL(normalizedUrl);
      return;
    }

    const query = encodeURIComponent(`${name} ${recognition.title}`);
    Linking.openURL(`https://www.google.com/search?q=${query}`);
  }

  function renderSheetContent() {
    if (activeSheet === "lists") {
      return (
        <>
          <SheetHeader title="Le tue liste" onClose={closeSheet} />

          <Text style={styles.sheetDescription}>
            Scegli dove salvare questo locale. Tocca di nuovo una lista attiva per
            rimuoverlo.
          </Text>

          {listOptions.map((option) => {
            const isActive = activeStatuses.includes(option.status);

            return (
              <View key={option.status} style={styles.listOption}>
                <View
                  style={[
                    styles.listOptionIcon,
                    { backgroundColor: `${option.color}26` },
                  ]}
                >
                  <Text style={[styles.listOptionIconText, { color: option.color }]}>
                    {option.emoji}
                  </Text>
                </View>

                <View style={styles.listOptionTextBlock}>
                  <Text style={styles.listOptionTitle}>{option.title}</Text>
                  <Text style={styles.listOptionText}>{option.text}</Text>
                </View>

                <PressableScale
                  style={[
                    styles.listOptionButton,
                    isActive && styles.listOptionButtonActive,
                  ]}
                  onPress={() => toggleStatus(option.status)}
                >
                  <Text style={styles.listOptionButtonText}>
                    {isActive ? "✓" : "+"}
                  </Text>
                </PressableScale>
              </View>
            );
          })}

          <PressableScale
            style={styles.secondarySheetButton}
            onPress={() => openSheet("customLists")}
          >
            <Text style={styles.secondarySheetButtonText}>
              Gestisci liste personalizzate
            </Text>
          </PressableScale>

          <PressableScale style={styles.sheetPrimaryButton} onPress={closeSheet}>
            <Text style={styles.sheetPrimaryButtonText}>Salva liste</Text>
          </PressableScale>
        </>
      );
    }

    if (activeSheet === "customLists") {
      return (
        <>
          <SheetHeader title="Liste personalizzate" onClose={closeSheet} />

          <Text style={styles.sheetDescription}>
            Crea raccolte tue, come “Roma weekend”, “Cene romantiche” o “Posti con
            vista”. Le ritroverai anche in My Mellory.
          </Text>

          <View style={styles.createListBox}>
            <Text style={styles.sheetSmallTitle}>Nuova lista</Text>

            <TextInput
              value={draftListTitle}
              onChangeText={setDraftListTitle}
              placeholder="Nome lista"
              placeholderTextColor={colors.muted}
              style={styles.sheetInput}
            />

            <TextInput
              value={draftListDescription}
              onChangeText={setDraftListDescription}
              placeholder="Descrizione opzionale"
              placeholderTextColor={colors.muted}
              style={styles.sheetInput}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.colorPickerRow}
            >
              {customListColors.map((color) => (
                <PressableScale
                  key={color}
                  style={[
                    styles.colorPickerDot,
                    { backgroundColor: color },
                    draftListColor === color && styles.colorPickerDotActive,
                  ]}
                  onPress={() => setDraftListColor(color)}
                />
              ))}
            </ScrollView>

            <PressableScale style={styles.sheetPrimaryButton} onPress={createCustomList}>
              <Text style={styles.sheetPrimaryButtonText}>
                Crea lista e salva locale
              </Text>
            </PressableScale>
          </View>

          <Text style={styles.sheetSmallTitle}>Le tue liste</Text>

          {customLists.length === 0 ? (
            <View style={styles.emptySheetCard}>
              <Text style={styles.emptySheetTitle}>Nessuna lista creata.</Text>
              <Text style={styles.emptySheetText}>
                Crea la prima lista personalizzata per iniziare a organizzare i tuoi
                posti.
              </Text>
            </View>
          ) : (
            <View style={styles.customListStack}>
              {customLists.map((list) => {
                const isSaved = list.placeIds.includes(placeId);

                return (
                  <PressableScale
                    key={list.id}
                    style={[
                      styles.customListCard,
                      isSaved && {
                        borderColor: `${list.color}88`,
                        backgroundColor: `${list.color}18`,
                      },
                    ]}
                    onPress={() => toggleCustomList(list.id)}
                  >
                    <View
                      style={[
                        styles.customListColor,
                        { backgroundColor: list.color },
                      ]}
                    />

                    <View style={styles.customListBody}>
                      <Text style={styles.customListTitle}>{list.title}</Text>
                      <Text numberOfLines={2} style={styles.customListDescription}>
                        {list.description || `${list.placeIds.length} locali salvati`}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.customListCheck,
                        isSaved && styles.customListCheckActive,
                      ]}
                    >
                      <Text style={styles.customListCheckText}>
                        {isSaved ? "✓" : "+"}
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          )}

          <PressableScale style={styles.sheetPrimaryButton} onPress={closeSheet}>
            <Text style={styles.sheetPrimaryButtonText}>Fatto</Text>
          </PressableScale>
        </>
      );
    }

    if (activeSheet === "note") {
      return (
        <>
          <SheetHeader title="Nuova nota" onClose={closeSheet} />

          <TextInput
            value={draftNote}
            onChangeText={setDraftNote}
            placeholder="Scrivi cosa ricordare di questo posto..."
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            style={styles.sheetTextArea}
          />

          <Text style={styles.sheetSmallTitle}>Badge rapidi</Text>

          <View style={styles.compactBadgeWrap}>
            {standardBadges.slice(0, 8).map((badge) => {
              const isActive = experience.badges.includes(badge.label);

              return (
                <PressableScale
                  key={badge.id}
                  style={[
                    styles.compactBadgeChip,
                    isActive && styles.compactBadgeChipActive,
                  ]}
                  onPress={() => toggleBadge(badge.label)}
                >
                  <View
                    style={[
                      styles.compactBadgeIconBox,
                      { backgroundColor: `${badge.color}24` },
                      isActive && { backgroundColor: badge.color },
                    ]}
                  >
                    <Text
                      style={[
                        styles.compactBadgeIcon,
                        { color: badge.color },
                        isActive && styles.compactBadgeIconActive,
                      ]}
                    >
                      {badge.icon}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.compactBadgeText,
                      isActive && styles.compactBadgeTextActive,
                    ]}
                  >
                    {badge.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          <PressableScale style={styles.sheetPrimaryButton} onPress={saveNote}>
            <Text style={styles.sheetPrimaryButtonText}>Salva nota</Text>
          </PressableScale>
        </>
      );
    }

    if (activeSheet === "details") {
      return (
        <>
          <SheetHeader title="Info del posto" onClose={closeSheet} />

          <InputLabel label="Indirizzo" />
          <TextInput
            value={draftDetailAddress}
            onChangeText={setDraftDetailAddress}
            placeholder="Via, zona o riferimento"
            placeholderTextColor={colors.muted}
            style={styles.sheetInput}
          />

          <InputLabel label="Telefono" />
          <TextInput
            value={draftDetailPhone}
            onChangeText={setDraftDetailPhone}
            placeholder="Numero"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            style={styles.sheetInput}
          />

          <InputLabel label="Sito" />
          <TextInput
            value={draftDetailWebsite}
            onChangeText={setDraftDetailWebsite}
            placeholder="sito.it"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="url"
            style={styles.sheetInput}
          />

          <InputLabel label="Orari" />
          <TextInput
            value={draftDetailOpeningHours}
            onChangeText={setDraftDetailOpeningHours}
            placeholder="Lun-Ven 09:00-20:00"
            placeholderTextColor={colors.muted}
            style={styles.sheetInput}
          />

          <InputLabel label="Note pratiche" />
          <TextInput
            value={draftDetailPracticalNotes}
            onChangeText={setDraftDetailPracticalNotes}
            placeholder="Prenotazione, tavolo migliore, ingresso..."
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            style={styles.sheetTextArea}
          />

          <PressableScale style={styles.sheetPrimaryButton} onPress={savePersonalDetails}>
            <Text style={styles.sheetPrimaryButtonText}>Salva info</Text>
          </PressableScale>
        </>
      );
    }

    if (activeSheet === "experience") {
      return (
        <>
          <SheetHeader title="Aggiungi esperienza" onClose={closeSheet} />

          <InputLabel label="Occasione" />
          <TextInput
            value={draftOccasion}
            onChangeText={setDraftOccasion}
            placeholder="Cena di compleanno, pranzo veloce..."
            placeholderTextColor={colors.muted}
            style={styles.sheetInput}
          />

          <InputLabel label="Con chi" />
          <TextInput
            value={draftWithWho}
            onChangeText={setDraftWithWho}
            placeholder="Con amici, coppia, famiglia..."
            placeholderTextColor={colors.muted}
            style={styles.sheetInput}
          />

          <InputLabel label="Piatto migliore" />
          <TextInput
            value={draftDish}
            onChangeText={setDraftDish}
            placeholder="Cosa ti è piaciuto di più?"
            placeholderTextColor={colors.muted}
            style={styles.sheetInput}
          />

          <InputLabel label="Spesa indicativa" />
          <TextInput
            value={draftSpend}
            onChangeText={setDraftSpend}
            placeholder="65"
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
            style={styles.sheetInput}
          />

          <View style={styles.returnRow}>
            <PressableScale
              style={[
                styles.returnButton,
                draftWouldReturn === true && styles.returnButtonActive,
              ]}
              onPress={() => setDraftWouldReturn(true)}
            >
              <Text
                style={[
                  styles.returnButtonText,
                  draftWouldReturn === true && styles.returnButtonTextActive,
                ]}
              >
                Tornerei
              </Text>
            </PressableScale>

            <PressableScale
              style={[
                styles.returnButton,
                draftWouldReturn === false && styles.returnButtonActive,
              ]}
              onPress={() => setDraftWouldReturn(false)}
            >
              <Text
                style={[
                  styles.returnButtonText,
                  draftWouldReturn === false && styles.returnButtonTextActive,
                ]}
              >
                Non tornerei
              </Text>
            </PressableScale>
          </View>

          <PressableScale style={styles.sheetPrimaryButton} onPress={saveExperienceEntry}>
            <Text style={styles.sheetPrimaryButtonText}>Salva esperienza</Text>
          </PressableScale>
        </>
      );
    }

    if (activeSheet === "badges") {
      return (
        <>
          <SheetHeader title="Gestisci badge" onClose={closeSheet} />

          <Text style={styles.sheetDescription}>
            I badge raccontano il tuo stato personale del locale: atmosfera,
            occasione e motivi per cui vuoi ricordarlo.
          </Text>

          <View style={styles.badgeLibrary}>
            {allBadges.map((badge) => {
              const isActive = experience.badges.includes(badge.label);

              return (
                <PressableScale
                  key={badge.id}
                  style={[
                    styles.editorialBadge,
                    isActive && styles.editorialBadgeActive,
                  ]}
                  onPress={() => toggleBadge(badge.label)}
                >
                  <View
                    style={[
                      styles.editorialBadgeIconBox,
                      { backgroundColor: `${badge.color}24` },
                      isActive && { backgroundColor: badge.color },
                    ]}
                  >
                    <Text
                      style={[
                        styles.editorialBadgeIcon,
                        { color: badge.color },
                        isActive && styles.editorialBadgeIconActive,
                      ]}
                    >
                      {badge.icon}
                    </Text>
                  </View>

                  <View style={styles.editorialBadgeTextBlock}>
                    <Text
                      style={[
                        styles.editorialBadgeTitle,
                        isActive && styles.editorialBadgeTitleActive,
                      ]}
                    >
                      {badge.label}
                    </Text>

                    <Text style={styles.editorialBadgeCategory}>
                      {badge.category}
                    </Text>
                  </View>

                  {isActive && <Text style={styles.editorialBadgeCheck}>✓</Text>}
                </PressableScale>
              );
            })}
          </View>

          <View style={styles.createBadgeBox}>
            <Text style={styles.sheetSmallTitle}>Crea badge personale</Text>

            <TextInput
              value={draftBadgeName}
              onChangeText={setDraftBadgeName}
              placeholder="es. vista mozzafiato"
              placeholderTextColor={colors.muted}
              style={styles.sheetInput}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.emojiRow}
            >
              {badgeEmojis.map((emoji) => (
                <PressableScale
                  key={emoji}
                  style={[
                    styles.emojiButton,
                    draftBadgeEmoji === emoji && styles.emojiButtonActive,
                  ]}
                  onPress={() => setDraftBadgeEmoji(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </PressableScale>
              ))}
            </ScrollView>

            <PressableScale style={styles.sheetPrimaryButton} onPress={createCustomBadge}>
              <Text style={styles.sheetPrimaryButtonText}>Crea e assegna badge</Text>
            </PressableScale>
          </View>
        </>
      );
    }

    if (activeSheet === "gallery") {
      const coverUri = experience.coverImageUri || experience.galleryImageUris[0] || "";

      return (
        <>
          <SheetHeader title="Gestisci foto" onClose={closeSheet} />

          <Text style={styles.sheetDescription}>
            Scegli una copertina chiara e conserva solo le immagini che vuoi davvero
            ritrovare.
          </Text>

          <PressableScale style={styles.sheetPrimaryButton} onPress={pickGalleryImage}>
            <Text style={styles.sheetPrimaryButtonText}>Aggiungi nuove foto</Text>
          </PressableScale>

          {experience.galleryImageUris.length === 0 ? (
            <View style={styles.galleryEmptySheet}>
              <Text style={styles.galleryEmptySheetIcon}>▧</Text>
              <Text style={styles.galleryEmptySheetTitle}>
                Nessuna foto salvata.
              </Text>
              <Text style={styles.galleryEmptySheetText}>
                La prima foto aggiunta diventerà automaticamente la copertina.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.coverManagerCard}>
                <Image source={{ uri: coverUri }} style={styles.coverManagerImage} />

                <View style={styles.coverManagerOverlay}>
                  <View>
                    <Text style={styles.coverManagerKicker}>COPERTINA ATTUALE</Text>
                    <Text numberOfLines={1} style={styles.coverManagerTitle}>
                      {name}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.sheetSmallTitle}>Foto salvate</Text>

              <View style={styles.galleryGrid}>
                {experience.galleryImageUris.map((imageUri) => {
                  const isCover = experience.coverImageUri === imageUri;

                  return (
                    <View key={imageUri} style={styles.sheetGalleryItem}>
                      <Image
                        source={{ uri: imageUri }}
                        style={styles.sheetGalleryImage}
                      />

                      {isCover && (
                        <View style={styles.galleryCoverFlag}>
                          <Text style={styles.galleryCoverFlagText}>Copertina</Text>
                        </View>
                      )}

                      <View style={styles.galleryImageActions}>
                        <PressableScale
                          style={[
                            styles.coverSelectButton,
                            isCover && styles.coverSelectButtonActive,
                          ]}
                          onPress={() => setCover(imageUri)}
                        >
                          <Text
                            style={[
                              styles.coverSelectButtonText,
                              isCover && styles.coverSelectButtonTextActive,
                            ]}
                          >
                            {isCover ? "Attiva" : "Usa"}
                          </Text>
                        </PressableScale>

                        <PressableScale
                          style={styles.removeImageButton}
                          onPress={() => removeGalleryImage(imageUri)}
                        >
                          <Text style={styles.removeImageText}>Elimina</Text>
                        </PressableScale>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </>
      );
    }

    if (activeSheet === "editorial") {
      return (
        <>
          <SheetHeader title="Aggiungi riconoscimento" onClose={closeSheet} />

          <Text style={styles.sheetDescription}>
            Aggiungi solo riconoscimenti reali che vuoi conservare nella tua scheda.
          </Text>

          <InputLabel label="Riconoscimento" />
          <TextInput
            value={draftEditorialTitle}
            onChangeText={setDraftEditorialTitle}
            placeholder="es. Guida Michelin, Gambero Rosso..."
            placeholderTextColor={colors.muted}
            style={styles.sheetInput}
          />

          <InputLabel label="Fonte" />
          <TextInput
            value={draftEditorialSource}
            onChangeText={setDraftEditorialSource}
            placeholder="Nome guida, articolo, rivista..."
            placeholderTextColor={colors.muted}
            style={styles.sheetInput}
          />

          <InputLabel label="Link opzionale" />
          <TextInput
            value={draftEditorialUrl}
            onChangeText={setDraftEditorialUrl}
            placeholder="https://..."
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="url"
            style={styles.sheetInput}
          />

          <PressableScale
            style={styles.sheetPrimaryButton}
            onPress={createEditorialRecognition}
          >
            <Text style={styles.sheetPrimaryButtonText}>Salva riconoscimento</Text>
          </PressableScale>
        </>
      );
    }

    return null;
  }

  return (
    <View style={styles.root}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.safeTop} />

        <View style={styles.coverCard}>
          {hasCover ? (
            <Image source={{ uri: coverDisplayUri }} style={styles.coverImage} />
          ) : (
            <View style={styles.coverPlaceholder}>
              <View style={styles.coverOrbLarge} />
              <View style={styles.coverOrbSmall} />
              <View style={styles.coverLineOne} />
              <View style={styles.coverLineTwo} />
              <Text style={styles.coverInitial}>{getInitial(name)}</Text>
              <Text style={styles.coverMonogramLabel}>MELLORY</Text>
            </View>
          )}

          <View style={styles.coverOverlay} />

          <View style={styles.coverHeader}>
            <PressableScale style={styles.roundBackButton} onPress={handleBackPress}>
              <Text style={styles.roundBackText}>‹</Text>
            </PressableScale>

            <PressableScale
              style={styles.coverPhotoButton}
              onPress={() => openSheet("gallery")}
            >
              <View style={styles.coverPhotoIconFrame}>
                <View style={styles.coverPhotoIconHorizon} />
                <View style={styles.coverPhotoIconSun} />
              </View>
              <Text style={styles.coverPhotoButtonText}>Foto</Text>
            </PressableScale>
          </View>

          <View style={styles.coverBottom}>
            <Text style={styles.placeArea}>{category.toUpperCase()}</Text>

            <Text numberOfLines={2} style={styles.placeTitle}>
              {name}
            </Text>

            <Text numberOfLines={1} style={styles.placeAddress}>
              {effectiveDetail}
            </Text>

            {coverBadges.length > 0 && (
              <View style={styles.coverBadgeRow}>
                {coverBadges.map((badge) => (
                  <View key={badge} style={styles.coverBadgeChip}>
                    <View
                      style={[
                        styles.coverBadgeDot,
                        { backgroundColor: getBadgeColor(badge) },
                      ]}
                    >
                      <Text style={styles.coverBadgeIcon}>
                        {getBadgeIcon(badge, experience.customBadges)}
                      </Text>
                    </View>

                    <Text style={styles.coverBadgeChipText}>{badge}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        <View style={styles.mainPanel}>
          <View style={styles.recapPanel}>
            <View style={styles.recapHeader}>
              <View style={styles.recapTitleBlock}>
                <Text style={styles.recapKicker}>RECAP PERSONALE</Text>

                <Text style={styles.recapTitle}>Tutto a colpo d’occhio</Text>

                <Text style={styles.recapSubtitle}>
                  Una sintesi chiara e discreta di quello che hai già salvato su
                  questo locale.
                </Text>
              </View>
            </View>

            <View style={styles.recapGrid}>
              {recapItems.map((item) => (
                <View key={item.id} style={styles.recapItem}>
                  <View style={styles.recapItemTop}>
                    <View
                      style={[
                        styles.recapDot,
                        {
                          backgroundColor: item.color,
                        },
                      ]}
                    />

                    <Text style={styles.recapItemLabel}>{item.label}</Text>
                  </View>

                  <Text numberOfLines={1} style={styles.recapItemValue}>
                    {item.value}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={styles.sectionKickerStandalone}>IL TUO STATO</Text>

          <View style={styles.statusGrid}>
            {listOptions.map((option) => {
              const isActive = activeStatuses.includes(option.status);

              return (
                <PressableScale
                  key={option.status}
                  style={[
                    styles.statusChip,
                    isActive && {
                      backgroundColor: `${option.color}22`,
                      borderColor: `${option.color}88`,
                    },
                  ]}
                  onPress={() => toggleStatus(option.status)}
                >
                  <View
                    style={[
                      styles.statusIconBubble,
                      { backgroundColor: `${option.color}24` },
                      isActive && { backgroundColor: option.color },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusIconText,
                        { color: option.color },
                        isActive && styles.statusIconTextActive,
                      ]}
                    >
                      {option.emoji}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.statusChipText,
                      isActive && styles.statusChipTextActive,
                    ]}
                  >
                    {option.title}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          <View style={styles.stateBadgePanel}>
            <View style={styles.stateBadgeHeader}>
              <View>
                <Text style={styles.stateBadgeKicker}>BADGE DEL POSTO</Text>
                <Text style={styles.stateBadgeTitle}>
                  {experience.badges.length > 0
                    ? "I tratti che vuoi ricordare"
                    : "Aggiungi atmosfera e contesto"}
                </Text>
              </View>

              <PressableScale
                style={styles.stateBadgeButton}
                onPress={() => openSheet("badges")}
              >
                <Text style={styles.stateBadgeButtonText}>
                  {experience.badges.length > 0 ? "Gestisci" : "Aggiungi"}
                </Text>
              </PressableScale>
            </View>

            {experience.badges.length > 0 ? (
              <View style={styles.stateBadgeList}>
                {stateBadgesPreview.map((badge) => (
                  <PressableScale
                    key={badge}
                    style={styles.stateBadgeChip}
                    onPress={() => toggleBadge(badge)}
                  >
                    <View
                      style={[
                        styles.stateBadgeIconBox,
                        { backgroundColor: `${getBadgeColor(badge)}26` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stateBadgeIcon,
                          { color: getBadgeColor(badge) },
                        ]}
                      >
                        {getBadgeIcon(badge, experience.customBadges)}
                      </Text>
                    </View>

                    <View style={styles.stateBadgeTextBlock}>
                      <Text style={styles.stateBadgeName}>{badge}</Text>
                      <Text style={styles.stateBadgeCategory}>
                        {getBadgeCategory(badge)}
                      </Text>
                    </View>
                  </PressableScale>
                ))}
              </View>
            ) : (
              <Text style={styles.stateBadgeEmptyText}>
                Usa badge piccoli e colorati per segnare se il posto è romantico,
                gourmet, da amici, di design o da ricordare per un motivo preciso.
              </Text>
            )}
          </View>

          <View style={styles.customListsPanel}>
            <View style={styles.stateBadgeHeader}>
              <View>
                <Text style={styles.stateBadgeKicker}>LISTE PERSONALIZZATE</Text>
                <Text style={styles.stateBadgeTitle}>
                  {customListsForPlace.length > 0
                    ? "Salvato nelle tue raccolte"
                    : "Organizzalo a modo tuo"}
                </Text>
              </View>

              <PressableScale
                style={styles.stateBadgeButton}
                onPress={() => openSheet("customLists")}
              >
                <Text style={styles.stateBadgeButtonText}>
                  {customListsForPlace.length > 0 ? "Gestisci" : "Crea"}
                </Text>
              </PressableScale>
            </View>

            {customListsForPlace.length > 0 ? (
              <View style={styles.savedCustomListWrap}>
                {customListsForPlace.map((list) => (
                  <View key={list.id} style={styles.savedCustomListChip}>
                    <View
                      style={[
                        styles.savedCustomListDot,
                        { backgroundColor: list.color },
                      ]}
                    />
                    <Text style={styles.savedCustomListText}>{list.title}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.stateBadgeEmptyText}>
                Crea liste come “Cene romantiche”, “Da provare a Milano” o
                “Weekend perfetto”.
              </Text>
            )}
          </View>

          <View style={styles.actionGrid}>
            <ActionBox symbol="☰" label="Liste" onPress={() => openSheet("lists")} />
            <ActionBox symbol="✎" label="Nota" onPress={() => openSheet("note")} />
            <ActionBox
              symbol="▣"
              label="Esperienza"
              onPress={() => openSheet("experience")}
            />
            <ActionBox symbol="➤" label="Naviga" onPress={openMaps} />
          </View>

          <Section
            title="INFO DEL POSTO"
            actionLabel={infoRows.length > 0 ? "Modifica" : undefined}
            onAction={infoRows.length > 0 ? () => openSheet("details") : undefined}
          >
            {infoRows.length > 0 ? (
              <View style={styles.infoCard}>
                {infoRows.map((row, index) => (
                  <View key={row.label}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    {row.symbol ? (
                      <InfoRow
                        title={row.label}
                        value={row.value}
                        symbol={row.symbol}
                      />
                    ) : (
                      <View style={styles.personalDetailRow}>
                        <Text style={styles.personalDetailLabel}>{row.label}</Text>
                        <Text style={styles.personalDetailValue}>{row.value}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <PressableScale
                style={styles.addDetailsButton}
                onPress={() => openSheet("details")}
              >
                <Text style={styles.addDetailsButtonText}>Aggiungi info</Text>
              </PressableScale>
            )}
          </Section>

          <Section
            title="ORARI"
            actionLabel={hasRealHours ? "Modifica" : undefined}
            onAction={hasRealHours ? () => openSheet("details") : undefined}
          >
            {hasRealHours ? (
              <View style={styles.hoursCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.hoursTitle}>Orari</Text>
                  <View style={styles.openDot} />
                </View>

                <View style={styles.hoursRows}>
                  {visibleOpeningHoursRows.map((row) => (
                    <Text key={row} style={styles.hoursText}>
                      {row}
                    </Text>
                  ))}
                </View>

                {openingHoursRows.length > 2 && (
                  <PressableScale
                    style={styles.weekButton}
                    onPress={() => setIsHoursExpanded((value) => !value)}
                  >
                    <Text style={styles.weekLink}>
                      {isHoursExpanded ? "RIDUCI" : "VEDI SETTIMANA"}
                    </Text>
                  </PressableScale>
                )}
              </View>
            ) : (
              <PressableScale
                style={styles.addDetailsButton}
                onPress={() => openSheet("details")}
              >
                <Text style={styles.addDetailsButtonText}>Aggiungi orari</Text>
              </PressableScale>
            )}
          </Section>

          <Section
            title="CONTATTI"
            actionLabel={hasRealContacts ? "Modifica" : undefined}
            onAction={hasRealContacts ? () => openSheet("details") : undefined}
          >
            {hasRealContacts ? (
              <View style={styles.contactRow}>
                {hasPhone && (
                  <PressableScale style={styles.contactChipMuted} onPress={callPhone}>
                    <Text style={styles.contactChipMutedText}>Telefono</Text>
                  </PressableScale>
                )}

                {hasWebsite && (
                  <PressableScale style={styles.contactChip} onPress={openWebsite}>
                    <Text style={styles.contactChipText}>Sito</Text>
                  </PressableScale>
                )}
              </View>
            ) : (
              <PressableScale
                style={styles.addDetailsButton}
                onPress={() => openSheet("details")}
              >
                <Text style={styles.addDetailsButtonText}>Aggiungi contatti</Text>
              </PressableScale>
            )}
          </Section>

          <Section
            title="LA TUA GALLERIA"
            actionLabel="Gestisci foto"
            onAction={() => openSheet("gallery")}
          >
            {hasGallery ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.galleryPreviewRow}
              >
                <PressableScale style={styles.galleryAddMini} onPress={pickGalleryImage}>
                  <Text style={styles.galleryAddMiniText}>＋</Text>
                </PressableScale>

                {experience.galleryImageUris.slice(0, 6).map((imageUri) => (
                  <PressableScale key={imageUri} onPress={() => setCover(imageUri)}>
                    <Image
                      source={{ uri: imageUri }}
                      style={[
                        styles.galleryPreviewImage,
                        experience.coverImageUri === imageUri &&
                          styles.galleryPreviewImageActive,
                      ]}
                    />
                  </PressableScale>
                ))}
              </ScrollView>
            ) : (
              <PressableScale style={styles.emptyActionCard} onPress={pickGalleryImage}>
                <Text style={styles.emptyActionTitle}>Aggiungi foto</Text>
                <Text style={styles.emptyActionText}>
                  Salva immagini del locale e scegli quella da usare come
                  copertina.
                </Text>
              </PressableScale>
            )}
          </Section>

          <Section title="LA TUA VALUTAZIONE">
            <Text style={styles.scoreIntro}>
              Vota per categoria. La media diventa il tuo Mellory Score.
            </Text>

            <View style={styles.scoreCard}>
              <SmoothScoreCircle
                key={`score-${scoreColor}-${score ?? "empty"}`}
                score={score}
                label={scoreLabel}
                color={scoreColor}
              />
            </View>

            {scoreRows.map((row) => (
              <View key={row.key} style={styles.scoreRow}>
                <Text style={styles.scoreRowLabel}>{row.label}</Text>

                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((value) => {
                    const isActive = experience.scores[row.key] >= value;

                    return (
                      <PressableScale
                        key={value}
                        onPress={() => updateScore(row.key, value)}
                      >
                        <Text style={[styles.star, isActive && styles.starActive]}>
                          ★
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
              </View>
            ))}
          </Section>

          <Section
            title="LE TUE NOTE"
            actionLabel="Scrivi nota"
            onAction={() => openSheet("note")}
          >
            <Text style={styles.noteText}>
              {experience.note ||
                "Nessuna nota ancora. Aggiungi un pensiero per ricordartelo."}
            </Text>
          </Section>

          <Section
            title="DIARIO ESPERIENZE"
            actionLabel="Aggiungi esperienza"
            onAction={() => openSheet("experience")}
          >
            <Text style={styles.diarySubtitle}>
              Quando torni, scrivi com&apos;è andata.
            </Text>

            {experience.experiences.length === 0 ? (
              <PressableScale
                style={styles.diaryEmptyCard}
                onPress={() => openSheet("experience")}
              >
                <Text style={styles.diaryEmptyIcon}>▣</Text>
                <Text style={styles.diaryEmptyTitle}>Nessuna esperienza ancora.</Text>
                <Text style={styles.diaryEmptyText}>
                  Dopo una visita puoi segnare occasione, compagnia, piatto
                  migliore, spesa e voglia di tornarci.
                </Text>
              </PressableScale>
            ) : (
              experience.experiences.map((entry) => (
                <View key={entry.id} style={styles.timelineCard}>
                  <Text style={styles.timelineTitle}>
                    {entry.occasion || "Esperienza salvata"}
                  </Text>

                  <Text style={styles.timelineText}>
                    {[entry.withWho, entry.dish, entry.spend ? `${entry.spend}€` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>

                  <Text style={styles.timelineReturn}>
                    {entry.wouldReturn === null
                      ? "Ritorno non indicato"
                      : entry.wouldReturn
                        ? "Ci tornerei"
                        : "Non ci tornerei"}
                  </Text>
                </View>
              ))
            )}
          </Section>

          <Section
            title="GUIDE & PREMI"
            actionLabel="Aggiungi premio"
            onAction={() => openSheet("editorial")}
          >
            <Text style={styles.editorialTitle}>Riconoscimenti editoriali</Text>

            {allEditorialRecognitions.length > 0 ? (
              <View style={styles.editorialList}>
                {allEditorialRecognitions.map((recognition) => (
                  <PressableScale
                    key={recognition.id}
                    style={styles.editorialCard}
                    onPress={() => openEditorialRecognition(recognition)}
                  >
                    <View style={styles.awardIcon}>
                      <Text style={styles.awardIconText}>★</Text>
                    </View>

                    <View style={styles.awardBody}>
                      <Text style={styles.awardTitle}>{recognition.title}</Text>
                      <Text style={styles.awardText}>
                        {recognition.source}
                        {recognition.isUserAdded ? " · aggiunto da te" : ""}
                      </Text>
                    </View>

                    <Text style={styles.awardArrow}>↗</Text>
                  </PressableScale>
                ))}
              </View>
            ) : (
              <View style={styles.editorialEmptyCard}>
                <View style={styles.awardIconMuted}>
                  <Text style={styles.awardIconMutedText}>★</Text>
                </View>

                <View style={styles.awardBody}>
                  <Text style={styles.awardTitle}>
                    Non sono stati trovati riconoscimenti editoriali.
                  </Text>
                  <Text style={styles.awardText}>
                    Puoi aggiungerne uno manualmente se vuoi conservarlo nella tua
                    scheda personale.
                  </Text>
                </View>
              </View>
            )}
          </Section>
        </View>

        <View style={styles.bottomSpace} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <PressableScale
          style={[
            styles.bottomAction,
            activeStatuses.includes("favorite") && styles.bottomActionSaved,
          ]}
          onPress={() => toggleStatus("favorite")}
        >
          <Text style={styles.bottomActionText}>
            {activeStatuses.includes("favorite") ? "♥ Salvato" : "♡ Salva"}
          </Text>
        </PressableScale>

        <PressableScale style={styles.bottomAction} onPress={() => openSheet("lists")}>
          <Text style={styles.bottomActionText}>☰ Lista</Text>
        </PressableScale>

        <PressableScale style={styles.bottomActionPrimary} onPress={openMaps}>
          <Text style={styles.bottomActionPrimaryText}>➤ Naviga</Text>
        </PressableScale>
      </View>

      <Modal
        transparent
        visible={activeSheet !== "none"}
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <View style={styles.modalBackdrop}>
          <PressableScale style={styles.modalBackdropPressable} onPress={closeSheet} />

          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetContent}
            >
              {renderSheetContent()}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SmoothScoreCircle({
  score,
  label,
  color,
}: {
  score: number | null;
  label: string;
  color: string;
}) {
  const size = 244;
  const strokeWidth = 18;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = score ? Math.min(score / 10, 1) : 0;
  const animatedProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animatedProgress.setValue(0);

    Animated.timing(animatedProgress, {
      toValue: progress,
      duration: 760,
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, progress, color]);

  const dashOffset = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={styles.smoothScoreWrap}>
      <View style={styles.smoothScoreCircle}>
        <Svg key={`svg-${color}-${score ?? "empty"}`} width={size} height={size}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="rgba(255,248,239,0.08)"
            strokeWidth={strokeWidth}
            fill="transparent"
          />

          <AnimatedCircle
            key={`ring-${color}-${score ?? "empty"}`}
            cx={center}
            cy={center}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset as unknown as number}
            rotation="-90"
            originX={center}
            originY={center}
          />
        </Svg>

        <View style={styles.smoothScoreCenter}>
          <Text style={[styles.smoothScoreValue, { color }]}>
            {score ? score.toFixed(1) : "—"}
          </Text>
          <Text style={styles.smoothScoreOutOf}>/ 10</Text>
        </View>
      </View>

      <View style={styles.smoothScoreLabelRow}>
        <View style={[styles.smoothScoreLabelDot, { backgroundColor: color }]} />
        <Text style={styles.smoothScoreLabel}>{label}</Text>
      </View>
    </View>
  );
}

function Section({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionKicker}>{title}</Text>

        {actionLabel && onAction ? (
          <PressableScale style={styles.sectionActionButton} onPress={onAction}>
            <Text style={styles.sectionActionText}>{actionLabel}</Text>
          </PressableScale>
        ) : null}
      </View>

      {children}
    </View>
  );
}

function ActionBox({
  symbol,
  label,
  onPress,
}: {
  symbol: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={styles.actionBox} onPress={onPress}>
      <Text style={styles.actionIcon}>{symbol}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </PressableScale>
  );
}

function InfoRow({
  title,
  value,
  symbol,
}: {
  title: string;
  value: string;
  symbol: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Text style={styles.infoIconText}>{symbol}</Text>
      </View>

      <View style={styles.infoTextBlock}>
        <Text style={styles.infoLabel}>{title}</Text>
        <Text numberOfLines={2} style={styles.infoValue}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function SheetHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.sheetHeader}>
      <Text style={styles.sheetTitle}>{title}</Text>

      <PressableScale onPress={onClose}>
        <Text style={styles.sheetClose}>×</Text>
      </PressableScale>
    </View>
  );
}

function InputLabel({ label }: { label: string }) {
  return <Text style={styles.inputLabel}>{label}</Text>;
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
  coverCard: {
    height: 380,
    borderRadius: 34,
    backgroundColor: colors.card,
    overflow: "hidden",
    marginBottom: -24,
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: colors.card,
    position: "relative",
    overflow: "hidden",
  },
  coverOrbLarge: {
    position: "absolute",
    width: 230,
    height: 230,
    borderRadius: 999,
    backgroundColor: "rgba(216, 78, 127, 0.12)",
    right: -76,
    top: 30,
  },
  coverOrbSmall: {
    position: "absolute",
    width: 118,
    height: 118,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(226, 189, 53, 0.18)",
    left: 28,
    bottom: 66,
  },
  coverLineOne: {
    position: "absolute",
    width: 210,
    height: 1,
    backgroundColor: "rgba(255, 248, 239, 0.08)",
    left: 32,
    top: 118,
    transform: [{ rotate: "-18deg" }],
  },
  coverLineTwo: {
    position: "absolute",
    width: 160,
    height: 1,
    backgroundColor: "rgba(199, 168, 91, 0.18)",
    right: 18,
    bottom: 112,
    transform: [{ rotate: "24deg" }],
  },
  coverInitial: {
    color: "rgba(255, 248, 239, 0.9)",
    fontSize: 112,
    lineHeight: 120,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -2,
  },
  coverMonogramLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 3,
    marginTop: 2,
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  coverHeader: {
    position: "absolute",
    top: 18,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  roundBackButton: {
    width: 46,
    height: 46,
    borderRadius: 999,
    backgroundColor: "rgba(7,6,4,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  roundBackText: {
    color: colors.cream,
    fontSize: 36,
    lineHeight: 38,
    marginTop: -3,
  },
  coverPhotoButton: {
    height: 46,
    borderRadius: 999,
    backgroundColor: "rgba(7,6,4,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.18)",
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coverPhotoIconFrame: {
    width: 24,
    height: 19,
    borderRadius: 6,
    borderWidth: 1.7,
    borderColor: colors.cream,
    position: "relative",
    overflow: "hidden",
  },
  coverPhotoIconHorizon: {
    position: "absolute",
    left: 3,
    right: 3,
    bottom: 4,
    height: 1.5,
    backgroundColor: colors.cream,
    opacity: 0.85,
  },
  coverPhotoIconSun: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.yellow,
  },
  coverPhotoButtonText: {
    color: colors.cream,
    fontSize: 12,
    fontWeight: "900",
  },
  coverBottom: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 30,
  },
  placeArea: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.3,
    marginBottom: 7,
  },
  placeTitle: {
    color: colors.cream,
    fontSize: 44,
    lineHeight: 48,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -1.2,
    marginBottom: 8,
  },
  placeAddress: {
    color: "#D7CEC4",
    fontSize: 15,
    fontWeight: "700",
  },
  coverBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  coverBadgeChip: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: "rgba(255,248,239,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.2)",
    paddingLeft: 6,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  coverBadgeDot: {
    width: 23,
    height: 23,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  coverBadgeIcon: {
    color: colors.black,
    fontSize: 11,
    fontWeight: "900",
  },
  coverBadgeChipText: {
    color: colors.cream,
    fontSize: 12,
    fontWeight: "900",
  },
  mainPanel: {
    backgroundColor: colors.black,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 26,
    paddingHorizontal: 4,
  },
  recapPanel: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 18,
    marginBottom: 22,
  },
  recapHeader: {
    marginBottom: 16,
  },
  recapTitleBlock: {
    maxWidth: 310,
  },
  recapKicker: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.2,
    marginBottom: 7,
  },
  recapTitle: {
    color: colors.cream,
    fontSize: 27,
    lineHeight: 32,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -0.4,
    marginBottom: 7,
  },
  recapSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  recapGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  recapItem: {
    width: "48%",
    minHeight: 76,
    borderRadius: 19,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.07)",
    padding: 13,
    justifyContent: "space-between",
  },
  recapItemTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  recapDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  recapItemLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  recapItemValue: {
    color: colors.cream,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  sectionKicker: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.5,
    marginTop: 8,
  },
  sectionKickerStandalone: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.5,
    marginBottom: 13,
  },
  sectionActionButton: {
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: colors.pink,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionActionText: {
    color: colors.cream,
    fontSize: 12,
    fontWeight: "900",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 14,
  },
  statusChip: {
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    paddingLeft: 7,
    paddingRight: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusIconBubble: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  statusIconText: {
    fontSize: 13,
    fontWeight: "900",
  },
  statusIconTextActive: {
    color: colors.black,
  },
  statusChipText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "900",
  },
  statusChipTextActive: {
    color: colors.cream,
  },
  stateBadgePanel: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 18,
    marginBottom: 14,
  },
  customListsPanel: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 18,
    marginBottom: 18,
  },
  stateBadgeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 14,
  },
  stateBadgeKicker: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.2,
    marginBottom: 6,
  },
  stateBadgeTitle: {
    color: colors.cream,
    fontSize: 24,
    lineHeight: 29,
    fontFamily: "serif",
    fontWeight: "900",
  },
  stateBadgeButton: {
    minHeight: 38,
    borderRadius: 999,
    backgroundColor: colors.pink,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  stateBadgeButtonText: {
    color: colors.cream,
    fontSize: 12,
    fontWeight: "900",
  },
  stateBadgeList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  stateBadgeChip: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.07)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stateBadgeIconBox: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  stateBadgeIcon: {
    fontSize: 13,
    fontWeight: "900",
  },
  stateBadgeTextBlock: {
    paddingRight: 2,
  },
  stateBadgeName: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "900",
  },
  stateBadgeCategory: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginTop: 2,
  },
  stateBadgeEmptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  savedCustomListWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  savedCustomListChip: {
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.07)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  savedCustomListDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  savedCustomListText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "900",
  },
  actionGrid: {
    flexDirection: "row",
    gap: 9,
    marginBottom: 26,
  },
  actionBox: {
    flex: 1,
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionIcon: {
    color: colors.cream,
    fontSize: 20,
    fontWeight: "900",
  },
  actionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
  },
  infoCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 18,
  },
  infoRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  infoIcon: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(216,78,127,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  infoIconText: {
    color: colors.pink,
    fontSize: 17,
    fontWeight: "900",
  },
  infoTextBlock: {
    flex: 1,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 4,
  },
  infoValue: {
    color: colors.cream,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "900",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,248,239,0.08)",
    marginVertical: 16,
  },
  personalDetailRow: {
    gap: 6,
  },
  personalDetailLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  personalDetailValue: {
    color: colors.cream,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "800",
  },
  addDetailsButton: {
    alignSelf: "flex-start",
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(216,78,127,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  addDetailsButtonText: {
    color: colors.pink,
    fontSize: 13,
    fontWeight: "900",
  },
  hoursCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 18,
  },
  hoursTitle: {
    color: colors.cream,
    fontSize: 26,
    lineHeight: 31,
    fontFamily: "serif",
    fontWeight: "900",
    flex: 1,
  },
  openDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.green,
  },
  hoursRows: {
    marginTop: 12,
    gap: 8,
  },
  hoursText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  weekButton: {
    alignSelf: "flex-start",
    marginTop: 16,
  },
  weekLink: {
    color: colors.yellow,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2.5,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  contactChip: {
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: colors.cream,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  contactChipText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: "900",
  },
  contactChipMuted: {
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  contactChipMutedText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  contactHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 11,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: "italic",
  },
  emptyActionCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 18,
  },
  emptyActionTitle: {
    color: colors.cream,
    fontSize: 22,
    lineHeight: 27,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 8,
  },
  emptyActionText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  galleryPreviewRow: {
    gap: 10,
    paddingRight: 14,
  },
  galleryAddMini: {
    width: 78,
    height: 78,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryAddMiniText: {
    color: colors.pink,
    fontSize: 26,
    fontWeight: "900",
  },
  galleryPreviewImage: {
    width: 78,
    height: 78,
    borderRadius: 18,
  },
  galleryPreviewImageActive: {
    borderWidth: 3,
    borderColor: colors.yellow,
  },
  scoreIntro: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: -5,
    marginBottom: 14,
  },
  scoreCard: {
    height: 432,
    borderRadius: 28,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    overflow: "hidden",
  },
  smoothScoreWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  smoothScoreCircle: {
    width: 244,
    height: 244,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    marginBottom: 22,
  },
  smoothScoreCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  smoothScoreValue: {
    fontSize: 72,
    lineHeight: 76,
    fontFamily: "serif",
    fontWeight: "900",
    letterSpacing: -2,
  },
  smoothScoreOutOf: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: "900",
    marginTop: -6,
  },
  smoothScoreLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  smoothScoreLabelDot: {
    width: 15,
    height: 15,
    borderRadius: 999,
  },
  smoothScoreLabel: {
    color: colors.cream,
    fontSize: 23,
    fontWeight: "900",
  },
  scoreRow: {
    minHeight: 39,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scoreRowLabel: {
    flex: 1,
    color: colors.cream,
    fontSize: 14,
  },
  starsRow: {
    flexDirection: "row",
    gap: 5,
  },
  star: {
    color: "#3D3832",
    fontSize: 21,
    lineHeight: 24,
  },
  starActive: {
    color: colors.yellow,
  },
  noteText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
    fontStyle: "italic",
  },
  diarySubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: -4,
    marginBottom: 14,
  },
  diaryEmptyCard: {
    minHeight: 160,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 18,
    justifyContent: "center",
  },
  diaryEmptyIcon: {
    color: colors.pink,
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 14,
  },
  diaryEmptyTitle: {
    color: colors.cream,
    fontSize: 22,
    lineHeight: 27,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 8,
  },
  diaryEmptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  timelineCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 16,
    marginBottom: 10,
  },
  timelineTitle: {
    color: colors.cream,
    fontSize: 18,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 5,
  },
  timelineText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  timelineReturn: {
    color: colors.pink,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 8,
  },
  editorialTitle: {
    color: colors.cream,
    fontSize: 28,
    lineHeight: 33,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 14,
  },
  editorialList: {
    gap: 10,
  },
  editorialCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(226,189,53,0.3)",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  editorialEmptyCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  awardIcon: {
    width: 54,
    height: 54,
    borderRadius: 999,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  awardIconText: {
    color: colors.black,
    fontSize: 23,
    fontWeight: "900",
  },
  awardIconMuted: {
    width: 54,
    height: 54,
    borderRadius: 999,
    backgroundColor: colors.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  awardIconMutedText: {
    color: colors.muted,
    fontSize: 23,
    fontWeight: "900",
  },
  awardBody: {
    flex: 1,
  },
  awardTitle: {
    color: colors.cream,
    fontSize: 18,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 3,
  },
  awardText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  awardArrow: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: "900",
  },
  openDataCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.08)",
    padding: 18,
  },
  openDataHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 14,
  },
  openDataTitle: {
    color: colors.cream,
    fontSize: 22,
    lineHeight: 26,
    fontFamily: "serif",
    fontWeight: "900",
  },
  openDataSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  openDataBadge: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: "rgba(226, 189, 53, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(226, 189, 53, 0.35)",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  openDataBadgeText: {
    color: colors.yellow,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  openDataDescription: {
    color: colors.cream,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 14,
  },
  openDataRows: {
    gap: 10,
  },
  openDataRow: {
    borderRadius: 20,
    backgroundColor: "rgba(255, 248, 239, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 248, 239, 0.07)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  openDataRowLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  openDataRowValue: {
    color: colors.cream,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  openDataEmptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  openDataAttribution: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 14,
  },
  bottomSpace: {
    height: 112,
  },
  bottomBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    minHeight: 62,
    borderRadius: 999,
    backgroundColor: "rgba(7,6,4,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 8,
    flexDirection: "row",
    gap: 8,
  },
  bottomAction: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomActionSaved: {
    backgroundColor: colors.pink,
  },
  bottomActionText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "900",
  },
  bottomActionPrimary: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: colors.yellow,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomActionPrimaryText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: "900",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.52)",
    justifyContent: "flex-end",
  },
  modalBackdropPressable: {
    flex: 1,
  },
  sheet: {
    maxHeight: "84%",
    backgroundColor: colors.card,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#403A34",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 10,
  },
  sheetContent: {
    paddingHorizontal: 22,
    paddingBottom: 34,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  sheetTitle: {
    color: colors.cream,
    fontSize: 28,
    lineHeight: 33,
    fontFamily: "serif",
    fontWeight: "900",
  },
  sheetClose: {
    color: colors.cream,
    fontSize: 30,
    lineHeight: 32,
  },
  sheetDescription: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
  },
  listOption: {
    backgroundColor: colors.black,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  listOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  listOptionIconText: {
    fontSize: 17,
    fontWeight: "900",
  },
  listOptionTextBlock: {
    flex: 1,
    paddingRight: 8,
  },
  listOptionTitle: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },
  listOptionText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  listOptionButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.card2,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  listOptionButtonActive: {
    backgroundColor: colors.pink,
    borderColor: colors.pink,
  },
  listOptionButtonText: {
    color: colors.cream,
    fontSize: 20,
    fontWeight: "900",
  },
  secondarySheetButton: {
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(216,78,127,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginTop: 6,
    marginBottom: 8,
  },
  secondarySheetButtonText: {
    color: colors.pink,
    fontSize: 14,
    fontWeight: "900",
  },
  createListBox: {
    backgroundColor: colors.black,
    borderRadius: 24,
    padding: 16,
    marginBottom: 18,
  },
  colorPickerRow: {
    gap: 10,
    paddingRight: 16,
    marginBottom: 12,
  },
  colorPickerDot: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorPickerDotActive: {
    borderColor: colors.cream,
    transform: [{ scale: 1.08 }],
  },
  emptySheetCard: {
    backgroundColor: colors.black,
    borderRadius: 24,
    padding: 18,
    marginBottom: 12,
  },
  emptySheetTitle: {
    color: colors.cream,
    fontSize: 21,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 8,
  },
  emptySheetText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  customListStack: {
    gap: 10,
  },
  customListCard: {
    minHeight: 72,
    borderRadius: 22,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  customListColor: {
    width: 14,
    height: 44,
    borderRadius: 999,
  },
  customListBody: {
    flex: 1,
  },
  customListTitle: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },
  customListDescription: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  customListCheck: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  customListCheckActive: {
    backgroundColor: colors.pink,
  },
  customListCheckText: {
    color: colors.cream,
    fontSize: 18,
    fontWeight: "900",
  },
  sheetTextArea: {
    minHeight: 130,
    borderRadius: 18,
    backgroundColor: colors.black,
    color: colors.cream,
    fontSize: 15,
    lineHeight: 23,
    padding: 16,
    marginBottom: 18,
  },
  sheetSmallTitle: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 12,
    marginTop: 16,
  },
  compactBadgeWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 18,
  },
  compactBadgeChip: {
    minHeight: 38,
    borderRadius: 999,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    paddingHorizontal: 8,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  compactBadgeChipActive: {
    backgroundColor: "rgba(216,78,127,0.2)",
    borderColor: "rgba(216,78,127,0.5)",
  },
  compactBadgeIconBox: {
    width: 25,
    height: 25,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  compactBadgeIcon: {
    fontSize: 12,
    fontWeight: "900",
  },
  compactBadgeIconActive: {
    color: colors.black,
  },
  compactBadgeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  compactBadgeTextActive: {
    color: colors.cream,
  },
  sheetPrimaryButton: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    marginTop: 8,
  },
  sheetPrimaryButtonText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "900",
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  sheetInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.black,
    color: colors.cream,
    fontSize: 15,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  returnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
    marginBottom: 10,
  },
  returnButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
  },
  returnButtonActive: {
    backgroundColor: colors.cream,
  },
  returnButtonText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "900",
  },
  returnButtonTextActive: {
    color: colors.black,
  },
  badgeLibrary: {
    gap: 9,
    marginBottom: 20,
  },
  editorialBadge: {
    minHeight: 62,
    borderRadius: 20,
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.08)",
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  editorialBadgeActive: {
    backgroundColor: "rgba(216,78,127,0.16)",
    borderColor: "rgba(216,78,127,0.42)",
  },
  editorialBadgeIconBox: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  editorialBadgeIcon: {
    fontSize: 15,
    fontWeight: "900",
  },
  editorialBadgeIconActive: {
    color: colors.black,
  },
  editorialBadgeTextBlock: {
    flex: 1,
  },
  editorialBadgeTitle: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 3,
  },
  editorialBadgeTitleActive: {
    color: colors.cream,
  },
  editorialBadgeCategory: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  editorialBadgeCheck: {
    color: colors.pink,
    fontSize: 18,
    fontWeight: "900",
  },
  createBadgeBox: {
    backgroundColor: colors.black,
    borderRadius: 24,
    padding: 16,
  },
  emojiRow: {
    gap: 8,
    paddingRight: 16,
    marginBottom: 12,
  },
  emojiButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.card2,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiButtonActive: {
    backgroundColor: colors.pink,
  },
  emojiText: {
    color: colors.cream,
    fontSize: 19,
    fontWeight: "900",
  },
  galleryEmptySheet: {
    backgroundColor: colors.black,
    borderRadius: 24,
    padding: 20,
    marginTop: 16,
  },
  galleryEmptySheetIcon: {
    color: colors.pink,
    fontSize: 30,
    marginBottom: 10,
  },
  galleryEmptySheetTitle: {
    color: colors.cream,
    fontSize: 22,
    fontFamily: "serif",
    fontWeight: "900",
    marginBottom: 8,
  },
  galleryEmptySheetText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  coverManagerCard: {
    height: 230,
    borderRadius: 26,
    overflow: "hidden",
    backgroundColor: colors.black,
    marginTop: 18,
    marginBottom: 10,
  },
  coverManagerImage: {
    width: "100%",
    height: "100%",
  },
  coverManagerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.34)",
    justifyContent: "flex-end",
    padding: 18,
  },
  coverManagerKicker: {
    color: colors.yellow,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 5,
  },
  coverManagerTitle: {
    color: colors.cream,
    fontSize: 26,
    lineHeight: 31,
    fontFamily: "serif",
    fontWeight: "900",
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  sheetGalleryItem: {
    width: "48%",
    height: 182,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: colors.black,
  },
  sheetGalleryImage: {
    width: "100%",
    height: "100%",
  },
  galleryCoverFlag: {
    position: "absolute",
    top: 8,
    left: 8,
    borderRadius: 999,
    backgroundColor: colors.cream,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  galleryCoverFlagText: {
    color: colors.black,
    fontSize: 10,
    fontWeight: "900",
  },
  galleryImageActions: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    gap: 7,
  },
  coverSelectButton: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: "rgba(7,6,4,0.78)",
    alignItems: "center",
    justifyContent: "center",
  },
  coverSelectButtonActive: {
    backgroundColor: colors.cream,
  },
  coverSelectButtonText: {
    color: colors.cream,
    fontSize: 11,
    fontWeight: "900",
  },
  coverSelectButtonTextActive: {
    color: colors.black,
  },
  removeImageButton: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: "rgba(185,71,71,0.92)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  removeImageText: {
    color: colors.cream,
    fontSize: 11,
    fontWeight: "900",
  },
});
