# Talky

Um app mobile que funciona como um **game de chat com IA**. Você ganha um
personagem com personalidade, história de vida e rotina próprias, e conversa com
ele todos os dias — contando como foi o seu dia e acompanhando a vida dele.

Este repositório contém a **primeira entrega**: o loop principal funcionando.

- **Onboarding** que gera um personagem único (personalidade, história, linha do
  tempo e interesses) usando o Claude.
- **Chat diário** em que o personagem responde sempre dentro do personagem,
  com memória da conversa.
- **Perfil do personagem** com biografia, personalidade e linha do tempo da vida.
- **Mensagens proativas:** o personagem manda mensagens sozinho quando a
  conversa fica em silêncio, respeitando horário do dia e um "horário de sono".

> Funcionalidades da visão completa que ainda **não** estão aqui (ver Roadmap):
> notificações push (com o app fechado), análise de notícias do interesse do
> personagem, e múltiplos personagens conversando entre si no mesmo grupo.

## Arquitetura

```
talky-chat/
├── backend/   # Node + TypeScript + Express. Guarda a chave da API e fala com o Claude.
└── mobile/    # App Expo / React Native (TypeScript).
```

O app mobile fala **apenas** com o backend; a chave da Anthropic nunca sai do
servidor. Toda a inteligência (gerar personagem, responder no chat) acontece no
backend, na pasta `backend/src/ai.ts` e nos prompts em `backend/src/prompts.ts`.

A persistência é um arquivo JSON simples (`backend/data/db.json`) — suficiente
para o protótipo; trocar por um banco de dados real quando crescer.

## Pré-requisitos

- Node.js 18+
- Uma chave de API da Anthropic (https://console.anthropic.com/)
- Para rodar o app: o app **Expo Go** no celular, ou um emulador iOS/Android.

## 1. Backend

```bash
cd backend
npm install
cp .env.example .env          # depois edite .env e cole sua ANTHROPIC_API_KEY
npm run dev                   # sobe em http://localhost:3000
```

Variáveis em `backend/.env`:

| Variável            | Descrição                                              |
| ------------------- | ------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | Sua chave da Anthropic (obrigatória).                  |
| `TALKY_MODEL`       | Modelo. Padrão `claude-opus-4-7`. Para respostas mais rápidas/baratas: `claude-sonnet-4-6`. |
| `PORT`              | Porta do servidor (padrão `3000`).                     |
| `PROACTIVE_*`       | Configuração das mensagens proativas (ver `.env.example`). |

Teste rápido: `curl http://localhost:3000/health`

## 2. App mobile

```bash
cd mobile
npm install
npx expo start
```

Abra no Expo Go (escaneando o QR code) ou pressione `i`/`a` para emulador.

### Apontando o app para o backend

- **Emulador iOS ou web:** `http://localhost:3000` já funciona.
- **Celular físico (Expo Go):** o celular não enxerga `localhost` da sua
  máquina. Descubra o IP local do computador (ex: `192.168.0.10`) e rode:

  ```bash
  EXPO_PUBLIC_API_URL=http://192.168.0.10:3000 npx expo start
  ```

  (O celular e o computador precisam estar na mesma rede Wi‑Fi.)

## Como funciona o loop

1. No onboarding, o app chama `POST /api/characters/generate`. O backend pede
   ao Claude um personagem completo (JSON estruturado), salva, cria a conversa e
   gera a primeira mensagem do personagem.
2. Cada mensagem sua vai para `POST /api/conversations/:id/messages`. O backend
   monta um *system prompt* com a persona + história + rotina do personagem,
   anexa o histórico da conversa e pede a resposta ao Claude.
3. O `conversationId` fica salvo no celular (AsyncStorage), então a conversa
   continua a cada vez que você abre o app.

## Mensagens proativas

Um agendador no backend (`backend/src/scheduler.ts`) faz o personagem mandar
mensagens **sozinho** quando a conversa fica em silêncio:

- Depois de cada interação, agenda a próxima mensagem espontânea para daqui a um
  intervalo aleatório (`PROACTIVE_MIN_GAP_MINUTES`–`PROACTIVE_MAX_GAP_MINUTES`).
- Respeita o "horário de sono" do personagem (`PROACTIVE_QUIET_*`).
- A mensagem é gerada no personagem, levando em conta o horário do dia e há
  quanto tempo vocês não se falam.
- Não acumula mensagens sem resposta (para de insistir após
  `PROACTIVE_MAX_CONSECUTIVE` mensagens seguidas sem o usuário responder).

O app recebe essas mensagens por **polling** (`GET .../messages?after=<ISO>`)
enquanto está aberto, e também busca o que chegou ao reabrir/voltar ao foco.

### Testar rápido

Os intervalos padrão são de horas (realista). Para ver acontecer em ~1 minuto,
rode o backend com intervalos curtos:

```bash
PROACTIVE_MIN_GAP_MINUTES=1 PROACTIVE_MAX_GAP_MINUTES=2 PROACTIVE_QUIET_START=0 PROACTIVE_QUIET_END=0 npm run dev
```

(`PROACTIVE_QUIET_START=0 PROACTIVE_QUIET_END=0` desliga o horário de sono para
o teste.) Crie um personagem, deixe o chat aberto sem responder e aguarde — a
mensagem espontânea aparece sozinha.

## API do backend

| Método | Rota                                | Descrição                                    |
| ------ | ----------------------------------- | -------------------------------------------- |
| `GET`  | `/health`                           | Status do servidor.                          |
| `POST` | `/api/characters/generate`          | Gera personagem + conversa + 1ª mensagem.    |
| `GET`  | `/api/conversations/:id`            | Retorna conversa, personagens e histórico.   |
| `GET`  | `/api/conversations/:id/messages?after=<ISO>` | Mensagens novas (polling).         |
| `POST` | `/api/conversations/:id/messages`   | Envia mensagem e recebe a resposta.          |

## Roadmap (visão completa)

A modelagem de dados já foi pensada para suportar grupos com vários personagens
(`Conversation.characterIds` é uma lista). Próximos passos naturais:

- [x] **Mensagens proativas:** agendador no backend que faz o personagem mandar
      mensagem sozinho quando a conversa esfria, com horário de sono e limite
      anti-spam. Entrega via polling.
- [ ] **Notificações push:** entregar as mensagens proativas com o app fechado
      (Expo push + registro de token). Hoje a entrega é só com o app aberto.
- [ ] **Notícias e cotidiano:** buscar notícias dos interesses do personagem
      (ex: via web search) e gerar conversas sobre clima, política e fofocas.
- [ ] **Acontecimentos na vida do personagem:** evoluir a linha do tempo ao
      longo do tempo (eventos novos, mudanças de humor, fatos do dia a dia).
- [ ] **Múltiplos personagens:** introduzir novos personagens de forma orgânica
      no mesmo grupo, com personalidades diferentes, inclusive conversando entre
      si (atribuindo o nome de quem fala em cada mensagem).
- [ ] **Streaming** das respostas para uma sensação de digitação em tempo real.
- [ ] **Banco de dados** real e autenticação de usuários.
