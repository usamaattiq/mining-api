import { z } from 'zod';

const mediaItemSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  uri: z.string().trim().min(1).max(2000),
  kind: z.enum(['photo', 'video', 'document']),
  name: z.string().trim().max(255).optional(),
  key: z.string().trim().max(500).optional(),
});

const mediaSchema = z.array(mediaItemSchema).max(20).default([]);

const equipmentBodySchema = z.object({
  category: z.literal('equipment'),
  mode: z.enum(['rent', 'sell']),
  equipmentTypeLabel: z.string().trim().min(1).max(150),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  hourlyRental: z.string().trim().max(40).default(''),
  monthlyRental: z.string().trim().max(40).default(''),
  weeklyRental: z.string().trim().max(40).default(''),
  salePrice: z.string().trim().max(40).default(''),
  units: z.number().int().min(1).max(9999).default(1),
  location: z.string().trim().max(500).default(''),
  media: mediaSchema,
  deliveryAvailable: z.boolean().default(false),
  deliveryType: z.enum(['free', 'perKm']).default('free'),
  deliveryPricePerKm: z.string().trim().max(40).default(''),
  postedAs: z.enum(['buyer', 'supplier']).default('supplier'),
});

const serviceBodySchema = z.object({
  category: z.literal('services'),
  serviceType: z.enum(['onsite', 'online']),
  serviceCategoryLabel: z.string().trim().min(1).max(150),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  yearsOfExperience: z.string().trim().max(20).default(''),
  price: z.string().trim().max(40).default(''),
  serviceDate: z.number().int().nullable().optional(),
  location: z.string().trim().max(500).default(''),
  media: mediaSchema,
  postedAs: z.enum(['buyer', 'supplier']).default('supplier'),
});

const goldBodySchema = z.object({
  category: z.literal('gold'),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  weight: z.string().trim().max(40).default(''),
  purityLabel: z.string().trim().max(80).default(''),
  price: z.string().trim().max(40).default(''),
  auctionEndDate: z.number().int().nullable().optional(),
  location: z.string().trim().max(500).default(''),
  media: mediaSchema,
  postedAs: z.enum(['buyer', 'supplier']).default('supplier'),
});

export const createListingBodySchema = z.object({
  body: z.discriminatedUnion('category', [equipmentBodySchema, serviceBodySchema, goldBodySchema]),
});

export const listListingsQuerySchema = z.object({
  query: z.object({
    category: z.enum(['equipment', 'services', 'gold']).optional(),
    postedAs: z.enum(['buyer', 'supplier']).optional(),
  }),
});

export const listingIdParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const listFeedQuerySchema = z.object({
  query: z.object({
    postedAs: z.enum(['buyer', 'supplier']),
    category: z.enum(['equipment', 'services', 'gold']).optional(),
  }),
});

export type CreateListingBody = z.infer<typeof createListingBodySchema>['body'];
export type ListListingsQuery = z.infer<typeof listListingsQuerySchema>['query'];
export type ListFeedQuery = z.infer<typeof listFeedQuerySchema>['query'];
export type ListingIdParams = z.infer<typeof listingIdParamsSchema>['params'];
