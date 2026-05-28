import { clerkMiddleware, getAuth } from '@clerk/express';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import { AVATARS_DIR, PHOTOS_DIR, UPLOADS_DIR } from './image';
import { router } from './routes';
import { startScheduler } from './scheduler';
import { initStore } from './store';

const app = express();

app.use(cors());
// Limite alto: fotos e áudios enviados pelo usuário chegam em base64 no corpo
// (base64 infla ~33%). 50 MB cobre fotos + áudios longos (2 min de voz ≈ 3 MB).
// Ajustável por env (ex.: BODY_LIMIT=80mb) sem precisar mexer no código.
const BODY_LIMIT = process.env.BODY_LIMIT ?? '50mb';
app.use(express.json({ limit: BODY_LIMIT }));

// Fotos de perfil, fotos do personagem e fotos enviadas pelo usuário.
app.use('/avatars', express.static(AVATARS_DIR));
app.use('/photos', express.static(PHOTOS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/health', (_req, res) => {
  // bodyLimit/commit ajudam a confirmar QUAL build está no ar (debug de deploy).
  res.json({
    ok: true,
    model: config.model,
    bodyLimit: BODY_LIMIT,
    commit: process.env.SOURCE_COMMIT ?? process.env.COMMIT_SHA ?? 'dev',
  });
});

// Autenticação: com CLERK_SECRET_KEY definido, todo /api exige um token válido
// (Authorization: Bearer). Sem a chave, segue aberto (modo dev/legado) com aviso.
if (config.auth.enabled) {
  app.use(clerkMiddleware());
  // Guard próprio (em vez do requireAuth, que faz redirect): responde 401 JSON,
  // que é o que o cliente mobile espera.
  app.use('/api', (req, res, next) => {
    if (!getAuth(req).userId) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }
    next();
  }, router);
} else {
  console.warn(
    '[talky] AUTENTICAÇÃO DESLIGADA — defina CLERK_SECRET_KEY para exigir login no /api.',
  );
  app.use('/api', router);
}

async function main(): Promise<void> {
  // Conecta ao banco e carrega o estado ANTES de aceitar requisições.
  await initStore();
  app.listen(config.port, () => {
    console.log(`[talky] backend rodando em http://localhost:${config.port}`);
    console.log(`[talky] modelo: ${config.model} | rápido (auxiliares): ${config.fastModel}`);
    startScheduler();
  });
}

main().catch((err) => {
  console.error('[talky] falha ao iniciar o backend:', err);
  process.exit(1);
});
