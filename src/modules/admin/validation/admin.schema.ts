import { z } from 'zod';

export const updateUserBodySchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(1).max(150),
    email: z.string().trim().max(254).optional(),
    address: z.string().trim().max(500).optional(),
    companyName: z.string().trim().max(150).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }),
});

export const userStatusBodySchema = z.object({
  body: z.object({
    status: z.enum(['active', 'suspended']),
  }),
});

export const listingStatusBodySchema = z.object({
  body: z.object({
    status: z.enum(['active', 'archived']),
  }),
});

export const createCategoryBodySchema = z.object({
  body: z.object({
    category: z.enum(['equipment', 'services', 'gold']),
    name: z.string().trim().min(1).max(150),
    nameAr: z.string().trim().min(1).max(150),
    parentId: z.string().trim().min(1).max(64).nullish(),
  }),
});

export const updateCategoryBodySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(150),
    nameAr: z.string().trim().min(1).max(150),
  }),
});

export type UpdateUserBody = z.infer<typeof updateUserBodySchema>['body'];
export type UserStatusBody = z.infer<typeof userStatusBodySchema>['body'];
export type ListingStatusBody = z.infer<typeof listingStatusBodySchema>['body'];
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>['body'];
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>['body'];
