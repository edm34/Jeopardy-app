import { config } from '../config.js';
import { log } from '../log.js';

let twilioClient = null;

async function getClient() {
  if (twilioClient) return twilioClient;
  const { default: twilio } = await import('twilio');
  twilioClient = twilio(config.whatsapp.sid, config.whatsapp.token);
  return twilioClient;
}

export function whatsappNotifier() {
  if (!config.whatsapp.enabled()) {
    log.warn('WhatsApp notifier disabled (missing TWILIO_* or WHATSAPP_TO env vars).');
    return null;
  }
  return {
    name: 'whatsapp',
    async send(text) {
      const client = await getClient();
      // WhatsApp messages have a 1600-char limit; trim to be safe.
      const body = text.length > 1500 ? text.slice(0, 1497) + '...' : text;
      await Promise.all(
        config.whatsapp.to.map((to) =>
          client.messages
            .create({ from: config.whatsapp.from, to, body })
            .catch((err) => log.warn(`whatsapp -> ${to} failed: ${err.message}`)),
        ),
      );
    },
  };
}
