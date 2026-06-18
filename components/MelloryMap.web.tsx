import { useEffect, useRef, useState, type CSSProperties } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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

const MELLORY_SOURCE_ID = "mellory-places";

function createPointElement(color: string, initial: string, title: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.title = title;
  element.style.width = "42px";
  element.style.height = "42px";
  element.style.borderRadius = "999px";
  element.style.border = `3px solid ${colors.paper}`;
  element.style.background = color;
  element.style.display = "flex";
  element.style.alignItems = "center";
  element.style.justifyContent = "center";
  element.style.padding = "0";
  element.style.cursor = "pointer";
  element.style.boxShadow = "0 14px 28px rgba(7, 6, 4, 0.28)";

  const inner = document.createElement("span");
  inner.textContent = initial;
  inner.style.width = "24px";
  inner.style.height = "24px";
  inner.style.borderRadius = "999px";
  inner.style.background = colors.paper;
  inner.style.color = colors.paperText;
  inner.style.display = "flex";
  inner.style.alignItems = "center";
  inner.style.justifyContent = "center";
  inner.style.fontSize = "12px";
  inner.style.fontWeight = "900";
  inner.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  element.appendChild(inner);
  return element;
}

function createClusterElement(count: string) {
  const size = count.length > 2 ? 56 : 48;
  const element = document.createElement("button");
  element.type = "button";
  element.title = `${count} locali`;
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.style.borderRadius = "999px";
  element.style.border = `2px solid ${colors.paper}`;
  element.style.background = colors.pink;
  element.style.color = colors.paper;
  element.style.display = "flex";
  element.style.alignItems = "center";
  element.style.justifyContent = "center";
  element.style.cursor = "pointer";
  element.style.fontSize = "16px";
  element.style.fontWeight = "900";
  element.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  element.style.boxShadow = "0 16px 30px rgba(7, 6, 4, 0.34)";
  element.textContent = count;
  return element;
}

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const initialCenterRef = useRef(center);
  const [hasMapError, setHasMapError] = useState(false);

  // La mappa viene creata una sola volta: ricrearla a ogni cambio di centro
  // causava flicker e perdita dell'interazione. I cambi di centro sono gestiti
  // in modo fluido dall'effetto easeTo qui sotto.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter = initialCenterRef.current;

    try {
      mapRef.current = new maplibregl.Map({
        container: containerRef.current,
        style: MELLORY_MAP_STYLE,
        center: [initialCenter.longitude, initialCenter.latitude],
        zoom: initialCenter.zoom,
        attributionControl: false,
      });
    } catch {
      setHasMapError(true);
      return;
    }

    mapRef.current.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    // Attribuzione OSM/CARTO/Esri: richiesta dalle licenze delle tile.
    mapRef.current.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRef.current?.easeTo({
      center: [center.longitude, center.latitude],
      zoom: center.zoom,
      duration: 650,
    });
  }, [center.latitude, center.longitude, center.zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onRegionChange) return;

    const handleMoveEnd = () => {
      const nextCenter = map.getCenter();

      onRegionChange({
        latitude: nextCenter.lat,
        longitude: nextCenter.lng,
        zoom: map.getZoom(),
      });
    };

    map.on("moveend", handleMoveEnd);

    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [onRegionChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: markers.map((marker) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [marker.longitude, marker.latitude],
        },
        properties: {
          id: marker.id,
          color: marker.color || colors.pink,
          initial: marker.name.trim().charAt(0).toUpperCase() || "M",
          title: `${marker.name} · ${marker.category}`,
        },
      })),
    };

    function renderMarkers() {
      const activeMap = mapRef.current;
      if (cancelled || !activeMap || !activeMap.getSource(MELLORY_SOURCE_ID)) {
        return;
      }

      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];

      const features = activeMap.querySourceFeatures(MELLORY_SOURCE_ID);
      const seenClusters = new Set<number>();
      const seenPoints = new Set<string>();

      features.forEach((feature) => {
        const properties = feature.properties || {};
        const geometry = feature.geometry;
        if (!geometry || geometry.type !== "Point") return;
        const coordinates = geometry.coordinates as [number, number];

        if (properties.cluster) {
          const clusterId = properties.cluster_id as number;
          if (seenClusters.has(clusterId)) return;
          seenClusters.add(clusterId);

          const count =
            properties.point_count_abbreviated ?? properties.point_count ?? "";
          const element = createClusterElement(String(count));
          element.addEventListener("click", () => {
            const source = activeMap.getSource(
              MELLORY_SOURCE_ID
            ) as maplibregl.GeoJSONSource;
            source.getClusterExpansionZoom(clusterId).then((zoom) => {
              activeMap.easeTo({ center: coordinates, zoom, duration: 500 });
            });
          });

          markerRefs.current.push(
            new maplibregl.Marker({ element, anchor: "center" })
              .setLngLat(coordinates)
              .addTo(activeMap)
          );
        } else {
          const id = String(properties.id ?? "");
          if (!id || seenPoints.has(id)) return;
          seenPoints.add(id);

          const element = createPointElement(
            String(properties.color || colors.pink),
            String(properties.initial || "M"),
            String(properties.title || "")
          );
          element.addEventListener("click", () => onMarkerPress(id));

          markerRefs.current.push(
            new maplibregl.Marker({ element, anchor: "center" })
              .setLngLat(coordinates)
              .addTo(activeMap)
          );
        }
      });
    }

    function setupSource() {
      const activeMap = mapRef.current;
      if (cancelled || !activeMap) return;

      const existing = activeMap.getSource(MELLORY_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;

      if (existing) {
        existing.setData(featureCollection);
      } else {
        activeMap.addSource(MELLORY_SOURCE_ID, {
          type: "geojson",
          data: featureCollection,
          cluster: true,
          clusterRadius: 55,
          clusterMaxZoom: 15,
        });
        // Layer invisibile: serve solo perché querySourceFeatures abbia i tile.
        activeMap.addLayer({
          id: `${MELLORY_SOURCE_ID}-hidden`,
          type: "circle",
          source: MELLORY_SOURCE_ID,
          paint: { "circle-radius": 0, "circle-opacity": 0 },
        });
      }

      renderMarkers();
    }

    const handleSourceData = (event: maplibregl.MapSourceDataEvent) => {
      if (
        event.sourceId === MELLORY_SOURCE_ID &&
        mapRef.current?.isSourceLoaded(MELLORY_SOURCE_ID)
      ) {
        renderMarkers();
      }
    };

    if (map.isStyleLoaded()) {
      setupSource();
    } else {
      map.once("load", setupSource);
    }

    map.on("sourcedata", handleSourceData);
    map.on("moveend", renderMarkers);

    return () => {
      cancelled = true;
      map.off("sourcedata", handleSourceData);
      map.off("moveend", renderMarkers);
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
    };
  }, [markers, onMarkerPress]);

  return (
    <div ref={containerRef} style={styles.frame}>
      {hasMapError ? (
        <div style={styles.fallback}>
          <div style={styles.fallbackTitle}>Mappa non disponibile</div>
          <div style={styles.fallbackText}>
            Riprova tra poco: i luoghi restano comunque nella lista.
          </div>
        </div>
      ) : null}
    </div>
  );
}

const styles = {
  frame: {
    position: "relative",
    height: 640,
    width: "100%",
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: colors.black,
  },
  fallback: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
    textAlign: "center",
    backgroundColor: colors.black,
  },
  fallbackTitle: {
    color: colors.cream,
    fontSize: 20,
    fontWeight: 900,
  },
  fallbackText: {
    maxWidth: 280,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 1.45,
    fontWeight: 700,
  },
} satisfies Record<string, CSSProperties>;
