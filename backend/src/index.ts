import cors from 'cors';
import express from 'express';
import { config } from './config';
import { AVATARS_DIR, PHOTOS_DIR } from './image';
import { router } from './routes';
import { startScheduler } from './scheduler';
import { initStore } from './store';

const app = express();

app.use(cors());
app.use(express.json());

// Fotos de perfil e fotos enviadas no chat (servidas estaticamente).
app.use('/avatars', express.static(AVATARS_DIR));
app.use('/photos', express.static(PHOTOS_DIR));

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
