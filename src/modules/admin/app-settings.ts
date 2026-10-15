import { prisma } from '../../common/database/prisma';

export const MESSAGE_ON_SEND_KEY = 'messageOnSend';

export async function messageOnSendEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: MESSAGE_ON_SEND_KEY } });
  if (!row) return true;
  return row.value === 'true';
}

export async function setMessageOnSend(enabled: boolean): Promise<boolean> {
  await prisma.appSetting.upsert({
    where: { key: MESSAGE_ON_SEND_KEY },
    create: { key: MESSAGE_ON_SEND_KEY, value: enabled ? 'true' : 'false' },
    update: { value: enabled ? 'true' : 'false' },
  });
  return enabled;
}
