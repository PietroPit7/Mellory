import { useState } from "react";
import {
  Camera,
  Map,
  Marker,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
import { StyleSheet, Text, View } from "react-native";

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

type MelloryMapProps = {
  markers: MelloryMapMarker[];
  center: MelloryMapCenter;
  onMarkerPress: (placeId: string) => void;
  onRegionChange?: (center: MelloryMapCenter) => void;
};

const colors = melloryThemeVars;

const MELLORY_MAP_STYLE: StyleSpecification = {
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
      paint: {
        "raster-opacity": 0.78,
      },
    },
    {
      id: "satellite",
      type: "raster",
      source: "satellite",
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

export default function MelloryMap({
  markers,
  center,
  onMarkerPress,
  onRegionChange,
}: MelloryMapProps) {
  const [hasMapError, setHasMapError] = useState(false);

  return (
    <View style={styles.frame}>
      <Map
        style={styles.map}
        mapStyle={MELLORY_MAP_STYLE}
        logo={false}
        compass
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

          onRegionChange?.({
            latitude,
            longitude,
            zoom: event.nativeEvent.zoom,
          });
        }}
      >
        <Camera
          center={[center.longitude, center.latitude]}
          zoom={center.zoom}
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
    height: 540,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: colors.black,
  },
  map: {
    flex: 1,
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
