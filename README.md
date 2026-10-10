# Drive Link — MVP

Plataforma de transporte sob demanda com três perfis (passageiro, motorista, administrador),
pensada inicialmente para uma operação pequena (~8 motoristas) e preparada para crescer.

Este pacote contém um **backend funcional** (API + tempo real) e **três front-ends web**
simples que já conversam com ele. Não é um produto pronto para as lojas de aplicativo —
é a base real (banco de dados, autenticação, regras de negócio, tempo real) sobre a qual
dá para construir isso. A seção "O que falta para produção" explica exatamente a distância
entre este MVP e um app publicado nas lojas.

## Estrutura do projeto

```
drive-link/
├── backend/                 # API REST + WebSocket (Node.js + Express + Socket.io)
│   ├── src/
│   │   ├── db/               # Conexão SQLite + schema + dados de teste (seed)
│   │   ├── middleware/        # Autenticação JWT e controle de acesso por perfil
│   │   ├── controllers/       # Regras de negócio (auth, corridas, motorista, admin)
│   │   ├── routes/            # Definição dos endpoints HTTP
│   │   ├── sockets/           # Eventos em tempo real (localização, status da corrida)
│   │   ├── utils/              # Cálculo de distância (Haversine) e tarifa
│   │   ├── app.js              # Configuração do Express
│   │   └── server.js           # Ponto de entrada (HTTP + WebSocket)
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── shared/              # CSS e config de API compartilhados
    ├── passenger/           # App web do passageiro
    ├── driver/              # App web do motorista
    └── admin/               # Painel administrativo
```

## Como rodar localmente

Pré-requisitos: [Node.js](https://nodejs.org) 22 ou superior (o banco de dados usa o
módulo `node:sqlite`, já embutido no Node — não precisa instalar nada nativo/compilador
extra, nem no Windows nem no Mac).

```bash
cd backend
cp .env.example .env        # ajuste JWT_SECRET antes de ir para produção
npm install
npm run seed                # cria 1 admin, 2 passageiros e 8 motoristas de teste
npm start                   # sobe a API em http://localhost:3000
```

O próprio backend já serve as telas do frontend — não precisa de um segundo
servidor nem editar nenhum endereço. Com `npm start` rodando, acesse direto:

- `http://localhost:3000/passenger/` → login `ana@teste.com` / `senha123`
- `http://localhost:3000/driver/` → login `motorista1@teste.com` / `senha123`
- `http://localhost:3000/admin/` → login `admin@drivelink.com` / `admin123`

## Testando o fluxo completo

1. Abra o painel do **motorista**, faça login e clique em "Ficar online" (o navegador vai
   pedir permissão de localização).
2. Abra o app do **passageiro** em outra aba/navegador, faça login, toque no mapa para
   marcar origem e depois destino, confira a estimativa e solicite a corrida.
3. No app do motorista, a solicitação aparece automaticamente (tempo real via WebSocket).
   Aceite a corrida.
4. No app do motorista, avance os status: "Estou a caminho" → "Cheguei ao local" →
   "Iniciar corrida" → "Finalizar corrida". O passageiro acompanha tudo em tempo real.
5. Ao finalizar, ambos podem avaliar a corrida.
6. No painel **admin**, veja o dashboard, aprove/bloqueie motoristas e ajuste a tarifa
   (taxa base, valor por km, tarifa mínima) sem precisar mexer no código.

## Arquitetura e decisões técnicas

- **Banco de dados:** SQLite (`better-sqlite3`) para rodar sem infraestrutura extra no
  início. O schema (usuários, motoristas, veículos, corridas, avaliações, configurações)
  foi desenhado para migrar depois para PostgreSQL/MySQL trocando só a camada de acesso
  em `src/db/database.js`.
- **Autenticação:** JWT com perfil embutido no token; middleware `requireRole` protege
  cada rota por tipo de usuário.
- **Tempo real:** Socket.io. O motorista emite sua localização periodicamente; o servidor
  atualiza o banco e retransmite para quem estiver acompanhando aquela corrida. O
  despacho de uma nova corrida notifica os motoristas online mais próximos (raio de 10km,
  até 5 motoristas), e apenas o primeiro a aceitar fica com a corrida (transação atômica
  evita duas pessoas aceitarem a mesma corrida).
- **Distância e tarifa:** distância em linha reta (fórmula de Haversine) — suficiente
  para estimativas no MVP. Trocar por uma rota real (OSRM próprio, ou uma API paga como
  Google Directions/Mapbox) é uma troca isolada em `src/utils/fare.js`.
- **Máquina de estados da corrida:** as transições válidas ficam centralizadas em
  `rideController.js` (`TRANSICOES`), então o sistema recusa qualquer transição fora de
  ordem (ex.: finalizar uma corrida que nunca foi aceita).
- **Mapas:** Leaflet + tiles do OpenStreetMap nos front-ends — funciona sem chave de API.
- **Segurança básica já incluída:** senhas com hash (bcrypt), rotas administrativas e de
  motorista protegidas por token e por perfil, variáveis sensíveis fora do código-fonte
  (`.env`), erros internos nunca expostos ao cliente.

## Configuração de tarifa

A fórmula usada é `valor = taxaBase + (distanciaKm × valorPorKm)`, com um piso de
`tarifaMinima`. Os três valores ficam na tabela `configuracoes` e podem ser alterados
pelo administrador a qualquer momento pelo painel (ou via `PUT /api/admin/configuracao`),
sem precisar reiniciar o servidor.

## O que falta para produção

Este MVP cobre o fluxo essencial descrito no briefing, mas alguns pontos precisam de
trabalho adicional antes de operar com usuários reais e antes de publicar nas lojas:

- **Apps nativos de verdade:** os três front-ends aqui são páginas web (HTML/JS) que
  funcionam em qualquer navegador, inclusive no celular. Para publicar na App Store e
  na Google Play como aplicativo nativo, o caminho mais direto é reaproveitar a mesma
  API e regras de negócio e construir a interface em React Native, Flutter ou Kotlin/Swift
  — isso exige um ambiente de desenvolvimento próprio (Xcode/Android Studio) e contas de
  desenvolvedor nas lojas.
- **Pagamentos reais:** hoje o sistema só registra a forma de pagamento (dinheiro/Pix)
  e o valor, sem processar a cobrança de fato. Integrar um gateway (Stripe, Mercado Pago,
  Pagar.me etc.) para Pix e cartão é um módulo novo que se encaixa na estrutura já
  separada por responsabilidade.
- **Notificações push:** as notificações hoje acontecem apenas enquanto o app está
  aberto (via WebSocket). Para alertar o usuário com o app fechado, é preciso integrar
  um serviço de push (Firebase Cloud Messaging / APNs).
- **Rotas reais e navegação:** trocar a distância em linha reta por rotas de verdade
  e adicionar navegação turn-by-turn para o motorista.
- **Recuperação de senha, verificação de e-mail/telefone e upload de documentos**
  (CNH, CRLV, foto do motorista) ainda não estão implementados.
- **Banco de dados de produção:** SQLite é ótimo para começar, mas para múltiplos
  servidores e mais volume, migrar para PostgreSQL é recomendado.
- **Hospedagem:** hoje roda em `localhost`. Para publicar, hospede o backend em um
  provedor (Render, Railway, Fly.io, uma VPS, etc.) com HTTPS, e os front-ends em
  qualquer hospedagem estática (Netlify, Vercel, S3) apontando `API_URL` para o domínio
  real.
- **Testes automatizados** e monitoramento/logs estruturados para produção.

## Dados de teste

Rodar `npm run seed` cria:
- 1 administrador (`admin@drivelink.com` / `admin123`)
- 2 passageiros (`ana@teste.com`, `bruno@teste.com` / `senha123`)
- 8 motoristas já aprovados e online (`motorista1@teste.com` até `motorista8@teste.com` / `senha123`)

Use-os para testar o fluxo completo antes de cadastrar pessoas reais.
