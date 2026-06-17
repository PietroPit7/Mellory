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

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = markers.map((marker) => {
      const markerElement = document.createElement("button");
      markerElement.type = "button";
      markerElement.setAttribute("aria-label", marker.name);
      markerElement.title = `${marker.name} - ${marker.category}`;
      markerElement.style.width = "42px";
      markerElement.style.height = "42px";
      markerElement.style.borderRadius = "999px";
      markerElement.style.border = `3px solid ${colors.paper}`;
      markerElement.style.background = marker.color || colors.pink;
      markerElement.style.display = "flex";
      markerElement.style.alignItems = "center";
      markerElement.style.justifyContent = "center";
      markerElement.style.padding = "0";
      markerElement.style.cursor = "pointer";
      markerElement.style.boxShadow = "0 14px 28px rgba(7, 6, 4, 0.28)";

      const markerInitial = document.createElement("span");
      markerInitial.textContent =
        marker.name.trim().charAt(0).toUpperCase() || "M";
      markerInitial.style.width = "24px";
      markerInitial.style.height = "24px";
      markerInitial.style.borderRadius = "999px";
      markerInitial.style.background = colors.paper;
      markerInitial.style.color = colors.paperText;
      markerInitial.style.display = "flex";
      markerInitial.style.alignItems = "center";
      markerInitial.style.justifyContent = "center";
      markerInitial.style.fontSize = "12px";
      markerInitial.style.fontWeight = "900";
      markerInitial.style.fontFamily =
        "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

      markerElement.appendChild(markerInitial);
      markerElement.addEventListener("click", () => onMarkerPress(marker.id));

      return new maplibregl.Marker({
        element: markerElement,
        anchor: "center",
      })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(map);
    });

    return () => {
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
