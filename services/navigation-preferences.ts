import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

export type NavigationService = "automatic" | "google" | "apple" | "waze";

export type NavigationDestination = {
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
};

type NavigationServiceOption = {
  id: NavigationService;
  label: string;
  detail: string;
  icon: string;
};

export const NAVIGATION_SERVICE_STORAGE_KEY =
  "mellory:settings:navigation-service";

export const navigationServiceOptions: NavigationServiceOption[] = [
  {
    id: "automatic",
    label: "Migliore disponibile",
    detail: "Usa la scelta più naturale per questo dispositivo.",
    icon: "◎",
  },
  {
    id: "google",
    label: "Google Maps",
    detail: "Percorso rapido con Google Maps.",
    icon: "G",
  },
  {
    id: "apple",
    label: "Mappe",
    detail: "Esperienza nativa su iPhone e iPad.",
    icon: "M",
  },
  {
    id: "waze",
    label: "Waze",
    detail: "Percorso con traffico in tempo reale.",
    icon: "W",
  },
];

export function getAvailableNavigationServiceOptions() {
  if (Platform.OS === "web") {
    return navigationServiceOptions.filter((option) =>
      ["automatic", "google"].includes(option.id)
    );
  }

  if (Platform.OS === "android") {
    return navigationServiceOptions.filter((option) => option.id !== "apple");
  }

  return navigationServiceOptions;
}

function isNavigationService(value: string | null): value is NavigationService {
  return (
    value === "automatic" ||
    value === "google" ||
    value === "apple" ||
    value === "waze"
  );
}

export async function getPreferredNavigationService() {
  const storedValue = await AsyncStorage.getItem(NAVIGATION_SERVICE_STORAGE_KEY);

  return isNavigationService(storedValue) ? storedValue : "automatic";
}

export async function setPreferredNavigationService(service: NavigationService) {
  await AsyncStorage.setItem(NAVIGATION_SERVICE_STORAGE_KEY, service);
}

function normalizeNavigationServiceForPlatform(service: NavigationService) {
  if (Platform.OS === "web" && service !== "automatic" && service !== "google") {
    return "automatic";
  }

  if (Platform.OS === "android" && service === "apple") {
    return "automatic";
  }

  return service;
}

function hasCoordinates(destination: NavigationDestination) {
  return (
    typeof destination.latitude === "number" &&
    Number.isFinite(destination.latitude) &&
    typeof destination.longitude === "number" &&
    Number.isFinite(destination.longitude)
  );
}

function getCoordinateQuery(destination: NavigationDestination) {
  if (!hasCoordinates(destination)) return "";

  return `${destination.latitude},${destination.longitude}`;
}

function getTextQuery(destination: NavigationDestination) {
  return [destination.name, destination.address]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(", ");
}

function getEncodedDestination(destination: NavigationDestination) {
  const coordinateQuery = getCoordinateQuery(destination);

  return encodeURIComponent(coordinateQuery || getTextQuery(destination));
}

function getAppDestination(destination: NavigationDestination) {
  return getCoordinateQuery(destination) || encodeURIComponent(getTextQuery(destination));
}

function getGoogleUrls(destination: NavigationDestination) {
  const encodedDestination = getEncodedDestination(destination);
  const appDestination = getAppDestination(destination);
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}`;

  if (Platform.OS === "android") {
    return [`google.navigation:q=${appDestination}&mode=d`, webUrl];
  }

  if (Platform.OS === "ios") {
    return [
      `comgooglemaps://?daddr=${appDestination}&directionsmode=driving`,
      webUrl,
    ];
  }

  return [webUrl];
}

function getAppleUrls(destination: NavigationDestination) {
  const appDestination = getAppDestination(destination);
  const encodedDestination = getEncodedDestination(destination);
  // maps:// opens Apple Maps directly without a browser hop on iOS
  return [
    `maps://?daddr=${appDestination}&dirflg=d`,
    `http://maps.apple.com/?daddr=${encodedDestination}&dirflg=d`,
  ];
}

function getWazeUrls(destination: NavigationDestination) {
  const coordinateQuery = getCoordinateQuery(destination);
  const textQuery = encodeURIComponent(getTextQuery(destination));
  const webUrl = coordinateQuery
    ? `https://waze.com/ul?ll=${coordinateQuery}&navigate=yes`
    : `https://waze.com/ul?q=${textQuery}&navigate=yes`;

  if (coordinateQuery) {
    return [`waze://?ll=${coordinateQuery}&navigate=yes`, webUrl];
  }

  return [`waze://?q=${textQuery}&navigate=yes`, webUrl];
}

function getNavigationUrls(
  service: NavigationService,
  destination: NavigationDestination
) {
  if (service === "google") return getGoogleUrls(destination);
  if (service === "apple") return getAppleUrls(destination);
  if (service === "waze") return getWazeUrls(destination);

  if (Platform.OS === "ios") return getAppleUrls(destination);
  return getGoogleUrls(destination);
}

export async function openPreferredNavigation(destination: NavigationDestination) {
  const service = normalizeNavigationServiceForPlatform(
    await getPreferredNavigationService()
  );
  const urls = getNavigationUrls(service, destination);
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Navigation unavailable");
}
