import { useEffect, useRef } from "react";
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  type Region,
} from "react-native-maps";
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
  onPoiPress?: (poi: {
    name: string;
    placeId: string;
    latitude: number;
    longitude: number;
  }) => void;
  fullScreen?: boolean;
};

const colors = melloryThemeVars;

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
  const currentZoomRef = useRef(center.zoom);
  const prevCenterRef = useRef({ ...center });

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
        mapType="standard"
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
        showsScale={false}
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
        {markers.map((marker) => {
          const markerColor = marker.color || colors.pink;
          const letter = marker.name.trim().charAt(0).toUpperCase() || "M";
          return (
            <Marker
              key={`${marker.id}-${marker.latitude}-${marker.longitude}`}
              coordinate={{
                latitude: marker.latitude,
                longitude: marker.longitude,
              }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={() => onMarkerPress(marker.id)}
            >
              <View style={styles.markerContainer}>
                <View style={[styles.markerBubble, { backgroundColor: markerColor }]}>
                  <Text style={styles.markerInitial}>{letter}</Text>
                </View>
                <View style={[styles.markerTail, { backgroundColor: markerColor }]} />
              </View>
            </Marker>
          );
        })}
      </MapView>
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
  markerContainer: {
    alignItems: "center",
  },
  markerBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  markerTail: {
    width: 8,
    height: 8,
    marginTop: -4,
    transform: [{ rotate: "45deg" }],
    borderBottomRightRadius: 2,
  },
  markerInitial: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
});
