-- Obf-CC usa o lexer principal em src/lexer.js para o backend web.
-- Este arquivo existe como marcador da camada 1 da arquitetura Lua/Luau.
return {
    layer = "lexer",
    implementation = "src/lexer.js",
}
