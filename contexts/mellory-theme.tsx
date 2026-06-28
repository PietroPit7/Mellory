import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Appearance,
  Platform,
} from "react-native";

export type MelloryThemePreference = "light" | "dark";
export type MelloryResolvedTheme = "light" | "dark";

export const MELLORY_THEME_STORAGE_KEY = "mellory:theme-preference";
const LEGACY_THEME_STORAGE_KEY = "mellory:settings:appearance";

export type MelloryThemeColors = {
  black: string;
  card: string;
  card2: string;
  cream: string;
  paper: string;
  paperText: string;
  muted: string;
  textMuted: string;
  pink: string;
  gold: string;
  yellow: string;
  green: string;
  orange: string;
  red: string;
  blue: string;
  violet: string;
  sage: string;
  border: string;
  softBorder: string;
  overlay: string;
};

export const melloryDarkColors: MelloryThemeColors = {
  black: "#070604",
  card: "#17130F",
  card2: "#211C17",
  cream: "#FFF8EF",
  paper: "#FFF8EF",
  paperText: "#070604",
  muted: "#817A74",
  textMuted: "#AFA69C",
  pink: "#D84E7F",
  gold: "#C7A85B",
  yellow: "#E2BD35",
  green: "#6F934B",
  orange: "#E9754D",
  red: "#B94747",
  blue: "#6B8FA8",
  violet: "#9B78B6",
  sage: "#7A9B72",
  border: "rgba(255, 248, 239, 0.08)",
  softBorder: "rgba(255, 248, 239, 0.12)",
  overlay: "rgba(7, 6, 4, 0.48)",
};

export const melloryLightColors: MelloryThemeColors = {
  black: "#F3F0EA",
  card: "#FFFFFF",
  card2: "#FAF8F4",
  cream: "#1C1B19",
  paper: "#FFFFFF",
  paperText: "#1C1B19",
  muted: "#9C958B",
  textMuted: "#615A50",
  pink: "#C01A2F",
  gold: "#9A7B45",
  yellow: "#C8902B",
  green: "#5E7D49",
  orange: "#C2622E",
  red: "#C01A2F",
  blue: "#4F7A98",
  violet: "#7E5C9E",
  sage: "#6B8A63",
  border: "rgba(28, 27, 25, 0.10)",
  softBorder: "rgba(28, 27, 25, 0.06)",
  overlay: "rgba(243, 240, 234, 0.72)",
};

export const melloryThemeVars: MelloryThemeColors =
  Platform.OS === "web"
    ? {
        black: "var(--mellory-black, #F3F0EA)",
        card: "var(--mellory-card, #FFFFFF)",
        card2: "var(--mellory-card-2, #FAF8F4)",
        cream: "var(--mellory-cream, #1C1B19)",
        paper: "var(--mellory-paper, #FFFFFF)",
        paperText: "var(--mellory-paper-text, #1C1B19)",
        muted: "var(--mellory-muted, #9C958B)",
        textMuted: "var(--mellory-text-muted, #615A50)",
        pink: "var(--mellory-pink, #C01A2F)",
        gold: "var(--mellory-gold, #9A7B45)",
        yellow: "var(--mellory-yellow, #C8902B)",
        green: "var(--mellory-green, #5E7D49)",
        orange: "var(--mellory-orange, #C2622E)",
        red: "var(--mellory-red, #C01A2F)",
        blue: "var(--mellory-blue, #4F7A98)",
        violet: "var(--mellory-violet, #7E5C9E)",
        sage: "var(--mellory-sage, #6B8A63)",
        border: "var(--mellory-border, rgba(28, 27, 25, 0.10))",
        softBorder: "var(--mellory-soft-border, rgba(28, 27, 25, 0.06))",
        overlay: "var(--mellory-overlay, rgba(243, 240, 234, 0.72))",
      }
    : melloryLightColors;

type MelloryThemeContextValue = {
  preference: MelloryThemePreference;
  resolvedTheme: MelloryResolvedTheme;
  colors: MelloryThemeColors;
  isLight: boolean;
  setPreference: (preference: MelloryThemePreference) => Promise<void>;
  resetPreference: () => Promise<void>;
  clearPreferenceForReset: () => void;
};

const MelloryThemeContext = createContext<MelloryThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is MelloryThemePreference {
  return value === "light" || value === "dark";
}

function applyWebThemeVariables(colors: MelloryThemeColors) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;

  const root = document.documentElement;
  root.style.setProperty("--mellory-black", colors.black);
  root.style.setProperty("--mellory-card", colors.card);
  root.style.setProperty("--mellory-card-2", colors.card2);
  root.style.setProperty("--mellory-cream", colors.cream);
  root.style.setProperty("--mellory-paper", colors.paper);
  root.style.setProperty("--mellory-paper-text", colors.paperText);
  root.style.setProperty("--mellory-muted", colors.muted);
  root.style.setProperty("--mellory-text-muted", colors.textMuted);
  root.style.setProperty("--mellory-pink", colors.pink);
  root.style.setProperty("--mellory-gold", colors.gold);
  root.style.setProperty("--mellory-yellow", colors.yellow);
  root.style.setProperty("--mellory-green", colors.green);
  root.style.setProperty("--mellory-orange", colors.orange);
  root.style.setProperty("--mellory-red", colors.red);
  root.style.setProperty("--mellory-blue", colors.blue);
  root.style.setProperty("--mellory-violet", colors.violet);
  root.style.setProperty("--mellory-sage", colors.sage);
  root.style.setProperty("--mellory-border", colors.border);
  root.style.setProperty("--mellory-soft-border", colors.softBorder);
  root.style.setProperty("--mellory-overlay", colors.overlay);
  root.style.backgroundColor = colors.black;
}

export function MelloryThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<MelloryThemePreference>("light");

  const resolvedTheme = preference;
  const colors =
    resolvedTheme === "light" ? melloryLightColors : melloryDarkColors;

  useEffect(() => {
    let isActive = true;

    async function loadPreference() {
      const [storedPreference, legacyPreference] = await Promise.all([
        AsyncStorage.getItem(MELLORY_THEME_STORAGE_KEY),
        AsyncStorage.getItem(LEGACY_THEME_STORAGE_KEY),
      ]);

      const nextPreference = isThemePreference(storedPreference)
        ? storedPreference
        : isThemePreference(legacyPreference)
          ? legacyPreference
          : "light";

      if (!isActive) return;

      setPreferenceState(nextPreference);

      if (!isThemePreference(storedPreference)) {
        await AsyncStorage.setItem(MELLORY_THEME_STORAGE_KEY, nextPreference);
      }
    }

    loadPreference();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    applyWebThemeVariables(colors);

    // react-native-web non implementa Appearance.setColorScheme: chiamarlo
    // farebbe crashare l'app sul web. Lo invochiamo solo dove esiste davvero.
    if (Platform.OS !== "web" && typeof Appearance.setColorScheme === "function") {
      Appearance.setColorScheme(preference);
    }
  }, [colors, preference]);

  const setPreference = useCallback(
    async (nextPreference: MelloryThemePreference) => {
      setPreferenceState(nextPreference);
      await AsyncStorage.setItem(MELLORY_THEME_STORAGE_KEY, nextPreference);
    },
    []
  );

  const resetPreference = useCallback(async () => {
    setPreferenceState("light");
    await AsyncStorage.setItem(MELLORY_THEME_STORAGE_KEY, "light");
  }, []);

  const clearPreferenceForReset = useCallback(() => {
    setPreferenceState("light");
  }, []);

  const value = useMemo(
    () => ({
      preference,
      resolvedTheme,
      colors,
      isLight: resolvedTheme === "light",
      setPreference,
      resetPreference,
      clearPreferenceForReset,
    }),
    [
      clearPreferenceForReset,
      colors,
      preference,
      resetPreference,
      resolvedTheme,
      setPreference,
    ]
  );

  return (
    <MelloryThemeContext.Provider value={value}>
      {children}
    </MelloryThemeContext.Provider>
  );
}

export function useMelloryTheme() {
  const context = useContext(MelloryThemeContext);

  if (!context) {
    throw new Error("useMelloryTheme must be used inside MelloryThemeProvider");
  }

  return context;
}
