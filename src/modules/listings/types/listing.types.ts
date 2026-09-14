import type { Listing, ListingMedia } from '@prisma/client';

export type ListingWithMedia = Listing & { media: ListingMedia[] };

export type ListingMediaDto = {
  id: string;
  uri: string;
  kind: 'photo' | 'video' | 'document';
  name?: string;
  key?: string;
};

export type EquipmentListingDto = {
  id: string;
  ownerId: string;
  category: 'equipment';
  mode: 'rent' | 'sell';
  equipmentTypeLabel: string;
  title: string;
  description: string;
  hourlyRental: string;
  monthlyRental: string;
  weeklyRental: string;
  salePrice: string;
  units: number;
  location: string;
  media: ListingMediaDto[];
  deliveryAvailable: boolean;
  deliveryType: 'free' | 'perKm';
  deliveryPricePerKm: string;
  postedAs: 'buyer' | 'supplier';
  createdAt: number;
};

export type ServiceListingDto = {
  id: string;
  ownerId: string;
  category: 'services';
  serviceType: 'onsite' | 'online';
  serviceCategoryLabel: string;
  title: string;
  description: string;
  yearsOfExperience: string;
  price: string;
  serviceDate: number | null;
  location: string;
  media: ListingMediaDto[];
  postedAs: 'buyer' | 'supplier';
  createdAt: number;
};

export type GoldListingDto = {
  id: string;
  ownerId: string;
  category: 'gold';
  title: string;
  description: string;
  weight: string;
  purityLabel: string;
  price: string;
  auctionEndDate: number | null;
  location: string;
  media: ListingMediaDto[];
  postedAs: 'buyer' | 'supplier';
  createdAt: number;
};

export type ListingDto = EquipmentListingDto | ServiceListingDto | GoldListingDto;
