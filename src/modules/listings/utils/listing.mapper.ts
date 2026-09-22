import type {
  EquipmentListingDto,
  GoldListingDto,
  ListingDto,
  ListingMediaDto,
  ListingWithMedia,
  ServiceListingDto,
} from '../types/listing.types';

function toMediaDto(listing: ListingWithMedia): ListingMediaDto[] {
  return [...listing.media]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      id: item.id,
      uri: item.uri,
      kind: item.kind,
      ...(item.name ? { name: item.name } : {}),
      ...(item.key ? { key: item.key } : {}),
    }));
}

function toOwnerDto(listing: ListingWithMedia) {
  return {
    id: listing.owner.id,
    fullName: listing.owner.fullName,
    avatarUrl: listing.owner.avatarUrl,
  };
}

export function toListingDto(listing: ListingWithMedia): ListingDto {
  const media = toMediaDto(listing);
  const createdAt = listing.createdAt.getTime();
  const owner = toOwnerDto(listing);

  if (listing.category === 'equipment') {
    const dto: EquipmentListingDto = {
      id: listing.id,
      ownerId: listing.ownerId,
      category: 'equipment',
      mode: listing.equipmentMode ?? 'rent',
      equipmentTypeLabel: listing.equipmentTypeLabel ?? '',
      title: listing.title,
      description: listing.description,
      hourlyRental: listing.hourlyRental ?? '',
      monthlyRental: listing.monthlyRental ?? '',
      weeklyRental: listing.weeklyRental ?? '',
      salePrice: listing.salePrice ?? '',
      units: listing.units ?? 1,
      location: listing.location,
      media,
      deliveryAvailable: listing.deliveryAvailable ?? false,
      deliveryType: listing.deliveryType ?? 'free',
      deliveryPricePerKm: listing.deliveryPricePerKm ?? '',
      postedAs: listing.postedAs,
      neededDate: listing.serviceDate ? listing.serviceDate.getTime() : null,
      owner,
      createdAt,
    };
    return dto;
  }

  if (listing.category === 'services') {
    const dto: ServiceListingDto = {
      id: listing.id,
      ownerId: listing.ownerId,
      category: 'services',
      serviceType: listing.serviceType ?? 'onsite',
      serviceCategoryLabel: listing.serviceCategoryLabel ?? '',
      title: listing.title,
      description: listing.description,
      yearsOfExperience: listing.yearsOfExperience ?? '',
      price: listing.price ?? '',
      serviceDate: listing.serviceDate ? listing.serviceDate.getTime() : null,
      location: listing.location,
      media,
      postedAs: listing.postedAs,
      owner,
      createdAt,
    };
    return dto;
  }

  const dto: GoldListingDto = {
    id: listing.id,
    ownerId: listing.ownerId,
    category: 'gold',
    title: listing.title,
    description: listing.description,
    weight: listing.weight ?? '',
    purityLabel: listing.purityLabel ?? '',
    price: listing.price ?? '',
    auctionEndDate: listing.auctionEndDate ? listing.auctionEndDate.getTime() : null,
    location: listing.location,
    media,
    postedAs: listing.postedAs,
    owner,
    createdAt,
  };
  return dto;
}
