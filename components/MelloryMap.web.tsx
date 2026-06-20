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

const MELLORY_SOURCE_ID = "mellory-places";
const USER_ATTRIBUTION_TOGGLE_WINDOW_MS = 500;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

function collapseAttributionControl(container: HTMLDivElement | null) {
  container
    ?.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")
    ?.classList.remove("maplibregl-compact-show");
}

function setupAttributionControlGuard(container: HTMLDivElement | null) {
  if (!container) return () => {};

  let isUserToggling = false;
  let resetUserToggleTimer: number | null = null;

  const markUserToggle = () => {
    isUserToggling = true;

    if (resetUserToggleTimer !== null) {
      window.clearTimeout(resetUserToggleTimer);
    }

    resetUserToggleTimer = window.setTimeout(() => {
      isUserToggling = false;
      resetUserToggleTimer = null;
    }, USER_ATTRIBUTION_TOGGLE_WINDOW_MS);
  };

  const collapseIfAutomatic = () => {
    if (!isUserToggling) {
      collapseAttributionControl(container);
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".maplibregl-ctrl-attrib-button")
    ) {
      markUserToggle();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target instanceof Element &&
      event.target.closest(".maplibregl-ctrl-attrib-button")
    ) {
      markUserToggle();
    }
  };

  const observer = new MutationObserver(collapseIfAutomatic);

  observer.observe(container, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });

  container.addEventListener("pointerdown", handlePointerDown, true);
  container.addEventListener("keydown", handleKeyDown, true);
  collapseIfAutomatic();

  return () => {
    if (resetUserToggleTimer !== null) {
      window.clearTimeout(resetUserToggleTimer);
    }

    observer.disconnect();
    container.removeEventListener("pointerdown", handlePointerDown, true);
    container.removeEventListener("keydown", handleKeyDown, true);
  };
}

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

function applyMapLayer(map: maplibregl.Map, mapLayer: MelloryMapLayer) {
  if (!map.getLayer("streets") || !map.getLayer("satellite")) return;

  map.setLayoutProperty(
    "streets",
    "visibility",
    mapLayer === "satellite" ? "none" : "visible"
  );
  map.setLayoutProperty(
    "satellite",
    "visibility",
    mapLayer === "satellite" ? "visible" : "none"
  );
}

export default function MelloryMap({
  markers,
  center,
  onMarkerPress,
  onRegionChange,
  fullScreen = false,
}: MelloryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const initialCenterRef = useRef(center);
  const [mapLayer, setMapLayer] = useState<MelloryMapLayer>("streets");
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
        style: createMelloryMapStyle("streets"),
        center: [initialCenter.longitude, initialCenter.latitude],
        zoom: initialCenter.zoom,
        attributionControl: false,
      });
    } catch {
      setHasMapError(true);
      return;
    }

    // Attribuzione OSM/CARTO/Esri: richiesta dalle licenze delle tile.
    // In alto a sinistra così non finisce sotto la preview del locale.
    mapRef.current.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "top-left"
    );
    const cleanupAttributionControlGuard = setupAttributionControlGuard(
      containerRef.current
    );

    return () => {
      cleanupAttributionControlGuard();
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateLayer = () => applyMapLayer(map, mapLayer);

    if (map.isStyleLoaded()) {
      updateLayer();
    } else {
      map.once("load", updateLayer);
    }

    return () => {
      map.off("load", updateLayer);
    };
  }, [mapLayer]);

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

  function handleZoom(delta: number) {
    const map = mapRef.current;
    if (!map) return;

    const nextZoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, map.getZoom() + delta)
    );

    map.easeTo({ zoom: nextZoom, duration: 260 });
  }

  const frameStyle: CSSProperties = fullScreen
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden", backgroundColor: colors.black }
    : styles.frame;

  return (
    <div style={frameStyle}>
      <div ref={containerRef} style={styles.mapCanvas} />

      <div style={styles.controlColumn}>
        <button
          type="button"
          title={mapLayer === "satellite" ? "Mostra strade" : "Mostra satellite"}
          aria-label={
            mapLayer === "satellite" ? "Mostra strade" : "Mostra satellite"
          }
          style={{
            ...styles.controlCard,
            ...styles.iconButton,
            ...(mapLayer === "satellite" ? styles.iconButtonActive : {}),
          }}
          onClick={() =>
            setMapLayer(mapLayer === "streets" ? "satellite" : "streets")
          }
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3 2 8l10 5 10-5-10-5Z" />
            <path d="m2 13 10 5 10-5" />
            <path d="m2 18 10 5 10-5" />
          </svg>
        </button>

        <div style={{ ...styles.controlCard, ...styles.zoomGroup }}>
          <button
            type="button"
            title="Avvicina"
            aria-label="Avvicina"
            style={styles.zoomButton}
            onClick={() => handleZoom(1)}
          >
            +
          </button>
          <div style={styles.zoomDivider} />
          <button
            type="button"
            title="Allontana"
            aria-label="Allontana"
            style={styles.zoomButton}
            onClick={() => handleZoom(-1)}
          >
            −
          </button>
        </div>
      </div>

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
  mapCanvas: {
    position: "absolute",
    inset: 0,
  },
  controlColumn: {
    position: "absolute",
    top: 14,
    right: 14,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 10,
    pointerEvents: "none",
    zIndex: 2,
  },
  controlCard: {
    border: "1px solid rgba(255,248,239,0.16)",
    background: "rgba(7,6,4,0.72)",
    boxShadow: "0 12px 24px rgba(0,0,0,0.28)",
    backdropFilter: "blur(10px)",
    pointerEvents: "auto",
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: colors.cream,
    cursor: "pointer",
  },
  iconButtonActive: {
    background: colors.paper,
    color: colors.paperText,
  },
  zoomGroup: {
    width: 42,
    overflow: "hidden",
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
  },
  zoomButton: {
    width: 42,
    height: 40,
    border: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: colors.cream,
    cursor: "pointer",
    fontSize: 22,
    lineHeight: "22px",
    fontWeight: 800,
  },
  zoomDivider: {
    height: 1,
    background: "rgba(255,248,239,0.14)",
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
