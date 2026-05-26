import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: process.env.TALKY_MODEL ?? 'claude-opus-4-7',
};

if (!config.anthropicApiKey) {
  console.warn(
    '[talky] ANTHROPIC_API_KEY não está definido. Crie backend/.env a partir de .env.example.',
  );
}
