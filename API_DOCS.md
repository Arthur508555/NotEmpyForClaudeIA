# wRyObf — API Pública

Base URL: `https://wryobf.onrender.com`

---

## Setup (3 passos)

### 1. Instalar dependências novas
```bash
npm install helmet express-rate-limit
```

### 2. Adicionar 2 linhas no `server.js`
```js
const apiRouter = require('./api/router');
app.use('/api', apiRouter);
```

### 3. Plugar o obfuscador em `api/router.js`

Abra `api/router.js` e procure a linha:
```js
const result = await Promise.resolve(obfuscate(script, settings));
```

Ajuste conforme o que `src/obfuscador.js` exporta:

| Se exporta... | Use... |
|---|---|
| `module.exports = function(code, opts)` | `obfuscate(script, settings)` ✅ já está assim |
| `module.exports = { run: fn }` | `obfuscate.run(script, settings)` |
| `module.exports = class Obf { static run }` | `obfuscate.run(script, settings)` |

---

## Variáveis de ambiente

```env
ADMIN_SECRET=senha_forte_aqui      # protege geração/revogação de keys
ADMIN_API_KEY=wry_suakeyadmin      # key pré-criada para você mesmo
API_RATE_LIMIT=100                 # req/hora por key (padrão: 100)
API_MAX_SCRIPT_KB=100              # tamanho máximo do script (padrão: 100)
API_VERSION=1.0.0
```

---

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/status` | Status da API |
| GET | `/api/version` | Versão |
| GET | `/api/stats` | Estatísticas de uso |
| POST | `/api/keys/generate` | Gerar API Key (admin) |
| POST | `/api/keys/revoke` | Revogar API Key (admin) |
| POST | `/api/obfuscate` | **Obfuscar código** |

---

## POST /api/obfuscate

**Request:**
```json
{
  "apikey": "wry_xxx",
  "script": "print('hello world')",
  "settings": {
    "encryptStrings": true,
    "junkCode": true,
    "virtualize": true
  }
}
```

**Resposta OK:**
```json
{
  "success": true,
  "obfuscated": "CODIGO_OBFUSCADO",
  "stats": {
    "time": "120ms",
    "size_before": 1200,
    "size_after": 8400
  }
}
```

**Resposta de erro:**
```json
{ "success": false, "error": "Mensagem de erro" }
```

---

## Exemplos de integração

### fetch (JavaScript)
```js
const res = await fetch("https://wryobf.onrender.com/api/obfuscate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    apikey: "wry_xxx",
    script: "print('hello')",
    settings: { encryptStrings: true, junkCode: true }
  })
});
const data = await res.json();
console.log(data.obfuscated);
```

### axios (JavaScript)
```js
import axios from "axios";

const { data } = await axios.post("https://wryobf.onrender.com/api/obfuscate", {
  apikey: "wry_xxx",
  script: "print('hello')",
  settings: { encryptStrings: true }
});
console.log(data.obfuscated);
```

### Python (requests)
```python
import requests

r = requests.post("https://wryobf.onrender.com/api/obfuscate", json={
    "apikey": "wry_xxx",
    "script": "print('hello world')",
    "settings": {"encryptStrings": True, "junkCode": True}
})
data = r.json()
print(data["obfuscated"])
```

### cURL
```bash
curl -X POST https://wryobf.onrender.com/api/obfuscate \
  -H "Content-Type: application/json" \
  -d '{"apikey":"wry_xxx","script":"print(\"hello\")","settings":{"encryptStrings":true}}'
```

---

## Gerar uma API Key (admin)

```bash
curl -X POST https://wryobf.onrender.com/api/keys/generate \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: sua_senha_forte" \
  -d '{"owner":"cliente1"}'
```

Resposta:
```json
{ "success": true, "apiKey": "wry_a1b2c3d4e5f6..." }
```

---

## Deploy no Render

1. Faça `git add api/ API_DOCS.md` e `git push`
2. No Render → seu serviço → **Environment**
3. Adicione as variáveis:
   ```
   ADMIN_SECRET=senha_forte
   ADMIN_API_KEY=wry_suakeyadmin
   ```
4. Redeploy — a API estará em `/api/...` automaticamente

---

## Arquivos adicionados (apenas estes)

```
api/
├── router.js       ← Todos os endpoints
└── keyManager.js   ← Sistema de API Keys
API_DOCS.md         ← Esta documentação
SERVER_PATCH.js     ← Mostra as 2 linhas para server.js
```

**Nenhum arquivo existente foi modificado.**
