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
  mode: z.enum(['rent', 'sell', 'both']),
  equipmentTypeLabel: z.string().trim().min(1).max(150),
  title: z.string().trim().min(1).max(20),
  description: z.string().trim().max(500).default(''),
  hourlyRental: z.string().trim().max(40).default(''),
  monthlyRental: z.string().trim().max(40).default(''),
  weeklyRental: z.string().trim().max(40).default(''),
  yearlyRental: z.string().trim().max(40).default(''),
  salePrice: z.string().trim().max(40).default(''),
  units: z.number().int().min(1).max(9999).default(1),
  location: z.string().trim().max(500).default(''),
  media: mediaSchema,
  deliveryAvailable: z.boolean().default(false),
  deliveryType: z.enum(['free', 'perKm']).default('free'),
  deliveryPricePerKm: z.string().trim().max(40).default(''),
  postedAs: z.enum(['buyer', 'supplier']).default('supplier'),
  requestMode: z.enum(['rfq', 'auction']).default('rfq'),
  auctionStartDate: z.number().int().nullable().optional(),
  auctionEndDate: z.number().int().nullable().optional(),
  neededDate: z.number().int().nullable().optional(),
  expiryHours: z.number().int().min(1).max(8760).optional(),
});

const serviceBodySchema = z.object({
  category: z.literal('services'),
  serviceType: z.enum(['onsite', 'online', 'both']),
  serviceCategoryLabel: z.string().trim().min(1).max(150),
  title: z.string().trim().min(1).max(20),
  description: z.string().trim().max(500).default(''),
  yearsOfExperience: z.string().trim().max(20).default(''),
  price: z.string().trim().max(40).default(''),
  onsitePrice: z.string().trim().max(40).default(''),
  onlinePrice: z.string().trim().max(40).default(''),
  serviceDate: z.number().int().nullable().optional(),
  expiryHours: z.number().int().min(1).max(8760).optional(),
  location: z.string().trim().max(500).default(''),
  media: mediaSchema,
  postedAs: z.enum(['buyer', 'supplier']).default('supplier'),
  unitLabel: z.string().trim().max(150).default(''),
  unitPrice: z.string().trim().max(40).default(''),
});

const goldBodySchema = z.object({
  category: z.literal('gold'),
  title: z.string().trim().min(1).max(20),
  description: z.string().trim().max(500).default(''),
  weight: z
    .string()
    .trim()
    .max(40)
    .regex(/^$|^\d+(?:\.\d+)?$/, 'Weight must be digits with an optional decimal')
    .default(''),
  purityLabel: z.string().trim().max(80).default(''),
  price: z.string().trim().max(40).default(''),
  auctionStartDate: z.number().int().nullable().optional(),
  auctionEndDate: z.number().int().nullable().optional(),
  location: z.string().trim().max(500).default(''),
  media: mediaSchema,
  postedAs: z.enum(['buyer', 'supplier']).default('supplier'),
});

export const createListingBodySchema = z.object({
  body: z
    .discriminatedUnion('category', [equipmentBodySchema, serviceBodySchema, goldBodySchema])
    .superRefine((value, ctx) => {
      if (value.category === 'equipment' && value.postedAs === 'buyer' && value.mode === 'both') {
        ctx.addIssue({
          code: 'custom',
          message: 'A buyer request is either rent or buy',
          path: ['mode'],
        });
      }
    }),
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

export const updateListingSchema = createListingBodySchema.merge(listingIdParamsSchema);

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

export const submitListingOfferBodySchema = z.object({
  body: z.object({
    price: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
    units: z.number().int().min(1).max(9999).optional(),
    fulfillment: z.enum(['rent', 'sale']).optional(),
    delivery: z.enum(['onsite', 'online']).optional(),
    handover: z.enum(['pickup', 'delivery']).optional(),
    description: z.string().trim().max(200).optional(),
  }),
});

export const updateEquipmentUnitsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    units: z.number().int().min(1).max(9999),
  }),
});

export const equipmentStockReturnParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    holdId: z.string().uuid(),
  }),
});

export const listingOfferActionParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    offerId: z.string().trim().min(1).max(64),
  }),
});

export const updateListingOfferSchema = listingOfferActionParamsSchema.extend({
  body: z.object({
    price: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
    units: z.number().int().min(1).max(9999).optional(),
    fulfillment: z.enum(['rent', 'sale']).optional(),
    delivery: z.enum(['onsite', 'online']).optional(),
    handover: z.enum(['pickup', 'delivery']).optional(),
    description: z.string().trim().max(200).optional(),
  }),
});

export type UpdateEquipmentUnitsBody = z.infer<typeof updateEquipmentUnitsSchema>['body'];
export type UpdateListingOfferBody = z.infer<typeof updateListingOfferSchema>['body'];
export type SubmitListingOfferBody = z.infer<typeof submitListingOfferBodySchema>['body'];
export type ListingOfferActionParams = z.infer<typeof listingOfferActionParamsSchema>['params'];
