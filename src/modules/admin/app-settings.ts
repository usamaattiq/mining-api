import { prisma } from '../../common/database/prisma';

export const MESSAGE_ON_SEND_KEY = 'messageOnSend';
export const BUYER_EQUIPMENT_RFQ_KEY = 'buyerEquipmentRfq';
export const BUYER_EQUIPMENT_AUCTION_KEY = 'buyerEquipmentAuction';

async function flag(key: string, fallback: boolean): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.value === 'true';
}

async function setFlag(key: string, enabled: boolean): Promise<boolean> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: enabled ? 'true' : 'false' },
    update: { value: enabled ? 'true' : 'false' },
  });
  return enabled;
}

export async function messageOnSendEnabled(): Promise<boolean> {
  return flag(MESSAGE_ON_SEND_KEY, true);
}

export async function setMessageOnSend(enabled: boolean): Promise<boolean> {
  return setFlag(MESSAGE_ON_SEND_KEY, enabled);
}

export async function buyerEquipmentRequestModes(): Promise<{ rfq: boolean; auction: boolean }> {
  const [rfq, auction] = await Promise.all([
    flag(BUYER_EQUIPMENT_RFQ_KEY, true),
    flag(BUYER_EQUIPMENT_AUCTION_KEY, true),
  ]);
  return { rfq, auction };
}

export async function setBuyerEquipmentRequestMode(
  mode: 'rfq' | 'auction',
  enabled: boolean,
): Promise<{ rfq: boolean; auction: boolean }> {
  const current = await buyerEquipmentRequestModes();
  const next = { ...current, [mode]: enabled };
  if (!next.rfq && !next.auction) {
    return current;
  }
  await setFlag(mode === 'rfq' ? BUYER_EQUIPMENT_RFQ_KEY : BUYER_EQUIPMENT_AUCTION_KEY, enabled);
  return next;
}
