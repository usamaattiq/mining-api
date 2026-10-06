import { randomUUID } from 'node:crypto';
import { ListingCategory } from '@prisma/client';
import { prisma } from '../../src/common/database/prisma';
import { listingService } from '../../src/modules/listings/services/listing.service';
import { AppError } from '../../src/common/errors/app-error';

describe('equipment hold race condition', () => {
  let ownerId: string;
  let buyerAId: string;
  let buyerBId: string;
  let listingId: string;

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);

    const [owner, buyerA, buyerB] = await Promise.all([
      prisma.user.create({
        data: {
          fullName: 'Race Owner',
          phoneE164: `+1000${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
        },
      }),
      prisma.user.create({
        data: {
          fullName: 'Race Buyer A',
          phoneE164: `+1001${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
        },
      }),
      prisma.user.create({
        data: {
          fullName: 'Race Buyer B',
          phoneE164: `+1002${suffix}`,
          countryCode: 'US',
          countryCallingCode: '1',
        },
      }),
    ]);
    ownerId = owner.id;
    buyerAId = buyerA.id;
    buyerBId = buyerB.id;

    const listing = await prisma.listing.create({
      data: {
        ownerId,
        category: ListingCategory.equipment,
        postedAs: 'supplier',
        title: 'Race test excavator',
        reference: `RACE-${suffix}`,
        equipmentMode: 'rent',
        units: 1,
      },
    });
    listingId = listing.id;
  });

  afterAll(async () => {
    await prisma.equipmentHold.deleteMany({ where: { listingId } });
    await prisma.listing.delete({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, buyerAId, buyerBId] } } });
    await prisma.$disconnect();
  });

  it('never selects two offers past a 1-unit listing capacity under concurrent accept requests', async () => {
    await listingService.submitOffer(listingId, buyerAId, { price: '100' });
    await listingService.submitOffer(listingId, buyerBId, { price: '100' });

    const holdA = await prisma.equipmentHold.findFirstOrThrow({
      where: { listingId, buyerId: buyerAId },
    });
    const holdB = await prisma.equipmentHold.findFirstOrThrow({
      where: { listingId, buyerId: buyerBId },
    });

    const results = await Promise.allSettled([
      listingService.decideOffer(listingId, ownerId, holdA.offerId, 'select'),
      listingService.decideOffer(listingId, ownerId, holdB.offerId, 'select'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    // Without the fix, both concurrent `select` calls can read "1 unit
    // available" before either write lands, and both succeed — overselling
    // the listing's single unit.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppError);

    const holds = await prisma.equipmentHold.findMany({ where: { listingId } });
    const selectedCount = holds.filter((hold) => hold.status === 'selected').length;
    expect(selectedCount).toBe(1);
  });
});
