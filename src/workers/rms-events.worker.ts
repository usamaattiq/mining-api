import { PubSub, type Message } from '@google-cloud/pubsub';
import pino from 'pino';
import { env } from '../config/env';
import { rmsEventsService } from '../modules/notifications/rms/rms-events.service';
import type { RmsNotificationEvent } from '../modules/notifications/rms/rms-notification.mapper';

const logger = pino({
  transport: env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

async function bootstrap(): Promise<void> {
  if (!env.PUBSUB_ENABLED) {
    logger.warn('PUBSUB_ENABLED=false — rms-events worker exiting');
    process.exit(0);
  }

  if (!env.PUBSUB_PROJECT_ID) {
    logger.error('PUBSUB_PROJECT_ID is required when PUBSUB_ENABLED=true');
    process.exit(1);
  }

  // google-cloud-pubsub reads PUBSUB_EMULATOR_HOST / GOOGLE_APPLICATION_CREDENTIALS from process.env
  if (env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  if (env.PUBSUB_EMULATOR_HOST && !process.env.PUBSUB_EMULATOR_HOST) {
    process.env.PUBSUB_EMULATOR_HOST = env.PUBSUB_EMULATOR_HOST;
  }

  const pubsub = new PubSub({ projectId: env.PUBSUB_PROJECT_ID });
  const subscription = pubsub.subscription(env.PUBSUB_SUBSCRIPTION_ID);

  logger.info(
    {
      projectId: env.PUBSUB_PROJECT_ID,
      topicId: env.PUBSUB_TOPIC_ID,
      subscriptionId: env.PUBSUB_SUBSCRIPTION_ID,
      platformId: env.RMS_PLATFORM_ID,
      emulator: Boolean(env.PUBSUB_EMULATOR_HOST || process.env.PUBSUB_EMULATOR_HOST),
    },
    'Listening for RFQ Pub/Sub events',
  );

  const onMessage = async (message: Message): Promise<void> => {
    try {
      const attributes = message.attributes ?? {};
      if (attributes.platform_id && attributes.platform_id !== env.RMS_PLATFORM_ID) {
        message.ack();
        return;
      }

      const envelope = JSON.parse(message.data.toString('utf8')) as RmsNotificationEvent;
      const result = await rmsEventsService.handleEvent({
        ...envelope,
        event_id: envelope.event_id || message.id,
      });

      logger.info(
        {
          trigger: envelope.trigger,
          event_id: envelope.event_id,
          delivered: result.delivered,
          reason: result.reason,
        },
        'Processed RFQ event',
      );
      message.ack();
    } catch (error) {
      logger.error(
        { err: error, messageId: message.id },
        `Failed to process message: ${error instanceof Error ? error.message : String(error)}`,
      );
      message.nack();
    }
  };

  subscription.on('message', (message) => {
    void onMessage(message);
  });

  subscription.on('error', (error) => {
    logger.error({ err: error }, `Subscription error: ${error.message}`);
  });

  const shutdown = async () => {
    logger.info('Shutting down rms-events worker…');
    subscription.removeAllListeners();
    await subscription.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void bootstrap();
