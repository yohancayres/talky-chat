import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { Character } from './types';
import { describeTemperament } from './prompts';

export const AVATARS_DIR = path.join(__dirname, '..', 'data', 'avatars');
// Fotos enviadas no chat (contextuais) ficam separadas do avatar de perfil.
export const PHOTOS_DIR = path.join(__dirname, '..', 'data', 'photos');
// Fotos que o USUÁRIO envia para o personagem.
export const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

/** Salva uma imagem enviada pelo usuário (base64) e devolve o caminho público. */
export function saveUpload(base64: string, mediaType: string): string | null {
  try {
    const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg';
    const fileName = `${randomUUID()}.${ext}`;
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(base64, 'base64'));
    return `/uploads/${fileName}`;
  } catch (err) {
    console.warn('[talky] não foi possível salvar a foto enviada:', err);
    return null;
  }
}

// Personagens com foto sendo gerada agora (estado em memória).
const generatingAvatars = new Set<string>();
// Conversas com uma foto de chat sendo gerada agora.
const generatingChatPhotos = new Set<string>();

export function isGeneratingAvatar(characterId: string): boolean {
  return generatingAvatars.has(characterId);
}

export function markAvatarGenerating(characterId: string): void {
  generatingAvatars.add(characterId);
}

export function clearAvatarGenerating(characterId: string): void {
  generatingAvatars.delete(characterId);
}

export function isGeneratingChatPhoto(conversationId: string): boolean {
  return generatingChatPhotos.has(conversationId);
}

export function markChatPhotoGenerating(conversationId: string): void {
  generatingChatPhotos.add(conversationId);
}

export function clearChatPhotoGenerating(conversationId: string): void {
  generatingChatPhotos.delete(conversationId);
}

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
  'arm-length selfie',
  'mirror selfie',
];

// Roupas variadas — para a foto do chat NÃO repetir o look da foto de perfil.
const OUTFITS = [
  'a casual t-shirt',
  'a hoodie',
  'a button-up shirt',
  'a tank top',
  'a knit sweater',
  'workout clothes',
  'cozy clothes at home',
  'a jacket over a tee',
  'a summery outfit',
  'whatever fits the moment',
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

// Cena/expressão de uma "selfie de agora". Quando há `scene` (descrição derivada
// do pedido do usuário), ela define pose/enquadramento; senão, usa a atividade.
function buildChatPhotoPrompt(
  character: Character,
  opts: { activity?: string; mood?: string; scene?: string },
): string {
  const parts = [
    'A realistic, casual photo that a fictional adult person (not a real or famous individual) just took with their phone and sent in a chat.',
    character.appearance
      ? `SAME PERSON — keep the same face, hair, age, ethnicity and body type as: ${character.appearance}. Treat any clothing or style mentioned there as NOT fixed.`
      : `A ${character.age}-year-old person.`,
    `A ${character.age}-year-old ${character.occupation} from ${character.location}, Brazil.`,
    opts.scene
      ? `The photo: ${opts.scene}`
      : opts.activity
        ? `Right now they are: ${opts.activity} — show them in a fitting setting for that.`
        : `A candid everyday moment, ${pick(SCENES)}.`,
    !opts.scene && opts.mood
      ? `Their current mood: ${opts.mood} — let it show subtly in the expression.`
      : '',
    // Variedade: roupa, enquadramento e luz diferentes a cada foto — nunca o look do perfil.
    `Make this clearly DIFFERENT from a profile picture and from previous photos: a different outfit (${pick(OUTFITS)}), ${pick(ANGLES)}, different setting and lighting. Do NOT reuse the same clothes.`,
    'Single person, face visible. Photorealistic, natural lighting, looks like a genuine spontaneous smartphone photo, not an illustration, not a cartoon, no text overlay.',
  ];
  return parts.filter(Boolean).join(' ');
}

// Chama a API de imagens e devolve o buffer (ou null). Compartilhado por avatar
// e fotos de chat.
async function requestImageBuffer(prompt: string, label: string): Promise<Buffer | null> {
  if (!config.image.enabled || !config.openaiApiKey) return null;
  console.log(`[talky] gerando ${label} (${config.image.model}, ${config.image.size})...`);
  const startedAt = Date.now();
  try {
    const res = await fetch(config.image.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({ model: config.image.model, prompt, size: config.image.size }),
      signal: AbortSignal.timeout(config.image.timeoutSeconds * 1000),
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
    console.log(`[talky] ${label} gerada em ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
    return buffer;
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    console.warn(`[talky] erro ao gerar ${label}${timedOut ? ' (timeout)' : ''}:`, err);
    return null;
  }
}

function saveImage(dir: string, fileName: string, buffer: Buffer): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buffer);
}

/** Remove um arquivo de avatar antigo (best-effort), dado o caminho público. */
export function deleteAvatar(photoUrl?: string): void {
  if (!photoUrl) return;
  const file = path.join(AVATARS_DIR, path.basename(photoUrl));
  fs.promises.unlink(file).catch(() => {});
}

/** Remove uma foto enviada no chat (best-effort), dado o caminho público. */
export function deletePhoto(imageUrl?: string): void {
  if (!imageUrl) return;
  const file = path.join(PHOTOS_DIR, path.basename(imageUrl));
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
  const buffer = await requestImageBuffer(
    buildImagePrompt(character, opts.variation ?? false),
    `foto de perfil de ${character.name}`,
  );
  if (!buffer) return null;
  const fileName = `${character.id}-${Date.now()}.png`;
  saveImage(AVATARS_DIR, fileName, buffer);
  return `/avatars/${fileName}`;
}

/**
 * Gera uma foto contextual ("como você está agora") para enviar no chat,
 * refletindo a atividade atual e o humor. Salva em /photos e retorna o caminho
 * público, ou null se desabilitado/falhar.
 */
export async function generateChatPhoto(
  character: Character,
  opts: { activity?: string; mood?: string; scene?: string } = {},
): Promise<string | null> {
  const buffer = await requestImageBuffer(
    buildChatPhotoPrompt(character, opts),
    `foto de chat de ${character.name}`,
  );
  if (!buffer) return null;
  const fileName = `${character.id}-${Date.now()}.png`;
  saveImage(PHOTOS_DIR, fileName, buffer);
  return `/photos/${fileName}`;
}

