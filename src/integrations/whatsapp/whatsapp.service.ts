import { env } from '../../config/env';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { logger } from '../../common/logger';

type WhatsAppErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

function toWhatsAppRecipient(phoneE164: string): string {
  return phoneE164.replace(/^\+/, '');
}

class WhatsAppService {
  isConfigured(): boolean {
    return Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
  }

  async sendAuthenticationOtp(phoneE164: string, code: string): Promise<void> {
    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      throw new AppError('WhatsApp OTP delivery is not configured', 503, ErrorCode.INTERNAL_ERROR);
    }

    const url = `${env.WHATSAPP_API_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const recipient = toWhatsAppRecipient(phoneE164);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: env.WHATSAPP_OTP_TEMPLATE_NAME,
        language: { code: env.WHATSAPP_OTP_TEMPLATE_LANGUAGE },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: code },
              { type: 'text', text: env.PLATFORM_DISPLAY_NAME },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(env.WHATSAPP_API_TIMEOUT),
      });
    } catch (error) {
      logger.error({ err: error, phoneE164 }, 'WhatsApp OTP request failed');
      throw new AppError('Failed to send WhatsApp OTP', 502, ErrorCode.INTERNAL_ERROR);
    }

    if (!response.ok) {
      let providerMessage: string | undefined;
      let providerCode: number | undefined;

      try {
        const body = (await response.json()) as WhatsAppErrorBody;
        providerMessage = body.error?.message;
        providerCode = body.error?.code;
      } catch {
        // ignore JSON parse failures; status is enough
      }

      logger.error(
        { status: response.status, providerCode, providerMessage, phoneE164 },
        'WhatsApp OTP API rejected request',
      );

      throw new AppError(
        'Failed to send WhatsApp OTP',
        502,
        ErrorCode.INTERNAL_ERROR,
        env.NODE_ENV === 'production'
          ? undefined
          : { status: response.status, providerCode, providerMessage },
      );
    }
  }
}

export const whatsappService = new WhatsAppService();
