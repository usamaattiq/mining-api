import { env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { PlacePredictionDto, ResolvedLocationDto } from '../locations.types';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api';

type GoogleAddressComponent = {
  long_name: string;
  types: string[];
};

type GoogleGeocodeResult = {
  formatted_address: string;
  address_components: GoogleAddressComponent[];
  geometry: { location: { lat: number; lng: number } };
};

type GoogleStatusResponse = {
  status?: string;
  error_message?: string;
};

type GoogleAutocompleteResponse = GoogleStatusResponse & {
  predictions?: Array<{ place_id?: string; description?: string }>;
};

type GoogleDetailsResponse = GoogleStatusResponse & {
  result?: GoogleGeocodeResult;
};

type GoogleGeocodeResponse = GoogleStatusResponse & {
  results?: GoogleGeocodeResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asGoogleGeocodeResult(value: unknown): GoogleGeocodeResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.formatted_address !== 'string') return null;
  if (!isRecord(value.geometry) || !isRecord(value.geometry.location)) return null;
  const lat = value.geometry.location.lat;
  const lng = value.geometry.location.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const components = Array.isArray(value.address_components)
    ? value.address_components.filter(
        (component): component is GoogleAddressComponent =>
          isRecord(component) &&
          typeof component.long_name === 'string' &&
          Array.isArray(component.types),
      )
    : [];
  return {
    formatted_address: value.formatted_address,
    address_components: components,
    geometry: { location: { lat, lng } },
  };
}

function parseGeocodeResult(result: GoogleGeocodeResult): ResolvedLocationDto {
  const components = result.address_components ?? [];
  const findComponent = (type: string) =>
    components.find((component) => component.types.includes(type))?.long_name ?? '';

  const town =
    findComponent('sublocality_level_1') ||
    findComponent('sublocality') ||
    findComponent('neighborhood') ||
    findComponent('administrative_area_level_3');
  const city =
    findComponent('locality') ||
    findComponent('postal_town') ||
    findComponent('administrative_area_level_2') ||
    findComponent('administrative_area_level_1');
  const country = findComponent('country');

  return {
    address: result.formatted_address,
    town: town || undefined,
    city,
    country,
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
  };
}

async function googleFetch(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.GOOGLE_MAPS_API_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return (await response.json()) as unknown;
  } catch (error) {
    console.warn(
      `Google Maps request failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    throw new AppError(
      'Location service is temporarily unavailable',
      503,
      ErrorCode.LOCATION_SERVICE_UNAVAILABLE,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function assertGoogleOk(json: GoogleStatusResponse, context: string): void {
  const status = json.status ?? 'UNKNOWN';
  if (status === 'OK' || status === 'ZERO_RESULTS') return;

  console.warn(
    `Google Maps ${context} status=${status}${json.error_message ? `: ${json.error_message}` : ''}`,
  );
  throw new AppError(
    'Location service is temporarily unavailable',
    503,
    ErrorCode.LOCATION_SERVICE_UNAVAILABLE,
  );
}

export const locationsService = {
  async autocomplete(input: string, sessionToken: string): Promise<PlacePredictionDto[]> {
    const trimmed = input.trim();
    if (!trimmed) return [];

    const url =
      `${PLACES_BASE}/place/autocomplete/json?input=${encodeURIComponent(trimmed)}` +
      `&key=${encodeURIComponent(env.GOOGLE_MAPS_SERVER_API_KEY)}` +
      `&sessiontoken=${encodeURIComponent(sessionToken)}`;

    const json = (await googleFetch(url)) as GoogleAutocompleteResponse;
    assertGoogleOk(json, 'autocomplete');
    if (json.status === 'ZERO_RESULTS') return [];

    return (json.predictions ?? [])
      .filter(
        (prediction): prediction is { place_id: string; description: string } =>
          typeof prediction.place_id === 'string' && typeof prediction.description === 'string',
      )
      .map((prediction) => ({
        placeId: prediction.place_id,
        description: prediction.description,
      }));
  },

  async placeDetails(placeId: string, sessionToken: string): Promise<ResolvedLocationDto | null> {
    const url =
      `${PLACES_BASE}/place/details/json?place_id=${encodeURIComponent(placeId)}` +
      `&fields=geometry,formatted_address,address_component` +
      `&key=${encodeURIComponent(env.GOOGLE_MAPS_SERVER_API_KEY)}` +
      `&sessiontoken=${encodeURIComponent(sessionToken)}`;

    const json = (await googleFetch(url)) as GoogleDetailsResponse;
    assertGoogleOk(json, 'details');
    if (json.status === 'ZERO_RESULTS') return null;

    const result = asGoogleGeocodeResult(json.result);
    if (!result) return null;
    return parseGeocodeResult(result);
  },

  async reverseGeocode(lat: number, lng: number): Promise<ResolvedLocationDto | null> {
    const url =
      `${PLACES_BASE}/geocode/json?latlng=${encodeURIComponent(`${lat},${lng}`)}` +
      `&key=${encodeURIComponent(env.GOOGLE_MAPS_SERVER_API_KEY)}`;

    const json = (await googleFetch(url)) as GoogleGeocodeResponse;
    assertGoogleOk(json, 'geocode');
    if (json.status === 'ZERO_RESULTS') return null;

    const first = asGoogleGeocodeResult(json.results?.[0]);
    if (!first) return null;
    return parseGeocodeResult(first);
  },
};
