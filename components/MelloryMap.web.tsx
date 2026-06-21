import { useEffect, useRef, useState, type CSSProperties } from "react";
import maplibregl from "maplibre-gl";
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

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    streets: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    {
      id: "streets",
      type: "raster" as const,
      source: "streets",
      paint: { "raster-opacity": 0.78 },
    },
  ],
};

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
    if (resetUserToggleTimer !== null) window.clearTimeout(resetUserToggleTimer);
    resetUserToggleTimer = window.setTimeout(() => {
      isUserToggling = false;
      resetUserToggleTimer = null;
    }, USER_ATTRIBUTION_TOGGLE_WINDOW_MS);
  };

  const collapseIfAutomatic = () => {
    if (!isUserToggling) collapseAttributionControl(container);
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
  observer.observe(container, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
  container.addEventListener("pointerdown", handlePointerDown, true);
  container.addEventListener("keydown", handleKeyDown, true);
  collapseIfAutomatic();

  return () => {
    if (resetUserToggleTimer !== null) window.clearTimeout(resetUserToggleTimer);
    observer.disconnect();
    container.removeEventListener("pointerdown", handlePointerDown, true);
    container.removeEventListener("keydown", handleKeyDown, true);
  };
}

function createPointElement(color: string, initial: string, title: string) {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  Object.assign(el.style, {
    width: "36px", height: "36px", borderRadius: "50%",
    border: `2.5px solid rgba(255,255,255,0.9)`,
    background: color, display: "flex", alignItems: "center",
    justifyContent: "center", padding: "0", cursor: "pointer",
    boxShadow: "0 8px 20px rgba(7,6,4,0.32)",
  });
  const span = document.createElement("span");
  span.textContent = initial;
  Object.assign(span.style, {
    color: "#fff", fontSize: "13px", fontWeight: "900",
    fontFamily: "system-ui,-apple-system,sans-serif",
  });
  el.appendChild(span);
  return el;
}

function createClusterElement(count: string) {
  const size = count.length > 2 ? 52 : 44;
  const el = document.createElement("button");
  el.type = "button";
  el.title = `${count} locali`;
  Object.assign(el.style, {
    width: `${size}px`, height: `${size}px`, borderRadius: "50%",
    border: `2px solid rgba(255,255,255,0.9)`, background: colors.pink,
    color: "#fff", display: "flex", alignItems: "center",
    justifyContent: "center", cursor: "pointer",
    fontSize: "15px", fontWeight: "900",
    fontFamily: "system-ui,-apple-system,sans-serif",
    boxShadow: "0 10px 24px rgba(7,6,4,0.36)",
  });
  el.textContent = count;
  return el;
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
  const [hasMapError, setHasMapError] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter = initialCenterRef.current;

    try {
      mapRef.current = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [initialCenter.longitude, initialCenter.latitude],
        zoom: initialCenter.zoom,
        attributionControl: false,
      });
    } catch {
      setHasMapError(true);
      return;
    }

    // Attribution is required by OSM/CARTO licence — kept compact in top-left.
    mapRef.current.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "top-left"
    );
    const cleanupAttributionGuard = setupAttributionControlGuard(containerRef.current);

    return () => {
      cleanupAttributionGuard();
      markerRefs.current.forEach((m) => m.remove());
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
      const c = map.getCenter();
      onRegionChange({ latitude: c.lat, longitude: c.lng, zoom: map.getZoom() });
    };

    map.on("moveend", handleMoveEnd);
    return () => { map.off("moveend", handleMoveEnd); };
  }, [onRegionChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: markers.map((marker) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [marker.longitude, marker.latitude] },
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
      if (cancelled || !activeMap || !activeMap.getSource(MELLORY_SOURCE_ID)) return;

      markerRefs.current.forEach((m) => m.remove());
      markerRefs.current = [];

      const features = activeMap.querySourceFeatures(MELLORY_SOURCE_ID);
      const seenClusters = new Set<number>();
      const seenPoints = new Set<string>();

      features.forEach((feature) => {
        const props = feature.properties || {};
        const geom = feature.geometry;
        if (!geom || geom.type !== "Point") return;
        const coords = geom.coordinates as [number, number];

        if (props.cluster) {
          const clusterId = props.cluster_id as number;
          if (seenClusters.has(clusterId)) return;
          seenClusters.add(clusterId);

          const count = props.point_count_abbreviated ?? props.point_count ?? "";
          const el = createClusterElement(String(count));
          el.addEventListener("click", () => {
            const source = activeMap.getSource(MELLORY_SOURCE_ID) as maplibregl.GeoJSONSource;
            source.getClusterExpansionZoom(clusterId).then((zoom) => {
              activeMap.easeTo({ center: coords, zoom, duration: 500 });
            });
          });
          markerRefs.current.push(
            new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coords).addTo(activeMap)
          );
        } else {
          const id = String(props.id ?? "");
          if (!id || seenPoints.has(id)) return;
          seenPoints.add(id);

          const el = createPointElement(
            String(props.color || colors.pink),
            String(props.initial || "M"),
            String(props.title || "")
          );
          el.addEventListener("click", () => onMarkerPress(id));
          markerRefs.current.push(
            new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coords).addTo(activeMap)
          );
        }
      });
    }

    function setupSource() {
      const activeMap = mapRef.current;
      if (cancelled || !activeMap) return;

      const existing = activeMap.getSource(MELLORY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

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
      if (event.sourceId === MELLORY_SOURCE_ID && mapRef.current?.isSourceLoaded(MELLORY_SOURCE_ID)) {
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
      markerRefs.current.forEach((m) => m.remove());
      markerRefs.current = [];
    };
  }, [markers, onMarkerPress]);

  const frameStyle: CSSProperties = fullScreen
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden", backgroundColor: colors.black }
    : { position: "relative", height: 640, width: "100%", borderRadius: 28, overflow: "hidden", backgroundColor: colors.black };

  return (
    <div style={frameStyle}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {hasMapError ? (
        <div style={fallbackStyle}>
          <div style={{ color: colors.cream, fontSize: 20, fontWeight: 900 }}>Mappa non disponibile</div>
          <div style={{ maxWidth: 280, color: colors.muted, fontSize: 14, lineHeight: 1.45, fontWeight: 700 }}>
            Riprova tra poco: i luoghi restano comunque nella lista.
          </div>
        </div>
      ) : null}
    </div>
  );
}

const fallbackStyle: CSSProperties = {
  position: "absolute", inset: 0,
  display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  gap: 8, padding: 24, textAlign: "center",
  backgroundColor: melloryThemeVars.black,
};
