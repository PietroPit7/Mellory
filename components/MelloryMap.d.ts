import type { ReactElement } from "react";

export type MelloryMapMarker = {
  id: string;
  name: string;
  category: string;
  detail: string;
  latitude: number;
  longitude: number;
  color?: string;
};

export type MelloryMapCenter = {
  latitude: number;
  longitude: number;
  zoom: number;
};

export type MelloryMapProps = {
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

export default function MelloryMap(props: MelloryMapProps): ReactElement;
