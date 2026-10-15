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
      reference: listing.reference,
      description: listing.description,
      hourlyRental: listing.hourlyRental ?? '',
      monthlyRental: listing.monthlyRental ?? '',
      weeklyRental: listing.weeklyRental ?? '',
      yearlyRental: listing.yearlyRental ?? '',
      salePrice: listing.salePrice ?? '',
      units: listing.units ?? 1,
      location: listing.location,
      media,
      deliveryAvailable: listing.deliveryAvailable ?? false,
      deliveryType: listing.deliveryType ?? 'free',
      deliveryPricePerKm: listing.deliveryPricePerKm ?? '',
      postedAs: listing.postedAs,
      requestMode: listing.requestMode === 'auction' ? 'auction' : 'rfq',
      auctionEndDate: listing.auctionEndDate ? listing.auctionEndDate.getTime() : null,
      neededDate: listing.serviceDate ? listing.serviceDate.getTime() : null,
      owner,
      createdAt,
    };
    return dto;
  }

  if (listing.category === 'services') {
    const serviceType = listing.serviceType ?? 'onsite';
    const onsiteOffered = serviceType === 'onsite' || serviceType === 'both';
    const onlineOffered = serviceType === 'online' || serviceType === 'both';
    const onsitePrice = listing.onsitePrice || (onsiteOffered ? (listing.price ?? '') : '');
    const onlinePrice = listing.onlinePrice || (onlineOffered ? (listing.price ?? '') : '');
    const dto: ServiceListingDto = {
      id: listing.id,
      ownerId: listing.ownerId,
      category: 'services',
      serviceType,
      serviceCategoryLabel: listing.serviceCategoryLabel ?? '',
      title: listing.title,
      reference: listing.reference,
      description: listing.description,
      yearsOfExperience: listing.yearsOfExperience ?? '',
      price: onsitePrice || onlinePrice || listing.price || '',
      onsitePrice,
      onlinePrice,
      unitLabel: listing.unitLabel ?? '',
      unitPrice: listing.unitPrice ?? '',
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
    reference: listing.reference,
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
