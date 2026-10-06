import { ListingCategory } from '@prisma/client';
import { prisma } from '../src/common/database/prisma';

// No accounts are seeded here — every account (including App Store/Play
// review accounts) is provisioned explicitly and by hand with
// `npm run account:create` (prisma/create-account.ts), never by a script
// that re-runs on every deploy with a fixed phone/MPIN.

const CATALOG: { category: ListingCategory; name: string; parentName?: string }[] = [
  { category: ListingCategory.equipment, name: 'Excavator' },
  { category: ListingCategory.equipment, name: 'Loader' },
  { category: ListingCategory.equipment, name: 'Bulldozer', parentName: 'Excavator' },
  { category: ListingCategory.services, name: 'Drilling' },
  { category: ListingCategory.gold, name: '17K' },
  { category: ListingCategory.gold, name: '22K' },
  { category: ListingCategory.gold, name: '24K' },
];

async function seedCatalog(): Promise<void> {
  for (const item of CATALOG) {
    const parent = item.parentName
      ? await prisma.catalogLabel.findUnique({
          where: { category_name: { category: item.category, name: item.parentName } },
        })
      : null;
    await prisma.catalogLabel.upsert({
      where: { category_name: { category: item.category, name: item.name } },
      update: {},
      create: { category: item.category, name: item.name, parentId: parent?.id ?? null },
    });
  }
  console.info('[seed] Catalog labels ready');
}

seedCatalog()
  .catch((error: unknown) => {
    console.error('[seed] Failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
