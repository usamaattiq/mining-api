import { z } from 'zod';

const optionalCallerIdentity = {
  dialCode: z.string().min(1).optional(),
  phoneNumber: z.string().min(1).optional(),
};

export const autocompleteQuerySchema = z.object({
  input: z.string().min(1).max(200),
  sessiontoken: z.string().min(1).max(128),
  ...optionalCallerIdentity,
});

export const placeDetailsQuerySchema = z.object({
  placeId: z.string().min(1).max(256),
  sessiontoken: z.string().min(1).max(128),
  ...optionalCallerIdentity,
});

export const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  ...optionalCallerIdentity,
});
