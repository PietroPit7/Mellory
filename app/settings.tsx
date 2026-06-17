import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  type MelloryThemeColors,
  type MelloryThemePreference,
  useMelloryTheme,
} from "@/contexts/mellory-theme";

const appearanceOptions: {
  id: MelloryThemePreference;
  label: string;
  icon: string;
}[] = [
  {
    id: "light",
    label: "Chiaro",
    icon: "\u263C",
  },
  {
    id: "dark",
    label: "Scuro",
    icon: "\u263E",
  },
];

export default function SettingsScreen() {
  const { clearPreferenceForReset, colors, preference, setPreference } =
    useMelloryTheme();
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const styles = useMemo(() => createStyles(colors), [colors]);

  async function saveAppearanceMode(nextMode: MelloryThemePreference) {
    setResetMessage("");
    await setPreference(nextMode);
  }

  async function performReset() {
    setIsResetting(true);

    try {
      const keys = await AsyncStorage.getAllKeys();
      const melloryKeys = keys.filter((key) => key.startsWith("mellory:"));

      if (melloryKeys.length > 0) {
        await AsyncStorage.multiRemove(melloryKeys);
      }

      clearPreferenceForReset();
      setResetMessage("Mellory \u00E8 stata riportata allo stato iniziale.");
    } finally {
      setIsResetting(false);
    }
  }

  function handleResetPress() {
    const title = "Reset di Mellory";
    const message =
      "Vuoi cancellare salvataggi, liste, note, valutazioni ed esperienze da questo dispositivo?";

    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`${title}\n\n${message}`)) {
        void performReset();
      }

      return;
    }

    Alert.alert(title, message, [
      {
        text: "Annulla",
        style: "cancel",
      },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => {
          void performReset();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.safeTop} />

      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>{"\u2190"}</Text>
        </Pressable>

        <Text style={styles.title}>Impostazioni</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ASPETTO</Text>

        <View style={styles.optionCard}>
          {appearanceOptions.map((option, index) => {
            const isActive = preference === option.id;

            return (
              <Pressable
                key={option.id}
                style={[
                  styles.optionRow,
                  index < appearanceOptions.length - 1 && styles.optionDivider,
                ]}
                onPress={() => saveAppearanceMode(option.id)}
              >
                <Text
                  style={[
                    styles.optionIcon,
                    isActive && styles.optionIconActive,
                  ]}
                >
                  {option.icon}
                </Text>

                <Text style={styles.optionLabel}>{option.label}</Text>

                {isActive ? <View style={styles.activeDot} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PRIVACY</Text>

        <View style={styles.privacyCard}>
          <Text style={styles.privacyText}>
            I tuoi salvataggi, liste, note, valutazioni ed esperienze vivono
            solo sul tuo dispositivo. Nulla viene caricato su server esterni.
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>DATI</Text>

        <Pressable
          style={[styles.resetButton, isResetting && styles.resetButtonDisabled]}
          onPress={handleResetPress}
          disabled={isResetting}
        >
          <View style={styles.trashIcon}>
            <View style={styles.trashLid} />
            <View style={styles.trashBody}>
              <View style={styles.trashLine} />
              <View style={styles.trashLine} />
            </View>
          </View>
          <Text style={styles.resetText}>
            {isResetting ? "Reset in corso" : "Reset di Mellory"}
          </Text>
        </Pressable>

        {resetMessage ? (
          <Text style={styles.resetFeedback}>{resetMessage}</Text>
        ) : null}
      </View>

      <View style={styles.signature}>
        <Text style={styles.signatureTitle}>Mellory</Text>
        <Text style={styles.signatureText}>
          Trova sempre il posto giusto per te.
        </Text>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: MelloryThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.black,
    },
    content: {
      paddingHorizontal: 34,
      paddingBottom: 40,
    },
    safeTop: {
      height: 64,
    },
    header: {
      minHeight: 66,
      flexDirection: "row",
      alignItems: "center",
      gap: 18,
      marginBottom: 34,
    },
    backButton: {
      width: 60,
      height: 60,
      borderRadius: 999,
      backgroundColor: colors.card2,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    backIcon: {
      color: colors.cream,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: "500",
      marginTop: -2,
    },
    title: {
      color: colors.cream,
      fontSize: 41,
      lineHeight: 48,
      fontFamily: "serif",
      fontWeight: "900",
      letterSpacing: -1.2,
    },
    section: {
      marginBottom: 42,
    },
    sectionLabel: {
      color: colors.muted,
      fontSize: 15,
      fontWeight: "900",
      letterSpacing: 4,
      marginBottom: 18,
    },
    optionCard: {
      backgroundColor: colors.card2,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    optionRow: {
      minHeight: 78,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 28,
      gap: 22,
    },
    optionDivider: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    optionIcon: {
      width: 28,
      color: colors.cream,
      fontSize: 27,
      lineHeight: 31,
      fontWeight: "800",
      textAlign: "center",
    },
    optionIconActive: {
      color: colors.gold,
    },
    optionLabel: {
      flex: 1,
      color: colors.cream,
      fontSize: 25,
      lineHeight: 30,
      fontWeight: "900",
    },
    activeDot: {
      width: 12,
      height: 12,
      borderRadius: 999,
      backgroundColor: colors.gold,
    },
    privacyCard: {
      backgroundColor: colors.card2,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 26,
      paddingVertical: 26,
    },
    privacyText: {
      color: colors.cream,
      fontSize: 22,
      lineHeight: 33,
      fontWeight: "700",
    },
    resetButton: {
      minHeight: 72,
      borderRadius: 999,
      borderWidth: 1.2,
      borderColor: colors.orange,
      backgroundColor: colors.card2,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    },
    resetButtonDisabled: {
      opacity: 0.62,
    },
    trashIcon: {
      width: 25,
      height: 28,
      alignItems: "center",
      justifyContent: "flex-end",
      position: "relative",
    },
    trashLid: {
      position: "absolute",
      top: 2,
      width: 18,
      height: 3,
      borderRadius: 999,
      backgroundColor: colors.orange,
    },
    trashBody: {
      width: 18,
      height: 20,
      borderWidth: 2.4,
      borderTopWidth: 2.4,
      borderColor: colors.orange,
      borderRadius: 3,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 3,
    },
    trashLine: {
      width: 2,
      height: 11,
      borderRadius: 999,
      backgroundColor: colors.orange,
    },
    resetText: {
      color: colors.orange,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "900",
    },
    signature: {
      alignItems: "center",
      marginTop: 22,
      paddingBottom: 6,
    },
    signatureTitle: {
      color: colors.cream,
      fontSize: 43,
      lineHeight: 50,
      fontFamily: "serif",
      fontWeight: "900",
      letterSpacing: -1,
      marginBottom: 8,
    },
    signatureText: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 23,
      fontFamily: "serif",
      fontStyle: "italic",
    },
    resetFeedback: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      textAlign: "center",
      marginTop: 12,
    },
  });
}
