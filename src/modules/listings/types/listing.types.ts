import type { Listing, ListingMedia, User } from '@prisma/client';

export type ListingOwnerPreview = Pick<User, 'id' | 'fullName' | 'avatarUrl'>;

export type ListingWithMedia = Listing & { media: ListingMedia[]; owner: ListingOwnerPreview };

export type ListingMediaDto = {
  id: string;
  uri: string;
  kind: 'photo' | 'video' | 'document';
  name?: string;
  key?: string;
};

export type ListingOwnerDto = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
};

export type ListingRfqOfferDto = {
  id: string;
  responderId: string;
  responderName: string;
  status: string;
  price?: string;
  quantity?: number;
};

export type ListingRfqDto = {
  id: string;
  status: string;
  statusLabel: string;
  statusVariant: 'muted' | 'accent' | 'warning' | 'success';
  expiresAt: number | null;
  offersCount?: number;
  canSubmitOffer?: boolean;
  canDecideOffers?: boolean;
  canConfirmOffer?: boolean;
  canDeclineOffer?: boolean;
  canWithdrawOffer?: boolean;
  myOfferId?: string;
  myOfferStatus?: string;
  myOfferPrice?: string;
  myOfferQuantity?: number;
  offers?: ListingRfqOfferDto[];
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
  neededDate: number | null;
  owner: ListingOwnerDto;
  createdAt: number;
  rfq?: ListingRfqDto;
};

export type ServiceListingDto = {
  id: string;
  ownerId: string;
  category: 'services';
  serviceType: 'onsite' | 'online' | 'both';
  serviceCategoryLabel: string;
  title: string;
  description: string;
  yearsOfExperience: string;
  price: string;
  serviceDate: number | null;
  location: string;
  media: ListingMediaDto[];
  postedAs: 'buyer' | 'supplier';
  owner: ListingOwnerDto;
  createdAt: number;
  rfq?: ListingRfqDto;
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
  owner: ListingOwnerDto;
  createdAt: number;
  rfq?: ListingRfqDto;
};

export type ListingDto = EquipmentListingDto | ServiceListingDto | GoldListingDto;
