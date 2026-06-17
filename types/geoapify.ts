export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type CitySuggestion = Coordinates & {
  id: string;
  label: string;
  detail: string;
  cityLabel: string;
  detailLabel: string;
};

export type NearbyPlace = Coordinates & {
  id: string;
  name: string;
  category: string;
  categoryBase: string;
  detail: string;
  distance: string;
  distanceMeters: number;
  website: string;
  phone: string;
  openingHours: string;
  editorialAwards: string;
};

export type GeoapifyPointGeometry = {
  type?: string;
  coordinates?: [number, number] | number[];
};

export type GeoapifyFeature<TProperties> = {
  type?: string;
  properties?: TProperties;
  geometry?: GeoapifyPointGeometry;
};

export type GeoapifyFeatureCollection<TProperties> = {
  type?: string;
  features?: GeoapifyFeature<TProperties>[];
};

export type GeoapifyCityProperties = {
  place_id?: string;
  name?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  result_type?: string;
  lat?: number;
  lon?: number;
};

export type GeoapifyPlaceProperties = {
  place_id?: string;
  name?: string;
  categories?: string[];
  category?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  street?: string;
  housenumber?: string;
  lat?: number;
  lon?: number;
  distance?: number;
  website?: string;
  contact_website?: string;
  phone?: string;
  contact_phone?: string;
  opening_hours?: string;
};
