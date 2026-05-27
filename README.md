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
- **Notificações push:** as mensagens proativas chegam como notificação mesmo
  com o app fechado (via Expo push).
- **Notícias e cotidiano (busca na web):** parte das mensagens proativas é
  baseada em algo **real e recente** — notícias dos interesses do personagem,
  clima, fofocas, esportes — usando a busca na web do Claude.
- **Respostas com atraso humano + status:** o personagem tem uma agenda diária
  (dormindo, trabalhando, em reunião, vendo um filme, livre…) que define quando
  ele responde rápido, devagar ou só ao acordar. O app mostra o status dele e
  você também pode definir o **seu** status, que vira contexto pra ele comentar.
- **Temperamento com níveis:** cada personagem tem intensidades (0-10) de traços
  como ironia, sarcasmo, passivo-agressividade, doçura, brutalidade, implicância,
  sonhador, ceticismo, nerdice, etc. — variando bastante entre personagens e
  influenciando o tom das conversas.
- **Humor que muda dia a dia:** além do temperamento (fixo), o personagem tem um
  **humor** que varia a cada dia — dias mais animados, tristes, pra baixo,
  cansados, entediados — com viés do próprio temperamento (otimista tende a dias
  melhores). As **conversas também mudam o humor**: um papo bom anima, um papo
  pesado deixa pra baixo. O humor entra no tom das respostas e aparece no perfil
  e ao lado do nome (emoji). Configurável (`MOOD_*`); lógica em
  `backend/src/mood.ts`.
- **Intimidade (controle interno):** cada conversa tem um nível de intimidade
  (0-100, **nunca exibido**) que define o quanto o personagem se abre. Cresce
  devagar com bom convívio — cada personagem tem uma **taxa de ganho própria**
  (uns criam laço rápido, outros demoram) — e **cai quando o usuário força
  intimidade cedo demais** (declaração intensa, assunto íntimo, etc.), gerando
  atrito/desconforto na própria resposta. A intimidade também influencia o
  **tempo de resposta** (menos intimidade → demora mais a começar a responder,
  sempre com um piso de ~1-3s) e a **frequência das mensagens proativas** (mais
  intimidade → puxa assunto com intervalos bem menores). Configurável
  (`INTIMACY_ENABLED`); lógica em `backend/src/intimacy.ts`.
- **Ritmo humano de digitação:** as respostas levam um tempo de "digitando..."
  proporcional ao tamanho. Cada personagem tem um **estilo de picotar** (0-100):
  uns mandam tudo numa mensagem, outros quebram em várias com pequenos intervalos
  — e esse estilo se ajusta se o usuário der feedback ("para de picotar" / "manda
  uma de cada vez"). Em **assuntos delicados/constrangedores**, a digitação fica
  **hesitante** (digita, para, volta), como quem pensa e reescreve. Lógica em
  `backend/src/messaging.ts` e `backend/src/scheduler.ts`.
- **Personagens globais:** os personagens são únicos e compartilhados entre todos
  os usuários. Ao entrar, você pode "esbarrar" com um personagem que já existe no
  Talky (mesmo nome e identidade) em vez de criar um novo.
- **Foto de perfil gerada por IA:** ao criar o personagem, o backend resume as
  características dele e pede uma foto de perfil realista à API de imagens da
  OpenAI (`gpt-image-2`). É opcional — sem `OPENAI_API_KEY`, usa o avatar de emoji.
- **"Manda uma foto":** quando o usuário pede uma foto, o **personagem interpreta
  e decide, EM PERSONAGEM** (conforme personalidade, humor e intimidade), se manda
  ou não — reservado/pouca intimidade tende a enrolar ou recusar; íntimo/casual
  manda numa boa. Se decide mandar, gera uma **foto contextual** (roupa, cenário
  e ângulo variados a cada vez, sem copiar o look do perfil) com legenda no jeito
  dele; se não, responde em texto. Decisão em `decidePhotoResponse`
  (`backend/src/ai.ts`); geração em `backend/src/image.ts`.
  - **Galeria reaproveitável:** cada personagem guarda as fotos geradas; outra
    pessoa pode receber uma já existente (economiza), mas a **mesma pessoa nunca
    recebe a mesma foto duas vezes**.
- **Receber fotos do usuário:** o usuário pode **anexar uma foto** no chat (botão
  ＋). O backend salva a imagem, **interpreta com visão** (descrição em texto) e
  insere essa descrição no contexto — então o personagem **reage ao conteúdo da
  foto** naturalmente. A interpretação é feita uma vez e guardada (`interpretImage`
  em `backend/src/ai.ts`), sem reenviar a imagem a cada turno.
- **Múltiplas conversas:** tela de lista (estilo mensageiro) com prévia da última
  mensagem, horário e badge de não lidos. Começa com uma conversa; o botão "+"
  permite conhecer novos contatos. Cada conversa pertence a um usuário (userId),
  base para personagens entrarem em contato no futuro.

> Funcionalidades da visão completa que ainda **não** estão aqui (ver Roadmap):
> múltiplos personagens conversando entre si no mesmo grupo, e personagens
> entrando na conversa de outros usuários.

## Arquitetura

```
talky-chat/
├── backend/   # Node + TypeScript + Express. Guarda a chave da API e fala com o Claude.
└── mobile/    # App Expo / React Native (TypeScript).
```

O app mobile fala **apenas** com o backend; a chave da Anthropic nunca sai do
servidor. Toda a inteligência (gerar personagem, responder no chat) acontece no
backend, na pasta `backend/src/ai.ts` e nos prompts em `backend/src/prompts.ts`.

A persistência usa **MongoDB** quando `MONGODB_URI` está definida (produção); sem
ela, cai num arquivo JSON (`backend/data/db.json`) — prático para dev local. O
`store.ts` mantém o estado em memória e grava no banco em *write-through*, então
o acesso continua síncrono no resto do app. Veja **[Produção](#produção)**.

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
| `OPENAI_API_KEY`    | Chave da OpenAI para a foto de perfil (opcional).      |
| `TALKY_IMAGE_MODEL` | Modelo de imagem. Padrão `gpt-image-2`.                |
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
3. O app guarda um `userId` no celular (AsyncStorage) e lista suas conversas pelo
   backend (`GET /api/users/:userId/conversations`), então tudo continua a cada
   vez que você abre o app — e abre espaço para novas conversas surgirem.

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

## Notificações push

As mensagens proativas também chegam como **notificação** com o app fechado:

1. Ao entrar no chat, o app pede permissão e registra um **Expo push token** no
   backend (`POST /api/conversations/:id/push-token`).
2. Quando o agendador dispara uma mensagem proativa, o backend envia um push
   para os tokens daquela conversa (serviço da Expo, em `backend/src/push.ts`).

> **Importante:** push exige um **device físico** e um projeto vinculado ao
> **EAS** (para o `projectId`). Recomenda-se um **development build**
> (`npx expo run:android` / `run:ios` ou EAS Build) — no Expo Go o push remoto é
> limitado e pode não funcionar dependendo da versão. Em emulador/web o app
> simplesmente ignora o push e continua usando o polling em primeiro plano.

## Notícias e cotidiano (busca na web)

Para o personagem parecer ancorado no mundo real, parte das mensagens proativas
é "movida a notícias": o personagem usa a **ferramenta de busca na web do
Claude** (server-side) para achar algo **real e recente** sobre seus interesses
(ou clima, fofocas, esportes, tecnologia) e comenta no estilo dele, com opinião.

- A decisão acontece no agendador: com chance `PROACTIVE_NEWS_CHANCE` a mensagem
  proativa vira uma mensagem de notícia. Se a busca não render, cai de volta
  para uma mensagem espontânea normal.
- A lógica está em `backend/src/ai.ts` (`generateNewsMessage`) e no prompt
  `buildNewsDirective` em `backend/src/prompts.ts`.
- Opcionalmente, as **respostas normais** também podem buscar na web
  (`WEB_SEARCH_IN_REPLIES=true`) — útil quando o usuário pergunta sobre algo
  atual, ao custo de mais latência. Desligado por padrão.

> Requer um modelo com suporte à busca (o padrão `claude-opus-4-7` suporta). A
> busca roda no servidor da Anthropic; nada é configurado no app.

## Respostas com atraso humano e status

O personagem não responde mais na hora: ele tem uma **agenda diária**
(`schedule`, gerada junto com o personagem) com blocos como "dormindo",
"trabalhando", "em reunião", "vendo um filme" ou "livre", cada um com uma
responsividade (`fast`/`slow`/`away`/`asleep`).

- Ao enviar uma mensagem, o backend calcula um atraso realista (curto na maioria
  das vezes, às vezes minutos) conforme a atividade atual + acaso, e **agenda** a
  resposta. O app recebe quando fica pronta (mesmo polling/push das proativas).
- **Dormindo:** o personagem só responde quando "acordar". O app mostra o status
  (ex: "em reunião", "dormindo 💤", "online", "digitando...").
- A rotina **se adapta**: nas horas em que você mais conversa, ele tende a
  responder mais rápido.
- **Seu status:** no topo do chat você escolhe seu status (No trabalho, Em
  reunião, Vendo um filme, Ocupado, Ausente, Disponível). Isso é enviado como
  contexto pro personagem — ele pode perguntar/comentar ("como tá o trabalho?",
  "tá ocupado?") e não estranhar se você demorar.
- O que o personagem está fazendo agora também entra no prompt: ele pode
  comentar naturalmente ("tô no trabalho mas deu uma brecha", "acabei de ver um
  filme…").

Tudo é configurável em `backend/.env` (`REPLY_*`). A lógica de agenda/atraso
está em `backend/src/availability.ts`.

### Testar rápido

Os atrasos podem chegar a minutos. Para ver as respostas chegando em segundos:

```bash
REPLY_SPEED_FACTOR=0.05 npm run dev
```

Para voltar ao comportamento antigo (resposta imediata): `REPLY_DELAY_ENABLED=false`.

## Foto de perfil gerada por IA

Ao criar um personagem novo, o backend:

1. Gera as características do personagem (incluindo uma descrição física,
   `appearance`).
2. Resume tudo isso num prompt de foto de perfil realista
   (`backend/src/image.ts`).
3. Pede a imagem à API de imagens da OpenAI (`gpt-image-2`), salva em
   `backend/data/avatars/<id>.png` e serve em `/avatars/<id>.png`.

O app mostra a foto no chat, nas mensagens e no perfil; se não houver foto
(sem `OPENAI_API_KEY`, geração desligada ou falha), cai no avatar de emoji.

No **perfil do personagem** (toque no cabeçalho do chat) há um botão para
**gerar/trocar a foto**:

- Se o personagem ainda não tem foto (ex: criado antes deste recurso), gera uma
  do zero.
- Se já tem, mantém as **mesmas feições** (usando a descrição `appearance`, que é
  criada na hora se faltar) mas em **outro cenário, ângulo, luz e roupa**.

Isso resolve também a geração de foto para personagens **já criados**.

- É **opcional**: defina `OPENAI_API_KEY` no `backend/.env` para ativar.
- A foto é gerada **em paralelo** com a 1ª mensagem, então não soma latência.
- Personagens reusados do pool global já trazem a foto criada anteriormente.
- Configurável: `TALKY_IMAGE_MODEL`, `TALKY_IMAGE_SIZE`, `OPENAI_IMAGE_ENDPOINT`,
  `IMAGE_GEN_ENABLED`.

## API do backend

| Método | Rota                                | Descrição                                    |
| ------ | ----------------------------------- | -------------------------------------------- |
| `GET`  | `/health`                           | Status do servidor.                          |
| `POST` | `/api/characters/generate`          | Gera personagem + conversa + 1ª mensagem.    |
| `GET`  | `/api/conversations/:id`            | Retorna conversa, personagens e histórico.   |
| `DELETE` | `/api/conversations/:id`          | Exclui a conversa (mantém o personagem no pool). |
| `GET`  | `/api/conversations/:id/messages?after=<ISO>` | Mensagens novas + status (polling). |
| `POST` | `/api/conversations/:id/messages`   | Envia mensagem (resposta vem com atraso, via polling). |
| `POST` | `/api/conversations/:id/push-token` | Registra um token de push (Expo).            |
| `POST` | `/api/conversations/:id/user-status` | Define o status do usuário (contexto pro personagem). |
| `POST` | `/api/characters/:id/avatar`        | Gera/troca a foto de perfil do personagem.   |
| `GET`  | `/api/users/:userId/conversations`  | Lista as conversas do usuário (prévia + não lidos). |
| `POST` | `/api/conversations/:id/read`       | Marca a conversa como lida.                  |
| `POST` | `/api/conversations/:id/claim`      | Associa uma conversa a um usuário.           |

## Produção

### Banco de dados (MongoDB)

Em produção o backend persiste no **MongoDB**. Os dados são *document-shaped*
(um personagem é um documento com personalidade, temperamento, agenda, humor e
galeria de fotos), então NoSQL encaixa naturalmente. Defina `MONGODB_URI` e o
backend usa o Mongo; na primeira execução, se houver um `db.json` antigo, ele é
**migrado automaticamente**. Sem `MONGODB_URI`, o backend cai no arquivo (dev).

> Arquitetura: estado em memória + *write-through* para o Mongo, mantendo a API
> síncrona. Isso implica **uma única instância** do backend (o agendador roda em
> processo). Para escalar horizontalmente no futuro, migrar o `store.ts` para
> acesso assíncrono e tirar o agendador do processo web.

### Rodar com Docker (local ou VPS)

```bash
cp .env.example .env            # MONGO_PASSWORD (senha forte), etc.
cp backend/.env.example backend/.env   # ANTHROPIC_API_KEY, OPENAI_API_KEY, ...
docker compose up --build -d
curl http://localhost:3000/health
```

Sobe `backend` + `mongo` com volumes persistentes (`mongo-data` e `talky-data`
para avatares/fotos). A porta do Mongo **não** é exposta (fica na rede interna).

### Deploy num VPS — duas opções

**Opção A (recomendada): painel Coolify.** Para um VPS Linux comum, o
[Coolify](https://coolify.io) (open-source, self-hosted, estilo Heroku) é o mais
prático: instala com um script, builda a partir do `backend/Dockerfile`, sobe um
**MongoDB com um clique**, gerencia variáveis de ambiente e dá **HTTPS automático
(Let's Encrypt)** + **deploy automático no push** via webhook. Nesse caso você
**não precisa do GitHub Actions** — o painel cuida do build e do deploy.
Alternativas igualmente boas: **Dokploy** e **EasyPanel** (mesma ideia).

**Opção B: Docker puro + GitHub Actions.** Use o workflow em
`.github/workflows/deploy.yml`: a cada push na `main`, ele builda a imagem do
backend, publica no **GHCR** e atualiza o VPS por SSH (`docker compose pull && up`).

No VPS (uma vez): instale Docker + Compose, crie a pasta do app com os dois
arquivos de ambiente (`.env` e `backend/.env`) e ponha um **proxy reverso com
HTTPS** na frente (Caddy/Traefik/Nginx). Configure os **secrets** no GitHub:

| Secret | Para quê |
| ------ | -------- |
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | acesso SSH ao servidor |
| `VPS_APP_DIR` | pasta no VPS onde fica o `docker-compose.yml` + `.env` |
| `GHCR_TOKEN` | PAT com `read:packages` para o VPS baixar a imagem |

### Apontar o app para o backend

No build do app (EAS), defina `EXPO_PUBLIC_API_URL` para a **URL https** do
backend em produção (ver seção do app mobile).

## Roadmap (visão completa)

A modelagem de dados já foi pensada para suportar grupos com vários personagens
(`Conversation.characterIds` é uma lista). Próximos passos naturais:

- [x] **Mensagens proativas:** agendador no backend que faz o personagem mandar
      mensagem sozinho quando a conversa esfria, com horário de sono e limite
      anti-spam. Entrega via polling.
- [x] **Notificações push:** mensagens proativas entregues com o app fechado
      (Expo push + registro de token). Requer device físico e build com EAS.
- [x] **Notícias e cotidiano:** mensagens proativas baseadas em busca na web
      sobre os interesses do personagem, clima, fofocas e acontecimentos reais.
- [x] **Respostas com atraso humano + status:** agenda diária do personagem
      (dormindo/trabalhando/reunião/filme/livre), atraso realista e status do
      personagem e do usuário.
- [x] **Temperamento com níveis:** traços (ironia, sarcasmo, doçura, etc.) com
      intensidade 0-10 por personagem, influenciando o tom.
- [x] **Personagens globais:** pool compartilhado — novos usuários podem
      encontrar personagens já existentes (`CHARACTER_POOL_REUSE_CHANCE`).
- [x] **Foto de perfil por IA:** foto realista gerada a partir das
      características do personagem (OpenAI `gpt-image-2`), com fallback no emoji.
- [x] **Múltiplas conversas:** tela de lista com não lidos, navegação lista ↔
      chat e botão "+" para novos contatos; conversas pertencem a um `userId`.
- [ ] **Personagem inicia o contato:** com a base de `userId` + lista, um
      personagem (global) pode abrir uma conversa nova com o usuário sozinho.
- [ ] **Acontecimentos na vida do personagem:** evoluir a linha do tempo ao
      longo do tempo (eventos novos, mudanças de humor, fatos do dia a dia).
- [ ] **Múltiplos personagens:** introduzir novos personagens de forma orgânica
      no mesmo grupo, com personalidades diferentes, inclusive conversando entre
      si (atribuindo o nome de quem fala em cada mensagem).
- [ ] **Streaming** das respostas para uma sensação de digitação em tempo real.
- [x] **Banco de dados** real (MongoDB) com persistência em produção e Docker.
- [ ] **Autenticação de usuários** (hoje o `userId` é só o identificador do device).
