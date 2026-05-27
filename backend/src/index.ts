import cors from 'cors';
import express from 'express';
import { config } from './config';
import { AVATARS_DIR, PHOTOS_DIR, UPLOADS_DIR } from './image';
import { router } from './routes';
import { startScheduler } from './scheduler';
import { initStore } from './store';

const app = express();

app.use(cors());
// Limite alto: fotos enviadas pelo usuário chegam em base64 no corpo.
app.use(express.json({ limit: '20mb' }));

// Fotos de perfil, fotos do personagem e fotos enviadas pelo usuário.
app.use('/avatars', express.static(AVATARS_DIR));
app.use('/photos', express.static(PHOTOS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: config.model });
});

app.use('/api', router);

async function main(): Promise<void> {
  // Conecta ao banco e carrega o estado ANTES de aceitar requisições.
  await initStore();
  app.listen(config.port, () => {
    console.log(`[talky] backend rodando em http://localhost:${config.port}`);
    console.log(`[talky] modelo: ${config.model}`);
    startScheduler();
  });
}

main().catch((err) => {
  console.error('[talky] falha ao iniciar o backend:', err);
  process.exit(1);
});
