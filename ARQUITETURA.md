# Obf-CC Lua/Luau

Ofuscador web modular para Lua/Luau com pipeline em camadas. Cada etapa valida a anterior antes de entregar o script final em linha única.

## Pipeline

1. **Lexer** (`src/lexer.js`): tokeniza Lua/Luau preservando strings curtas, long brackets, comentários, números hex/decimais, keywords e símbolos compostos.
2. **Parser estrutural** (`src/parser.js`): valida blocos, delimitadores, `if/elseif/else/end`, `repeat/until`, funções e estatísticas de AST.
3. **AST**: representa o chunk e metadados usados pelo relatório e pelas validações.
4. **Transformações**: normaliza nome do chunk, empacota payload e prepara chunks.
5. **Virtualização** (`src/bytecode.js`): cria bytecode virtual com OP_Codes customizados para bootstrap, push, join, decode, inflate, exec e halt.
6. **Compressão** (`src/lzma.js`): compressor custom inspirado em LZMA/LZ com janela e referências de repetição.
7. **Envelope de programa** (`src/program_envelope.js`): empacota o binário da VM comprimido com validação de tamanho, checksum do conteúdo e checksum do envelope.
8. **Serialização** (`src/base85.js`): Base85 custom para payload e programa virtual.
9. **Runtime VM** (`src/runtime_builder.js`): dispatcher protegido com acesso a nativas somente via `LIBS`, validação por fragmento e inflador Lua do envelope antes do parser binário.
   - Registradores e stack são encapsulados com selos runtime, espelho de integridade, cache transitório de instrução e wipe por ciclo.
   - O dispatch usa mapa indireto de handlers e permutação runtime de slots, sem depender de um `if/elseif` fixo.
   - Handlers são gerados por factory contextual e descartados após a instrução, reduzindo closures persistentes disponíveis para snapshot.
   - O bytecode criptografado é fragmentado em segmentos no parser binário; o fetch lê apenas a janela necessária para a instrução atual.
   - O runtime mantém camadas falsas de VM/decode, opcodes decoy e paths mortos para dificultar reconstrução automatizada.
10. **Proteções** (`src/validator.js`): anti-corrupt, validação de round-trip, validação do envelope, checagem de encapsulamento, limite de instruções, validação de OP_Codes, limite de stack e erro controlado.
11. **Builder final**: gera bootstrap polimórfico em uma única linha, evitando a assinatura fixa `return(function() ... end)()`.

## Melhorias de runtime

- Loader interno captura `_load` cedo e reconstrói o fallback de `loadstring` sem depender de acesso direto ao ambiente durante a execução da VM.
- `SAFELOAD` valida tipos, usa `pcall`, tenta Lua 5.1 primeiro e depois Lua 5.2+, e aplica sandbox por `setfenv` quando disponível.
- Key system binário com XOR em múltiplas camadas bloqueia a execução antes do payload; falha imprime `Error, key not found!` e retorna.
- Debug interno modular registra etapas da VM e pode emitir trace diagnóstico opcional sem usar `print` global diretamente.
- Falhas de runtime são encapsuladas em mensagem amigável com Error ID, sem stack trace ou detalhes internos da VM.
- A renomeação lexical usa nomes formados por `i`, `I` e `l`, com estratégia conservadora para preservar semântica.
- O runtime executa decode sob demanda de instrução, apaga o cache anterior, aplica rolling masks nos registradores e valida selos de stack/upvalue durante a execução.
- O anti-hook inclui fingerprints de metatable, coroutine, traceback, pcall/error e primitivas como `tostring`/`rawequal`, além dos snapshots já existentes.
- Quando o ambiente oferece `newproxy`, a VM usa um userdata opcional como selo contextual; quando não oferece, mantém o caminho Lua puro.

## Tabela LIBS

O runtime começa com uma tabela exclusiva de bibliotecas/funções nativas:

```lua
local LIBS = {
    byte = string.byte,
    char = string.char,
    sub = string.sub,
    concat = table.concat,
    insert = table.insert,
    unpack = unpack or table.unpack,
    tonumber = tonumber,
    tostring = tostring,
    floor = math.floor,
    random = math.random,
}
```

A VM acessa nativas somente por `LIBS.byte(...)`, `LIBS.concat(...)` e equivalentes. Isso melhora performance por cache local, facilita virtualização, centraliza controle do ambiente, reduz superfície global, melhora sandbox/isolamento, fortalece ofuscação e deixa o controle interno da VM em uma camada única.

## Execução

```powershell
npm start
```

Acesse `http://localhost:3000`.
