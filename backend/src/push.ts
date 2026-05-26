// Envio de notificações push via serviço da Expo (best-effort).
// https://docs.expo.dev/push-notifications/sending-notifications/
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: Record<string, unknown>;
}

function looksLikeExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[/.test(token);
}

export async function sendPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const valid = tokens.filter(looksLikeExpoToken);
  if (valid.length === 0) return;

  const trimmed = body.length > 178 ? `${body.slice(0, 175)}...` : body;
  const messages: PushMessage[] = valid.map((to) => ({
    to,
    title,
    body: trimmed,
    sound: 'default',
    data,
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.warn('[talky] push retornou status', res.status, await res.text());
    }
  } catch (err) {
    console.warn('[talky] falha ao enviar push:', err);
  }
}
