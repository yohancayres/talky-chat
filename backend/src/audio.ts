import { config } from './config';

function filenameFor(mediaType: string): string {
  const m = mediaType.toLowerCase();
  if (m.includes('m4a') || m.includes('mp4') || m.includes('aac')) return 'audio.m4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3';
  if (m.includes('wav')) return 'audio.wav';
  if (m.includes('webm')) return 'audio.webm';
  if (m.includes('ogg') || m.includes('opus')) return 'audio.ogg';
  return 'audio.m4a';
}

/**
 * Transcreve um áudio (base64) enviado pelo usuário usando a OpenAI (Whisper).
 * Best-effort: devolve '' em falha. A transcrição vira o texto da mensagem,
 * então o personagem responde ao que foi falado.
 */
export async function transcribeAudio(base64: string, mediaType: string): Promise<string> {
  if (!config.openaiApiKey) return '';
  try {
    const buffer = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mediaType }), filenameFor(mediaType));
    form.append('model', config.audio.transcribeModel);
    form.append('language', 'pt'); // dica de idioma (PT-BR)

    const res = await fetch(config.audio.transcribeEndpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
      signal: AbortSignal.timeout(config.audio.timeoutSeconds * 1000),
    });
    if (!res.ok) {
      console.warn('[talky] transcrição falhou:', res.status, await res.text());
      return '';
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  } catch (err) {
    console.warn('[talky] erro ao transcrever áudio:', err);
    return '';
  }
}
