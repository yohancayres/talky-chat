import fs from 'fs';
import path from 'path';
import { config } from './config';
import { Character } from './types';
import { describeTemperament } from './prompts';

export const AVATARS_DIR = path.join(__dirname, '..', 'data', 'avatars');

const SCENES = [
  'in a cozy café',
  'outdoors in a park',
  'on a city street at golden hour',
  'at home by a window with natural light',
  'at the beach',
  'in a bookstore',
  'walking outside, candid moment',
  'on a rooftop in the evening',
];

const ANGLES = [
  'slightly from the side',
  'three-quarter view',
  'casual selfie angle',
  'looking off-camera',
  'straight-on portrait',
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Resume as características do personagem num prompt de foto de perfil realista.
// Com `variation`, mantém a MESMA pessoa mas muda cenário/ângulo/luz.
function buildImagePrompt(character: Character, variation: boolean): string {
  const vibe = describeTemperament(character.temperament ?? {})
    .replace(/^- /gm, '')
    .replace(/\n/g, '; ');

  const parts = [
    'A realistic, natural profile photo of a fictional adult person (not a real or famous individual).',
    character.appearance ? `Appearance: ${character.appearance}.` : `Around ${character.age} years old.`,
    `A ${character.age}-year-old ${character.occupation} from ${character.location}, Brazil.`,
    character.personality.summary ? `Personality: ${character.personality.summary}` : '',
    vibe ? `Vibe: ${vibe}.` : '',
  ];

  if (variation) {
    parts.push(
      `Keep the SAME person — same facial features, hair, age and ethnicity as described — but a DIFFERENT photo: ${pick(SCENES)}, ${pick(ANGLES)}, different outfit and lighting.`,
    );
  } else {
    parts.push('Headshot, neutral background.');
  }

  parts.push(
    'Photorealistic, soft natural lighting, looks like a genuine smartphone photo, face clearly visible, single person, not an illustration, not a cartoon.',
  );

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

/** Remove um arquivo de avatar antigo (best-effort), dado o caminho público. */
export function deleteAvatar(photoUrl?: string): void {
  if (!photoUrl) return;
  const file = path.join(AVATARS_DIR, path.basename(photoUrl));
  fs.promises.unlink(file).catch(() => {});
}

/**
 * Gera a foto de perfil do personagem e salva em disco. Retorna o caminho
 * público (ex: "/avatars/<id>-<ts>.png") ou null se desabilitado/falhar.
 * O nome é versionado para o app recarregar a imagem ao trocar.
 */
export async function generateAvatar(
  character: Character,
  opts: { variation?: boolean } = {},
): Promise<string | null> {
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
        prompt: buildImagePrompt(character, opts.variation ?? false),
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
    const fileName = `${character.id}-${Date.now()}.png`;
    fs.writeFileSync(path.join(AVATARS_DIR, fileName), buffer);
    return `/avatars/${fileName}`;
  } catch (err) {
    console.warn('[talky] erro ao gerar foto de perfil:', err);
    return null;
  }
}

