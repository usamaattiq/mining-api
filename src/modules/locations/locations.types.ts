export type ResolvedLocationDto = {
  address: string;
  town?: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
};

export type PlacePredictionDto = {
  placeId: string;
  description: string;
};
