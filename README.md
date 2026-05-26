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

> Funcionalidades da visão completa que ainda **não** estão aqui (ver Roadmap):
> mensagens proativas, análise de notícias do interesse do personagem, e
> múltiplos personagens conversando entre si no mesmo grupo.

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

## API do backend

| Método | Rota                                | Descrição                                    |
| ------ | ----------------------------------- | -------------------------------------------- |
| `GET`  | `/health`                           | Status do servidor.                          |
| `POST` | `/api/characters/generate`          | Gera personagem + conversa + 1ª mensagem.    |
| `GET`  | `/api/conversations/:id`            | Retorna conversa, personagens e histórico.   |
| `POST` | `/api/conversations/:id/messages`   | Envia mensagem e recebe a resposta.          |

## Roadmap (visão completa)

A modelagem de dados já foi pensada para suportar grupos com vários personagens
(`Conversation.characterIds` é uma lista). Próximos passos naturais:

- [ ] **Mensagens proativas:** um agendador no backend que faz o personagem
      mandar mensagem sozinho (manhã/noite), reagindo à rotina e ao humor.
- [ ] **Notícias e cotidiano:** buscar notícias dos interesses do personagem
      (ex: via web search) e gerar conversas sobre clima, política e fofocas.
- [ ] **Acontecimentos na vida do personagem:** evoluir a linha do tempo ao
      longo do tempo (eventos novos, mudanças de humor, fatos do dia a dia).
- [ ] **Múltiplos personagens:** introduzir novos personagens de forma orgânica
      no mesmo grupo, com personalidades diferentes, inclusive conversando entre
      si (atribuindo o nome de quem fala em cada mensagem).
- [ ] **Streaming** das respostas para uma sensação de digitação em tempo real.
- [ ] **Banco de dados** real e autenticação de usuários.
