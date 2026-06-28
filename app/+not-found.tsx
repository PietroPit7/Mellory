import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { melloryDarkColors as colors } from "@/contexts/mellory-theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Non trovato", headerShown: false }} />
      <View style={styles.root}>
        <Text style={styles.code}>404</Text>
        <Text style={styles.title}>Pagina non trovata</Text>
        <Text style={styles.sub}>Questo indirizzo non esiste in questa app.</Text>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={styles.linkText}>{"Torna alla home >"}</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  code: {
    fontSize: 64,
    fontWeight: "800",
    color: colors.pink,
    letterSpacing: -2,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.cream,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
    marginBottom: 24,
  },
  link: {
    marginTop: 8,
  },
  linkText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.pink,
  },
});
