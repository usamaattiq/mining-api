import { z } from 'zod';

export const startConversationBodySchema = z.object({
  body: z.object({
    listingId: z.string().uuid(),
  }),
});

export const conversationIdParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const sendMessageBodySchema = z.object({
  body: z.object({
    text: z.string().trim().min(1).max(4000),
  }),
});

export type StartConversationBody = z.infer<typeof startConversationBodySchema>['body'];
export type ConversationIdParams = z.infer<typeof conversationIdParamsSchema>['params'];
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>['body'];
