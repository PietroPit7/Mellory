import { Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useResponsiveLayout } from "@/components/responsive-layout";
import { type MelloryThemeColors, useMelloryTheme } from "@/contexts/mellory-theme";

type TabIconName = "discover" | "list" | "map" | "bookmark";

function TabIcon({
  name,
  focused,
  colors,
}: {
  name: TabIconName;
  focused: boolean;
  colors: MelloryThemeColors;
}) {
  const tint = focused ? colors.pink : colors.muted;
  const scale = useRef(new Animated.Value(focused ? 1 : 0.88)).current;
  const opacity = useRef(new Animated.Value(focused ? 1 : 0.65)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0.88,
      useNativeDriver: true,
      speed: 40,
      bounciness: focused ? 10 : 0,
    }).start();
    Animated.timing(opacity, {
      toValue: focused ? 1 : 0.65,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [focused, scale, opacity]);

  const animStyle = { transform: [{ scale }], opacity } as const;

  if (name === "discover") {
    return (
      <Animated.View style={[styles.iconBox, animStyle]}>
        <View style={[styles.compassCircle, { borderColor: tint }]}>
          <View style={styles.compassNeedleWrap}>
            <View style={[styles.compassNeedleTop, { borderBottomColor: tint }]} />
            <View style={[styles.compassNeedleBottom, { borderTopColor: tint }]} />
          </View>
        </View>
      </Animated.View>
    );
  }

  if (name === "list") {
    return (
      <Animated.View style={[styles.iconBox, animStyle]}>
        <View style={styles.listIcon}>
          <View style={[styles.listDot, { backgroundColor: tint }]} />
          <View style={[styles.listLine, { backgroundColor: tint }]} />
          <View style={[styles.listDot, { backgroundColor: tint }]} />
          <View style={[styles.listLine, { backgroundColor: tint }]} />
          <View style={[styles.listDot, { backgroundColor: tint }]} />
          <View style={[styles.listLine, { backgroundColor: tint }]} />
        </View>
      </Animated.View>
    );
  }

  if (name === "map") {
    return (
      <Animated.View style={[styles.iconBox, animStyle]}>
        <View style={styles.mapIcon}>
          <View
            style={[
              styles.mapPanel,
              styles.mapPanelLeft,
              { borderColor: tint },
            ]}
          />
          <View
            style={[
              styles.mapPanel,
              styles.mapPanelCenter,
              { borderColor: tint },
            ]}
          />
          <View
            style={[
              styles.mapPanel,
              styles.mapPanelRight,
              { borderColor: tint },
            ]}
          />
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.iconBox, animStyle]}>
      <View style={[styles.bookmarkIcon, { borderColor: tint }]}>
        <View
          style={[
            styles.bookmarkPointLeft,
            {
              borderBottomColor: tint,
              backgroundColor: colors.card,
            },
          ]}
        />
        <View
          style={[
            styles.bookmarkPointRight,
            {
              borderBottomColor: tint,
              backgroundColor: colors.card,
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

export default function TabLayout() {
  const { colors } = useMelloryTheme();
  const { isDesktopWeb } = useResponsiveLayout();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktopWeb ? "left" : "bottom",
        tabBarActiveTintColor: colors.pink,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelPosition: "below-icon",
        tabBarStyle: isDesktopWeb
          ? {
              position: "absolute",
              left: 18,
              top: 18,
              bottom: 18,
              width: 78,
              height: undefined,
              borderRadius: 30,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              paddingTop: 18,
              paddingBottom: 18,
              elevation: 0,
              shadowOpacity: 0,
            }
          : {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 88,
              backgroundColor: colors.card,
              borderTopWidth: 0.5,
              borderTopColor: colors.border,
              paddingTop: 10,
              paddingBottom: 20,
              elevation: 0,
              shadowOpacity: 0,
            },
        tabBarIconStyle: {
          width: 34,
          height: 30,
          marginBottom: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: isDesktopWeb ? 0.4 : 0.8,
          textTransform: "uppercase",
          marginTop: 3,
        },
        tabBarItemStyle: {
          height: isDesktopWeb ? 76 : 62,
          paddingTop: 2,
          paddingBottom: 0,
          alignItems: "center",
          justifyContent: "center",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Scopri",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="discover" focused={focused} colors={colors} />
          ),
        }}
      />

      <Tabs.Screen
        name="lists"
        options={{
          title: "Liste",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="list" focused={focused} colors={colors} />
          ),
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: "Mappa",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="map" focused={focused} colors={colors} />
          ),
        }}
      />

      <Tabs.Screen
        name="mellory"
        options={{
          title: "My Mellory",
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bookmark" focused={focused} colors={colors} />
          ),
        }}
      />

    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconBox: {
    width: 34,
    height: 31,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  compassCircle: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2.4,
    alignItems: "center",
    justifyContent: "center",
  },
  compassNeedleWrap: {
    width: 16,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "34deg" }],
  },
  compassNeedleTop: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  compassNeedleBottom: {
    width: 0,
    height: 0,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    opacity: 0.28,
    marginTop: -1,
  },

  listIcon: {
    width: 28,
    height: 27,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    alignItems: "center",
    rowGap: 5,
    columnGap: 5,
  },
  listDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  listLine: {
    width: 18,
    height: 2.3,
    borderRadius: 999,
  },

  mapIcon: {
    width: 33,
    height: 29,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  mapPanel: {
    width: 11,
    height: 25,
    borderTopWidth: 2.2,
    borderBottomWidth: 2.2,
  },
  mapPanelLeft: {
    borderLeftWidth: 2.2,
    borderRightWidth: 1.1,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    transform: [{ skewY: "-14deg" }],
  },
  mapPanelCenter: {
    borderLeftWidth: 1.1,
    borderRightWidth: 1.1,
    transform: [{ skewY: "14deg" }],
  },
  mapPanelRight: {
    borderLeftWidth: 1.1,
    borderRightWidth: 2.2,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    transform: [{ skewY: "-14deg" }],
  },

  bookmarkIcon: {
    width: 23,
    height: 30,
    borderWidth: 2.4,
    borderRadius: 4,
    borderBottomWidth: 0,
    position: "relative",
    overflow: "hidden",
  },
  bookmarkPointLeft: {
    position: "absolute",
    width: 0,
    height: 0,
    left: 2,
    bottom: -1,
    borderLeftWidth: 9,
    borderRightWidth: 0,
    borderBottomWidth: 10,
    borderLeftColor: "transparent",
  },
  bookmarkPointRight: {
    position: "absolute",
    width: 0,
    height: 0,
    right: 2,
    bottom: -1,
    borderLeftWidth: 0,
    borderRightWidth: 9,
    borderBottomWidth: 10,
    borderRightColor: "transparent",
  },
});
