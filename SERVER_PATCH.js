// ============================================================
//  PATCH PARA server.js — adicione apenas estas 2 linhas
//  NÃO apague nada do seu server.js atual
// ============================================================
//
//  Encontre no seu server.js a linha onde o "app" é criado:
//    const app = express();
//
//  Logo ABAIXO dessa linha, adicione:

const apiRouter = require('./api/router');
app.use('/api', apiRouter);

//  É só isso. Seu server.js final ficará mais ou menos assim:
//
//  ┌─────────────────────────────────────────────┐
//  │  const express = require('express');         │
//  │  const app = express();                      │
//  │                                              │
//  │  // ← ADICIONE AQUI ↓                        │
//  │  const apiRouter = require('./api/router');  │
//  │  app.use('/api', apiRouter);                 │
//  │  // ← FIM DA ADIÇÃO                          │
//  │                                              │
//  │  // ... resto do seu server.js inalterado    │
//  │  app.listen(PORT, ...);                      │
//  └─────────────────────────────────────────────┘
