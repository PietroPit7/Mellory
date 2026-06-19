import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Map,
  Marker,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
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
};

const colors = melloryThemeVars;
const MAP_LAYER_OPTIONS: { id: MelloryMapLayer; label: string }[] = [
  { id: "streets", label: "Strade" },
  { id: "satellite", label: "Satellite" },
];
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

function createMelloryMapStyle(mapLayer: MelloryMapLayer): StyleSpecification {
  const isSatellite = mapLayer === "satellite";

  return {
  version: 8,
  sources: {
    streets: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
    satellite: {
      type: "raster",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    labels: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    {
      id: "streets",
      type: "raster",
      source: "streets",
      layout: {
        visibility: isSatellite ? "none" : "visible",
      },
      paint: {
        "raster-opacity": 0.78,
      },
    },
    {
      id: "satellite",
      type: "raster",
      source: "satellite",
      layout: {
        visibility: isSatellite ? "visible" : "none",
      },
      paint: {
        "raster-opacity": 0.86,
        "raster-saturation": -0.18,
      },
    },
    {
      id: "labels",
      type: "raster",
      source: "labels",
      paint: {
        "raster-opacity": 0.9,
      },
    },
  ],
  };
}

export default function MelloryMap({
  markers,
  center,
  onMarkerPress,
  onRegionChange,
}: MelloryMapProps) {
  const [hasMapError, setHasMapError] = useState(false);
  const [mapLayer, setMapLayer] = useState<MelloryMapLayer>("streets");
  const [viewCenter, setViewCenter] = useState(center);
  const mapStyle = useMemo(() => createMelloryMapStyle(mapLayer), [mapLayer]);

  useEffect(() => {
    setViewCenter({
      latitude: center.latitude,
      longitude: center.longitude,
      zoom: center.zoom,
    });
  }, [center.latitude, center.longitude, center.zoom]);

  function handleZoom(delta: number) {
    setViewCenter((currentCenter) => ({
      ...currentCenter,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentCenter.zoom + delta)),
    }));
  }

  return (
    <View style={styles.frame}>
      <Map
        style={styles.map}
        mapStyle={mapStyle}
        logo={false}
        compass={false}
        attribution
        onDidFailLoadingMap={() => setHasMapError(true)}
        onRegionDidChange={(event) => {
          const [longitude, latitude] = event.nativeEvent.center;

          if (
            typeof latitude !== "number" ||
            typeof longitude !== "number"
          ) {
            return;
          }

          const nextCenter = {
            latitude,
            longitude,
            zoom: event.nativeEvent.zoom,
          };

          setViewCenter(nextCenter);
          onRegionChange?.({
            latitude: nextCenter.latitude,
            longitude: nextCenter.longitude,
            zoom: nextCenter.zoom,
          });
        }}
      >
        <Camera
          center={[viewCenter.longitude, viewCenter.latitude]}
          zoom={viewCenter.zoom}
          duration={650}
        />

        {markers.map((marker) => (
          <Marker
            key={`${marker.id}-${marker.latitude}-${marker.longitude}`}
            id={marker.id}
            lngLat={[marker.longitude, marker.latitude]}
            onPress={() => onMarkerPress(marker.id)}
          >
            <View
              style={[
                styles.marker,
                {
                  backgroundColor: marker.color || colors.pink,
                },
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
      </Map>

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
            <Text style={styles.zoomButtonText}>-</Text>
          </Pressable>
        </View>
      </View>

      {hasMapError ? (
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>Mappa non disponibile</Text>
          <Text style={styles.fallbackText}>
            Riprova tra poco: i luoghi restano comunque nella lista.
          </Text>
        </View>
      ) : null}
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
  controlDeck: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  layerControl: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,248,239,0.16)",
    backgroundColor: "rgba(7,6,4,0.74)",
    boxShadow: "0 12px 24px rgba(0,0,0,0.28)",
  },
  layerButton: {
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  layerButtonActive: {
    backgroundColor: colors.paper,
  },
  layerSwatch: {
    width: 13,
    height: 13,
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
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  layerButtonTextActive: {
    color: colors.black,
  },
  zoomControl: {
    position: "absolute",
    top: 0,
    right: 0,
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
  fallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  fallbackTitle: {
    color: colors.cream,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  fallbackText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
});
