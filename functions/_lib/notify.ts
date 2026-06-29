/**
 * Telegram alerting — best-effort, never throws.
 *
 * The only outward-facing notifier in this stack. Used by the calendar cron to
 * tell the owner when a Vexa bot silently fails (dispatch rejected, or a bot
 * that joined records nothing). A failed alert must never break the dispatch
 * loop, so every error is swallowed and the call is a no-op when unconfigured.
 */
export interface NotifyEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export function notifyConfigured(env: NotifyEnv): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

export async function notifyTelegram(env: NotifyEnv, text: string): Promise<void> {
  if (!notifyConfigured(env)) return; // unconfigured → silent no-op
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // An alert that can't be delivered must not abort the caller's work.
  }
}
