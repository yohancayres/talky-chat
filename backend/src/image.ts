import fs from 'fs';
import path from 'path';
import { config } from './config';
import { Character } from './types';
import { describeTemperament } from './prompts';

export const AVATARS_DIR = path.join(__dirname, '..', 'data', 'avatars');

// Resume as características do personagem num prompt de foto de perfil realista.
function buildImagePrompt(character: Character): string {
  const vibe = describeTemperament(character.temperament ?? {})
    .replace(/^- /gm, '')
    .replace(/\n/g, '; ');

  const parts = [
    'A realistic, natural profile headshot photo of a fictional adult person (not a real or famous individual).',
    character.appearance ? `Appearance: ${character.appearance}.` : `Around ${character.age} years old.`,
    `A ${character.age}-year-old ${character.occupation} from ${character.location}, Brazil.`,
    character.personality.summary ? `Personality: ${character.personality.summary}` : '',
    vibe ? `Vibe: ${vibe}.` : '',
    'Photorealistic, soft natural lighting, looks like a genuine smartphone portrait, face clearly visible, single person, neutral background, not an illustration, not a cartoon.',
  ];

  return parts.filter(Boolean).join(' ');
}

async function fetchImageBuffer(data: unknown): Promise<Buffer | null> {
  const first = (data as { data?: { b64_json?: string; url?: string }[] })?.data?.[0];
  if (!first) return null;
  if (first.b64_json) return Buffer.from(first.b64_json, 'base64');
  if (first.url) {
    const img = await fetch(first.url);
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  }
  return null;
}

/**
 * Gera a foto de perfil do personagem e salva em disco. Retorna o caminho
 * público (ex: "/avatars/<id>.png") ou null se desabilitado/falhar.
 */
export async function generateAvatar(character: Character): Promise<string | null> {
  if (!config.image.enabled || !config.openaiApiKey) return null;

  try {
    const res = await fetch(config.image.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.image.model,
        prompt: buildImagePrompt(character),
        size: config.image.size,
      }),
    });

    if (!res.ok) {
      console.warn('[talky] geração de imagem falhou:', res.status, await res.text());
      return null;
    }

    const buffer = await fetchImageBuffer(await res.json());
    if (!buffer) {
      console.warn('[talky] resposta de imagem sem dados utilizáveis.');
      return null;
    }

    fs.mkdirSync(AVATARS_DIR, { recursive: true });
    fs.writeFileSync(path.join(AVATARS_DIR, `${character.id}.png`), buffer);
    return `/avatars/${character.id}.png`;
  } catch (err) {
    console.warn('[talky] erro ao gerar foto de perfil:', err);
    return null;
  }
}
