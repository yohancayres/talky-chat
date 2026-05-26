import cors from 'cors';
import express from 'express';
import { config } from './config';
import { router } from './routes';
import { startScheduler } from './scheduler';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: config.model });
});

app.use('/api', router);

app.listen(config.port, () => {
  console.log(`[talky] backend rodando em http://localhost:${config.port}`);
  console.log(`[talky] modelo: ${config.model}`);
  startScheduler();
});
