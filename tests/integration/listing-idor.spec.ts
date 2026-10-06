import { randomUUID } from 'node:crypto';
import { ListingCategory, ListingStatus } from '@prisma/client';
import { prisma } from '../../src/common/database/prisma';
import { listingService } from '../../src/modules/listings/services/listing.service';
import { ErrorCode } from '../../src/common/errors/error-codes';

describe('listing ownership checks (IDOR)', () => {
  let ownerId: string;
  let strangerId: string;
  let buyerId: string;
  let listingId: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const [owner, stranger, buyer] = await Promise.all([
      prisma.user.create({
        data: {
          fullName: 'Owner',
          phoneE164: `+1100${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
        },
      }),
      prisma.user.create({
        data: {
          fullName: 'Stranger',
          phoneE164: `+1101${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
        },
      }),
      prisma.user.create({
        data: {
          fullName: 'Buyer',
          phoneE164: `+1102${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
        },
      }),
    ]);
    ownerId = owner.id;
    strangerId = stranger.id;
    buyerId = buyer.id;

    const listing = await prisma.listing.create({
      data: {
        ownerId,
        category: ListingCategory.equipment,
        postedAs: 'supplier',
        title: 'IDOR test excavator',
        reference: `IDOR-${suffix}`,
        equipmentMode: 'rent',
        units: 3,
      },
    });
    listingId = listing.id;
  });

  afterAll(async () => {
    await prisma.equipmentHold.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId, buyerId] } } });
    await prisma.$disconnect();
  });

  it('refuses to delete a listing for anyone but its owner', async () => {
    await expect(listingService.remove(listingId, strangerId)).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });

    const stillActive = await prisma.listing.findUnique({ where: { id: listingId } });
    expect(stillActive?.status).toBe(ListingStatus.ACTIVE);
  });

  it("refuses to withdraw someone else's offer", async () => {
    const offer = await listingService.submitOffer(listingId, buyerId, { price: '500' });
    const buyerOfferId = offer.rfq?.myOfferId;
    expect(buyerOfferId).toBeTruthy();

    await expect(
      listingService.decideOffer(listingId, strangerId, buyerOfferId!, 'withdraw'),
    ).rejects.toMatchObject({ status: 403, code: ErrorCode.FORBIDDEN });

    // The actual buyer can withdraw their own offer.
    await expect(
      listingService.decideOffer(listingId, buyerId, buyerOfferId!, 'withdraw'),
    ).resolves.toBeDefined();
  });

  it('lets the real owner delete their own listing', async () => {
    await expect(listingService.remove(listingId, ownerId)).resolves.toBeUndefined();

    const archived = await prisma.listing.findUnique({ where: { id: listingId } });
    expect(archived?.status).toBe(ListingStatus.ARCHIVED);
  });
});
