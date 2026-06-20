import { useEffect, useRef, useState } from "react";
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  type Region,
} from "react-native-maps";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { melloryThemeVars } from "@/contexts/mellory-theme";

type MelloryMapMarker = {
  id: string;
  name: string;
  category: string;
  detail: string;
  latitude: number;
  longitude: number;
  color?: string;
};

type MelloryMapCenter = {
  latitude: number;
  longitude: number;
  zoom: number;
};

type MelloryMapLayer = "streets" | "satellite";

type MelloryMapProps = {
  markers: MelloryMapMarker[];
  center: MelloryMapCenter;
  onMarkerPress: (placeId: string) => void;
  onRegionChange?: (center: MelloryMapCenter) => void;
  onPoiPress?: (poi: {
    name: string;
    placeId: string;
    latitude: number;
    longitude: number;
  }) => void;
  fullScreen?: boolean;
};

const colors = melloryThemeVars;

const MAP_LAYER_OPTIONS: { id: MelloryMapLayer; label: string }[] = [
  { id: "streets", label: "Strade" },
  { id: "satellite", label: "Satellite" },
];

// Zoom (MapLibre / tile convention) ↔ latitudeDelta (react-native-maps)
function zoomToLatDelta(zoom: number): number {
  return 360 / Math.pow(2, zoom);
}

export default function MelloryMap({
  markers,
  center,
  onMarkerPress,
  onRegionChange,
  onPoiPress,
  fullScreen = false,
}: MelloryMapProps) {
  const mapRef = useRef<MapView>(null);
  const [mapLayer, setMapLayer] = useState<MelloryMapLayer>("streets");
  const currentZoomRef = useRef(center.zoom);
  const prevCenterRef = useRef({ ...center });

  // Anima la camera quando il centro cambia dall'esterno (ricerca, selezione
  // marcatore ecc.) senza interferire con il pan/zoom dell'utente.
  useEffect(() => {
    const prev = prevCenterRef.current;
    if (
      prev.latitude === center.latitude &&
      prev.longitude === center.longitude &&
      prev.zoom === center.zoom
    ) {
      return;
    }
    prevCenterRef.current = { ...center };
    const delta = zoomToLatDelta(center.zoom);
    mapRef.current?.animateToRegion(
      {
        latitude: center.latitude,
        longitude: center.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      650
    );
  }, [center.latitude, center.longitude, center.zoom]);

  function handleRegionChangeComplete(region: Region) {
    const zoom = Math.log2(360 / region.latitudeDelta);
    currentZoomRef.current = zoom;
    onRegionChange?.({
      latitude: region.latitude,
      longitude: region.longitude,
      zoom,
    });
  }

  function handleZoom(delta: number) {
    const newZoom = Math.max(3, Math.min(20, currentZoomRef.current + delta));
    mapRef.current?.animateCamera({ zoom: newZoom }, { duration: 250 });
    currentZoomRef.current = newZoom;
  }

  const initialDelta = zoomToLatDelta(center.zoom);

  return (
    <View
      style={[
        styles.frame,
        fullScreen && StyleSheet.absoluteFill,
        fullScreen && { borderRadius: 0 },
      ]}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        mapType={mapLayer === "satellite" ? "satellite" : "standard"}
        initialRegion={{
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: initialDelta,
          longitudeDelta: initialDelta,
        }}
        showsUserLocation
        showsPointsOfInterests
        showsBuildings
        showsCompass={false}
        toolbarEnabled={false}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPoiClick={(event) => {
          const { name, placeId, coordinate } = event.nativeEvent;
          onPoiPress?.({
            name,
            placeId,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
          });
        }}
      >
        {markers.map((marker) => (
          <Marker
            key={`${marker.id}-${marker.latitude}-${marker.longitude}`}
            coordinate={{
              latitude: marker.latitude,
              longitude: marker.longitude,
            }}
            onPress={() => onMarkerPress(marker.id)}
          >
            <View
              style={[
                styles.marker,
                { backgroundColor: marker.color || colors.pink },
              ]}
            >
              <View style={styles.markerInner}>
                <Text style={styles.markerInitial}>
                  {marker.name.trim().charAt(0).toUpperCase() || "M"}
                </Text>
              </View>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Layer + zoom controls — floated above the map */}
      <View pointerEvents="box-none" style={styles.controlDeck}>
        <View style={styles.layerControl}>
          {MAP_LAYER_OPTIONS.map((option) => {
            const isActive = mapLayer === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`Mostra ${option.label}`}
                style={[
                  styles.layerButton,
                  isActive && styles.layerButtonActive,
                ]}
                onPress={() => setMapLayer(option.id)}
              >
                <View
                  style={[
                    styles.layerSwatch,
                    option.id === "satellite" && styles.layerSwatchSatellite,
                  ]}
                />
                <Text
                  style={[
                    styles.layerButtonText,
                    isActive && styles.layerButtonTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.zoomControl}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Avvicina"
            style={styles.zoomButton}
            onPress={() => handleZoom(1)}
          >
            <Text style={styles.zoomButtonText}>+</Text>
          </Pressable>
          <View style={styles.zoomDivider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Allontana"
            style={styles.zoomButton}
            onPress={() => handleZoom(-1)}
          >
            <Text style={styles.zoomButtonText}>−</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "relative",
    height: 640,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: colors.black,
  },
  map: {
    flex: 1,
  },
  // Controls are vertically centered on the right side — safely between
  // the top-card overlay (map.tsx) and the bottom panel.
  controlDeck: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 14,
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 10,
  },
  layerControl: {
    flexDirection: "column",
    gap: 4,
    padding: 4,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.16)",
    backgroundColor: "rgba(7,6,4,0.74)",
    boxShadow: "0 12px 24px rgba(0,0,0,0.28)",
  },
  layerButton: {
    width: 42,
    height: 38,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  layerButtonActive: {
    backgroundColor: colors.paper,
  },
  layerSwatch: {
    width: 11,
    height: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(7,6,4,0.18)",
    backgroundColor: colors.pink,
  },
  layerSwatchSatellite: {
    backgroundColor: "#6C8D72",
  },
  layerButtonText: {
    color: colors.cream,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "900",
  },
  layerButtonTextActive: {
    color: colors.black,
  },
  zoomControl: {
    width: 42,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.16)",
    backgroundColor: "rgba(7,6,4,0.74)",
    boxShadow: "0 12px 24px rgba(0,0,0,0.28)",
  },
  zoomButton: {
    width: 42,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomButtonText: {
    color: colors.cream,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "800",
  },
  zoomDivider: {
    height: 1,
    backgroundColor: "rgba(255,248,239,0.14)",
  },
  marker: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  markerInner: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  markerInitial: {
    color: colors.paperText,
    fontSize: 12,
    fontWeight: "900",
  },
});
