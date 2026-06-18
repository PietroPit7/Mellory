import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import {
  MelloryThemeProvider,
  useMelloryTheme,
} from "@/contexts/mellory-theme";

function RootNavigator() {
  const { colors, resolvedTheme } = useMelloryTheme();

  return (
    <>
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
