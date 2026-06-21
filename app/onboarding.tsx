import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/pressable-scale";
import { melloryDarkColors as colors } from "@/contexts/mellory-theme";

export const ONBOARDING_KEY = "mellory:onboarding-completed";
export const PROFILE_KEY = "mellory:user-profile";
const CUSTOM_LISTS_KEY = "mellory:custom-lists";

type FoodOption = {
  id: string;
  icon: string;
  label: string;
  listName: string;
  description: string;
  color: string;
};

type OccasionOption = {
  id: string;
  icon: string;
  label: string;
  listName: string;
  description: string;
  color: string;
};

type CreatedList = {
  id: string;
  title: string;
  description: string;
  color: string;
  placeIds: string[];
  createdAt: string;
};

const foodOptions: FoodOption[] = [
  { id: "restaurant", icon: "🍝", label: "Ristoranti", listName: "I miei ristoranti", description: "La tua selezione di ristoranti.", color: colors.blue },
  { id: "pizza", icon: "🍕", label: "Pizzerie", listName: "Le mie pizzerie", description: "Le pizzerie che ami.", color: colors.orange },
  { id: "bar", icon: "☕", label: "Bar & Caffè", listName: "Bar e caffè", description: "I bar e caffè preferiti.", color: colors.gold },
  { id: "oriental", icon: "🍣", label: "Orientale", listName: "Cucina orientale", description: "Giapponese, cinese, thai e altro.", color: colors.violet },
  { id: "cocktail", icon: "🍸", label: "Cocktail bar", listName: "Cocktail & aperitivi", description: "I posti per un drink perfetto.", color: colors.pink },
  { id: "pastry", icon: "🥐", label: "Pasticcerie", listName: "Colazioni e pasticcerie", description: "Per iniziare la giornata bene.", color: colors.yellow },
  { id: "street", icon: "🌮", label: "Street food", listName: "Street food e informale", description: "Buono, veloce e senza pretese.", color: colors.orange },
  { id: "osteria", icon: "🍷", label: "Osterie", listName: "Osterie e trattorie", description: "Cucina tradizionale e sincera.", color: colors.sage },
  { id: "fine", icon: "✦", label: "Fine dining", listName: "Fine dining", description: "Esperienze gastronomiche di livello.", color: colors.gold },
];

const occasionOptions: OccasionOption[] = [
  { id: "romantic", icon: "♥", label: "Cena romantica", listName: "Cene romantiche", description: "Atmosfera, luce soffusa, momento speciale.", color: colors.pink },
  { id: "friends", icon: "◆", label: "Con gli amici", listName: "Con gli amici", description: "Posti dove si sta bene in compagnia.", color: colors.green },
  { id: "aperitivo", icon: "◈", label: "Aperitivo", listName: "Aperitivi e drinks", description: "Happy hour e pre-cena.", color: colors.yellow },
  { id: "breakfast", icon: "◇", label: "Colazione", listName: "Colazioni e brunch", description: "Il miglior modo di iniziare la giornata.", color: colors.gold },
  { id: "business", icon: "◉", label: "Pranzo lavoro", listName: "Business lunch", description: "Posti adatti per un pranzo professionale.", color: colors.blue },
  { id: "family", icon: "⌂", label: "In famiglia", listName: "In famiglia", description: "Dove si sta bene tutti insieme.", color: colors.sage },
];

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function buildLists(
  firstName: string,
  city: string,
  foodIds: string[],
  occasionIds: string[]
): CreatedList[] {
  const now = new Date().toISOString();
  const name = firstName.trim();
  const cityName = city.trim();
  const lists: CreatedList[] = [];

  lists.push({
    id: createId(),
    title: cityName ? `Da provare a ${cityName}` : "Da provare",
    description: cityName
      ? `I posti che vuoi visitare a ${cityName}.`
      : "I posti che vuoi visitare.",
    color: colors.pink,
    placeIds: [],
    createdAt: now,
  });

  const displayName = name
    ? name.charAt(0).toUpperCase() + name.slice(1)
    : null;

  lists.push({
    id: createId(),
    title: displayName ? `I migliori di ${displayName}` : "I miei migliori",
    description: "I locali che non ti stancheresti mai di rivedere.",
    color: colors.gold,
    placeIds: [],
    createdAt: now,
  });

  const selectedFood = foodOptions.filter((opt) => foodIds.includes(opt.id)).slice(0, 2);
  selectedFood.forEach((opt) => {
    lists.push({
      id: createId(),
      title: opt.listName,
      description: opt.description,
      color: opt.color,
      placeIds: [],
      createdAt: now,
    });
  });

  const selectedOccasion = occasionOptions.filter((opt) => occasionIds.includes(opt.id)).slice(0, 1);
  selectedOccasion.forEach((opt) => {
    lists.push({
      id: createId(),
      title: opt.listName,
      description: opt.description,
      color: opt.color,
      placeIds: [],
      createdAt: now,
    });
  });

  return lists;
}

const CONTENT_STEPS = 4;

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("");
  const [selectedFood, setSelectedFood] = useState<string[]>([]);
  const [selectedOccasions, setSelectedOccasions] = useState<string[]>([]);

  const listsRef = useRef<CreatedList[]>([]);
  const [displayLists, setDisplayLists] = useState<CreatedList[]>([]);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (step >= 1 && step <= CONTENT_STEPS) {
      Animated.timing(progressAnim, {
        toValue: step / CONTENT_STEPS,
        duration: 380,
        useNativeDriver: false,
      }).start();
    } else if (step === 5) {
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 380,
        useNativeDriver: false,
      }).start();
    }
  }, [step, progressAnim]);

  function animateToStep(nextStep: number) {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -28, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      setStep(nextStep);
      slideAnim.setValue(28);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    });
  }

  function toggleFood(id: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedFood((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  function toggleOccasion(id: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedOccasions((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  function goNext() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    animateToStep(step + 1);
  }

  function goBack() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateToStep(step - 1);
  }

  async function handleComplete() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const lists = buildLists(firstName, city, selectedFood, selectedOccasions);
    listsRef.current = lists;

    const profile = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      city: city.trim(),
    };

    await Promise.all([
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile)),
      AsyncStorage.setItem(ONBOARDING_KEY, "true"),
      AsyncStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(lists)),
    ]);

    setDisplayLists(lists);
    animateToStep(5);
  }

  function enterApp() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace("/(tabs)");
  }

  const showProgress = step >= 1 && step <= 5;

  function renderStep() {
    // Welcome
    if (step === 0) {
      return (
        <View style={styles.stepWelcome}>
          <View style={styles.welcomeTop}>
            <View style={styles.welcomeMonogram}>
              <Text style={styles.welcomeMonogramText}>M</Text>
            </View>
            <View style={styles.welcomeRule} />
          </View>

          <View style={styles.welcomeBody}>
            <Text style={styles.welcomeWordmark}>Mellory</Text>
            <Text style={styles.welcomeKicker}>LA TUA GUIDA GASTRONOMICA PERSONALE</Text>
            <Text style={styles.welcomeTagline}>
              Salva i posti dove stai bene.{"\n"}Aggiungici note, voti e ricordi.{"\n"}Scoprine di nuovi intorno a te.
            </Text>
          </View>

          <PressableScale style={styles.primaryButton} onPress={goNext}>
            <Text style={styles.primaryButtonText}>Inizia</Text>
            <Text style={styles.primaryButtonArrow}>→</Text>
          </PressableScale>

          <Text style={styles.welcomeNote}>
            I tuoi dati restano solo sul tuo dispositivo.
          </Text>
        </View>
      );
    }

    // Name
    if (step === 1) {
      return (
        <View style={styles.stepContent}>
          <View style={styles.stepHead}>
            <Text style={styles.stepKicker}>IL TUO PROFILO</Text>
            <Text style={styles.stepTitle}>Come ti chiami?</Text>
            <Text style={styles.stepSub}>
              Personalizzeremo Mellory con il tuo nome.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Nome"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="words"
              autoComplete="given-name"
              autoFocus
              returnKeyType="next"
            />
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Cognome"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="words"
              autoComplete="family-name"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (firstName.trim()) goNext();
              }}
            />
          </View>

          <PressableScale
            style={[styles.primaryButton, !firstName.trim() && styles.buttonDisabled]}
            onPress={goNext}
            disabled={!firstName.trim()}
          >
            <Text style={styles.primaryButtonText}>Avanti</Text>
            <Text style={styles.primaryButtonArrow}>→</Text>
          </PressableScale>

          <PressableScale style={styles.skipButton} onPress={goNext}>
            <Text style={styles.skipText}>Salta</Text>
          </PressableScale>
        </View>
      );
    }

    // City
    if (step === 2) {
      return (
        <View style={styles.stepContent}>
          <View style={styles.stepHead}>
            <Text style={styles.stepKicker}>LA TUA CITTÀ</Text>
            <Text style={styles.stepTitle}>Dove abiti?</Text>
            <Text style={styles.stepSub}>
              Creeremo una lista dedicata ai posti da scoprire nella tua città.
            </Text>
          </View>

          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="Milano, Roma, Torino…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoCapitalize="words"
            autoComplete="postal-address-locality"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={goNext}
          />

          <PressableScale style={styles.primaryButton} onPress={goNext}>
            <Text style={styles.primaryButtonText}>Avanti</Text>
            <Text style={styles.primaryButtonArrow}>→</Text>
          </PressableScale>

          <PressableScale style={styles.skipButton} onPress={goNext}>
            <Text style={styles.skipText}>Salta</Text>
          </PressableScale>
        </View>
      );
    }

    // Food preferences
    if (step === 3) {
      return (
        <View style={styles.stepContent}>
          <View style={styles.stepHead}>
            <Text style={styles.stepKicker}>I TUOI LOCALI</Text>
            <Text style={styles.stepTitle}>Cosa ami trovare?</Text>
            <Text style={styles.stepSub}>
              Seleziona i tipi di posti che frequenti di più.
            </Text>
          </View>

          <View style={styles.pillGrid}>
            {foodOptions.map((opt) => {
              const active = selectedFood.includes(opt.id);
              return (
                <PressableScale
                  key={opt.id}
                  style={[
                    styles.pill,
                    active && { backgroundColor: `${opt.color}20`, borderColor: opt.color },
                  ]}
                  onPress={() => toggleFood(opt.id)}
                >
                  <Text style={styles.pillIcon}>{opt.icon}</Text>
                  <Text style={[styles.pillLabel, active && { color: colors.cream }]}>
                    {opt.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          <PressableScale
            style={[styles.primaryButton, selectedFood.length === 0 && styles.buttonMuted]}
            onPress={goNext}
          >
            <Text style={styles.primaryButtonText}>
              {selectedFood.length > 0 ? `Avanti (${selectedFood.length} selezionati)` : "Salta"}
            </Text>
            <Text style={styles.primaryButtonArrow}>→</Text>
          </PressableScale>
        </View>
      );
    }

    // Occasions
    if (step === 4) {
      return (
        <View style={styles.stepContent}>
          <View style={styles.stepHead}>
            <Text style={styles.stepKicker}>LE TUE OCCASIONI</Text>
            <Text style={styles.stepTitle}>Per quali momenti?</Text>
            <Text style={styles.stepSub}>
              Creeremo liste personalizzate per le tue occasioni preferite.
            </Text>
          </View>

          <View style={styles.pillGrid}>
            {occasionOptions.map((opt) => {
              const active = selectedOccasions.includes(opt.id);
              return (
                <PressableScale
                  key={opt.id}
                  style={[
                    styles.pill,
                    active && { backgroundColor: `${opt.color}20`, borderColor: opt.color },
                  ]}
                  onPress={() => toggleOccasion(opt.id)}
                >
                  <Text style={[styles.pillIcon, { color: active ? opt.color : colors.muted }]}>
                    {opt.icon}
                  </Text>
                  <Text style={[styles.pillLabel, active && { color: colors.cream }]}>
                    {opt.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          <PressableScale style={styles.primaryButton} onPress={handleComplete}>
            <Text style={styles.primaryButtonText}>Crea le mie liste</Text>
            <Text style={styles.primaryButtonArrow}>→</Text>
          </PressableScale>

          <PressableScale style={styles.skipButton} onPress={handleComplete}>
            <Text style={styles.skipText}>Salta e continua</Text>
          </PressableScale>
        </View>
      );
    }

    // Completion
    const displayName = firstName.trim()
      ? firstName.trim().charAt(0).toUpperCase() + firstName.trim().slice(1)
      : null;

    const lists = displayLists.length > 0 ? displayLists : listsRef.current;

    return (
      <View style={styles.stepContent}>
        <View style={styles.completionIconRow}>
          <View style={styles.completionIconBadge}>
            <Text style={styles.completionIconText}>✦</Text>
          </View>
        </View>

        <View style={styles.stepHead}>
          <Text style={styles.completionKicker}>TUTTO PRONTO</Text>
          <Text style={styles.completionTitle}>
            {displayName ? `Benvenuto,\n${displayName}.` : "Benvenuto\nin Mellory."}
          </Text>
          <Text style={styles.stepSub}>
            Abbiamo creato {lists.length} liste personali per iniziare.
          </Text>
        </View>

        <View style={styles.listsPreview}>
          {lists.map((list) => (
            <View key={list.id} style={styles.listPreviewItem}>
              <View style={[styles.listPreviewAccent, { backgroundColor: list.color }]} />
              <View style={[styles.listPreviewDot, { backgroundColor: `${list.color}20` }]}>
                <View style={[styles.listPreviewDotInner, { backgroundColor: list.color }]} />
              </View>
              <View style={styles.listPreviewBody}>
                <Text numberOfLines={1} style={styles.listPreviewTitle}>{list.title}</Text>
                <Text numberOfLines={1} style={styles.listPreviewSub}>{list.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <PressableScale style={[styles.primaryButton, styles.completionButton]} onPress={enterApp}>
          <Text style={styles.primaryButtonText}>Entra in Mellory</Text>
          <Text style={styles.primaryButtonArrow}>→</Text>
        </PressableScale>
      </View>
    );
  }

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Progress bar */}
        {showProgress && (
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
        )}

        {/* Back button */}
        {step >= 1 && step <= 4 && (
          <PressableScale style={styles.backButton} onPress={goBack}>
            <Text style={styles.backButtonText}>‹</Text>
          </PressableScale>
        )}

        {/* Animated content */}
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            flex: 1,
          }}
        >
          {renderStep()}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },

  progressTrack: {
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.card2,
    marginBottom: 28,
    overflow: "hidden",
  },
  progressFill: {
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  backButtonText: {
    color: colors.cream,
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "400",
    marginTop: -2,
  },

  // Welcome step
  stepWelcome: {
    flex: 1,
    justifyContent: "space-between",
    minHeight: 520,
    paddingVertical: 12,
  },
  welcomeTop: {
    alignItems: "flex-start",
    gap: 18,
    marginBottom: 32,
  },
  welcomeMonogram: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  welcomeMonogramText: {
    color: colors.paperText,
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -1,
  },
  welcomeRule: {
    width: 36,
    height: 2.5,
    borderRadius: 999,
    backgroundColor: colors.pink,
  },
  welcomeBody: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
    marginBottom: 36,
  },
  welcomeWordmark: {
    color: colors.cream,
    fontSize: 58,
    lineHeight: 64,
    fontWeight: "900",
    letterSpacing: -2.2,
  },
  welcomeKicker: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  welcomeTagline: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "400",
    maxWidth: 300,
  },
  welcomeNote: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 16,
    letterSpacing: 0.2,
  },

  // Content steps
  stepContent: {
    flex: 1,
    minHeight: 480,
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  stepHead: {
    gap: 10,
    marginBottom: 32,
  },
  stepKicker: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  stepTitle: {
    color: colors.cream,
    fontSize: 38,
    lineHeight: 43,
    fontWeight: "900",
    letterSpacing: -1.2,
  },
  stepSub: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 310,
  },

  // Inputs
  inputGroup: {
    gap: 12,
    marginBottom: 20,
  },
  input: {
    height: 58,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    color: colors.cream,
    fontSize: 18,
    fontWeight: "500",
    paddingHorizontal: 20,
    marginBottom: 2,
  },

  // Pills
  pillGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.softBorder,
  },
  pillIcon: {
    fontSize: 16,
    lineHeight: 20,
    color: colors.muted,
  },
  pillLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },

  // Buttons
  primaryButton: {
    height: 60,
    borderRadius: 999,
    backgroundColor: colors.pink,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 4,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonMuted: {
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
  },
  primaryButtonText: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  primaryButtonArrow: {
    color: colors.cream,
    fontSize: 18,
    fontWeight: "700",
  },
  skipButton: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  skipText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },

  // Completion step
  completionIconRow: {
    marginBottom: 24,
  },
  completionIconBadge: {
    width: 68,
    height: 68,
    borderRadius: 999,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  completionIconText: {
    color: colors.cream,
    fontSize: 28,
    fontWeight: "900",
  },
  completionKicker: {
    color: colors.pink,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  completionTitle: {
    color: colors.cream,
    fontSize: 38,
    lineHeight: 43,
    fontWeight: "900",
    letterSpacing: -1.2,
  },
  completionButton: {
    backgroundColor: colors.cream,
  },

  // Lists preview
  listsPreview: {
    gap: 9,
    marginBottom: 28,
  },
  listPreviewItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: colors.softBorder,
    overflow: "hidden",
    minHeight: 60,
  },
  listPreviewAccent: {
    width: 4,
    alignSelf: "stretch",
  },
  listPreviewDot: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
    flexShrink: 0,
  },
  listPreviewDotInner: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  listPreviewBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  listPreviewTitle: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  listPreviewSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
  },
});
