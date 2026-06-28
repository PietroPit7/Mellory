import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";

import {
  MelloryThemeProvider,
  useMelloryTheme,
} from "@/contexts/mellory-theme";

import { ONBOARDING_KEY } from "./onboarding";

function WebGlobalStyles() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const el = document.createElement("style");
    el.textContent = [
      "html, body { margin: 0; padding: 0; overflow: hidden; overscroll-behavior: none; }",
      "* { -webkit-tap-highlight-color: transparent; box-sizing: border-box; user-select: none; -webkit-user-select: none; }",
      "input, textarea, [contenteditable] { outline: none !important; user-select: text; -webkit-user-select: text; }",
    ].join("\n");
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);
  return null;
}

function RootNavigator() {
  const { colors, resolvedTheme } = useMelloryTheme();
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((value) => {
        if (!value) {
          router.replace("/onboarding");
        }
        setCheckedOnboarding(true);
      })
      .catch(() => {
        setCheckedOnboarding(true);
      });
  }, []);

  return (
    <>
      <WebGlobalStyles />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.black,
          },
        }}
      >
        <Stack.Screen name="(tabs)" />

        <Stack.Screen
          name="onboarding"
          options={{
            presentation: "fullScreenModal",
            animation: "fade",
          }}
        />

        <Stack.Screen
          name="place-detail"
          options={{
            presentation: "card",
            animation: "slide_from_right",
          }}
        />

        <Stack.Screen
          name="settings"
          options={{
            presentation: "card",
            animation: "slide_from_right",
          }}
        />
      </Stack>

      {!checkedOnboarding && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.black,
          }}
        />
      )}

      <StatusBar style={resolvedTheme === "light" ? "dark" : "light"} />
    </>
  );
}

export default function RootLayout() {
  return (
    <MelloryThemeProvider>
      <RootNavigator />
    </MelloryThemeProvider>
  );
}
