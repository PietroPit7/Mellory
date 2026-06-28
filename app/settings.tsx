import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { PressableScale } from "@/components/pressable-scale";
import { useResponsiveLayout } from "@/components/responsive-layout";
import {
  type MelloryThemeColors,
  type MelloryThemePreference,
  useMelloryTheme,
} from "@/contexts/mellory-theme";
import {
  getAvailableNavigationServiceOptions,
  getPreferredNavigationService,
  type NavigationService,
  setPreferredNavigationService,
} from "@/services/navigation-preferences";
import { PROFILE_KEY } from "@/services/storage-keys";

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

interface UserProfile {
  firstName: string;
  lastName: string;
  city: string;
}

export default function SettingsScreen() {
  const { clearPreferenceForReset, colors, preference, setPreference } =
    useMelloryTheme();
  const { isDesktopWeb } = useResponsiveLayout();
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [navigationService, setNavigationService] =
    useState<NavigationService>("automatic");
  const [profile, setProfile] = useState<UserProfile>({
    firstName: "",
    lastName: "",
    city: "",
  });
  const [profileSaved, setProfileSaved] = useState(false);
  const styles = useMemo(() => createStyles(colors, isDesktopWeb), [colors, isDesktopWeb]);
  const screenFade = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      screenFade.setValue(0);
      Animated.timing(screenFade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }, [screenFade])
  );
  const availableNavigationOptions = useMemo(
    () => getAvailableNavigationServiceOptions(),
    []
  );

  useEffect(() => {
    AsyncStorage.getItem(PROFILE_KEY)
      .then((value) => {
        if (value) {
          const parsed = JSON.parse(value) as Partial<UserProfile>;
          setProfile({
            firstName: parsed.firstName ?? "",
            lastName: parsed.lastName ?? "",
            city: parsed.city ?? "",
          });
        }
      })
      .catch(() => {});
  }, []);

  async function saveProfile() {
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch {
      // silent
    }
  }

  useEffect(() => {
    let isActive = true;
    const availableIds = new Set(
      availableNavigationOptions.map((option) => option.id)
    );

    getPreferredNavigationService()
      .then((service) => {
        if (!isActive) return;

        const nextService = availableIds.has(service) ? service : "automatic";
        setNavigationService(nextService);

        if (nextService !== service) {
          void setPreferredNavigationService(nextService);
        }
      })
      .catch(() => {
        if (isActive) setNavigationService("automatic");
      });

    return () => {
      isActive = false;
    };
  }, [availableNavigationOptions]);

  async function saveAppearanceMode(nextMode: MelloryThemePreference) {
    void Haptics.selectionAsync();
    setResetMessage("");
    await setPreference(nextMode);
  }

  async function saveNavigationService(nextService: NavigationService) {
    void Haptics.selectionAsync();
    setNavigationService(nextService);
    await setPreferredNavigationService(nextService);
  }

  async function exportData() {
    setBackupMessage("");

    try {
      const keys = await AsyncStorage.getAllKeys();
      const melloryKeys = keys.filter((key) => key.startsWith("mellory:"));
      const entries = await AsyncStorage.multiGet(melloryKeys);
      const data: Record<string, string> = {};

      entries.forEach(([key, value]) => {
        if (typeof value === "string") data[key] = value;
      });

      const payload = JSON.stringify(
        {
          app: "mellory",
          version: 1,
          exportedAt: new Date().toISOString(),
          data,
        },
        null,
        2
      );

      if (Platform.OS === "web" && typeof document !== "undefined") {
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `mellory-backup-${new Date()
          .toISOString()
          .slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setBackupMessage("Backup scaricato.");
        return;
      }

      await Share.share({ message: payload });
    } catch {
      setBackupMessage("Non riesco a esportare i dati adesso.");
    }
  }

  async function applyImport(text: string) {
    try {
      const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
      const data = parsed?.data;

      if (!data || typeof data !== "object") {
        setBackupMessage("File non valido.");
        return;
      }

      const entries = Object.entries(data).filter(
        (entry): entry is [string, string] =>
          entry[0].startsWith("mellory:") && typeof entry[1] === "string"
      );

      if (entries.length === 0) {
        setBackupMessage("Nessun dato Mellory nel file.");
        return;
      }

      await AsyncStorage.multiSet(entries);
      setBackupMessage("Dati importati. Riapri l'app per vederli tutti.");
    } catch {
      setBackupMessage("File non valido.");
    }
  }

  function importData() {
    setBackupMessage("");

    if (Platform.OS === "web" && typeof document !== "undefined") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        await applyImport(text);
      };
      input.click();
      return;
    }

    setBackupMessage("L'importazione è disponibile dalla versione web.");
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
    <Animated.ScrollView style={[styles.screen, { opacity: screenFade }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.safeTop} />

      <View style={styles.header}>
        <PressableScale style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>{"\u2190"}</Text>
        </PressableScale>

        <Text style={styles.title}>Impostazioni</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PROFILO</Text>

        <View style={styles.profileCard}>
          <View style={styles.profileField}>
            <Text style={styles.profileFieldLabel}>Nome</Text>
            <TextInput
              style={styles.profileInput}
              value={profile.firstName}
              onChangeText={(text) =>
                setProfile((p) => ({ ...p, firstName: text }))
              }
              placeholder="Il tuo nome"
              placeholderTextColor={colors.muted}
              returnKeyType="next"
              autoCapitalize="words"
              autoComplete="given-name"
            />
          </View>

          <View style={[styles.profileField, styles.profileFieldDivider]}>
            <Text style={styles.profileFieldLabel}>Cognome</Text>
            <TextInput
              style={styles.profileInput}
              value={profile.lastName}
              onChangeText={(text) =>
                setProfile((p) => ({ ...p, lastName: text }))
              }
              placeholder="Il tuo cognome"
              placeholderTextColor={colors.muted}
              returnKeyType="next"
              autoCapitalize="words"
              autoComplete="family-name"
            />
          </View>

          <View style={[styles.profileField, styles.profileFieldDivider]}>
            <Text style={styles.profileFieldLabel}>Città</Text>
            <TextInput
              style={styles.profileInput}
              value={profile.city}
              onChangeText={(text) =>
                setProfile((p) => ({ ...p, city: text }))
              }
              placeholder="La tua città"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              autoCapitalize="words"
              autoComplete="postal-address-locality"
              onSubmitEditing={saveProfile}
            />
          </View>
        </View>

        <PressableScale style={styles.profileSaveButton} onPress={saveProfile}>
          <Text style={styles.profileSaveText}>
            {profileSaved ? "Salvato ✓" : "Salva profilo"}
          </Text>
        </PressableScale>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ASPETTO</Text>

        <View style={styles.optionCard}>
          {appearanceOptions.map((option, index) => {
            const isActive = preference === option.id;

            return (
              <PressableScale
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
              </PressableScale>
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
        <Text style={styles.sectionLabel}>NAVIGAZIONE</Text>

        <View style={styles.optionCard}>
          {availableNavigationOptions.map((option, index) => {
            const isActive = navigationService === option.id;

            return (
              <PressableScale
                key={option.id}
                style={[
                  styles.optionRow,
                  index < availableNavigationOptions.length - 1 &&
                    styles.optionDivider,
                ]}
                onPress={() => saveNavigationService(option.id)}
              >
                <Text
                  style={[
                    styles.optionIcon,
                    isActive && styles.optionIconActive,
                  ]}
                >
                  {option.icon}
                </Text>

                <View style={styles.optionTextBlock}>
                  <Text style={styles.navigationOptionLabel}>
                    {option.label}
                  </Text>
                  <Text style={styles.optionDetail}>{option.detail}</Text>
                </View>

                {isActive ? <View style={styles.activeDot} /> : null}
              </PressableScale>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>BACKUP</Text>

        <View style={styles.backupRow}>
          <PressableScale style={styles.backupButton} onPress={exportData}>
            <Text style={styles.backupButtonText}>Esporta dati</Text>
          </PressableScale>

          <PressableScale style={styles.backupButton} onPress={importData}>
            <Text style={styles.backupButtonText}>Importa dati</Text>
          </PressableScale>
        </View>

        {backupMessage ? (
          <Text style={styles.resetFeedback}>{backupMessage}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>DATI</Text>

        <PressableScale
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
        </PressableScale>

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
    </Animated.ScrollView>
  );
}

function createStyles(colors: MelloryThemeColors, isDesktopWeb: boolean) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.black,
    },
    content: {
      paddingHorizontal: isDesktopWeb ? 56 : 34,
      paddingBottom: 40,
      width: "100%",
      maxWidth: isDesktopWeb ? 920 : undefined,
      alignSelf: "center",
    },
    safeTop: {
      height: isDesktopWeb ? 34 : 64,
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
      fontSize: isDesktopWeb ? 48 : 41,
      lineHeight: isDesktopWeb ? 54 : 48,
      fontFamily: undefined,
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
    optionTextBlock: {
      flex: 1,
      gap: 4,
    },
    navigationOptionLabel: {
      color: colors.cream,
      fontSize: 22,
      lineHeight: 27,
      fontWeight: "900",
    },
    optionDetail: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
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
    backupRow: {
      flexDirection: "row",
      gap: 12,
    },
    backupButton: {
      flex: 1,
      minHeight: 60,
      borderRadius: 999,
      backgroundColor: colors.card2,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    backupButtonText: {
      color: colors.cream,
      fontSize: 17,
      fontWeight: "900",
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
      fontFamily: undefined,
      fontWeight: "900",
      letterSpacing: -1,
      marginBottom: 8,
    },
    signatureText: {
      color: colors.muted,
      fontSize: 17,
      lineHeight: 23,
      fontFamily: undefined,
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
    profileCard: {
      backgroundColor: colors.card2,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      marginBottom: 14,
    },
    profileField: {
      minHeight: 72,
      paddingHorizontal: 28,
      paddingVertical: 16,
      justifyContent: "center",
      gap: 4,
    },
    profileFieldDivider: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    profileFieldLabel: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 2.5,
    },
    profileInput: {
      color: colors.cream,
      fontSize: 20,
      fontWeight: "700",
      paddingVertical: 0,
    },
    profileSaveButton: {
      minHeight: 58,
      borderRadius: 999,
      backgroundColor: colors.gold,
      alignItems: "center",
      justifyContent: "center",
    },
    profileSaveText: {
      color: colors.black,
      fontSize: 17,
      fontWeight: "900",
      letterSpacing: 0.3,
    },
  });
}
