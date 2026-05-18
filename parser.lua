-- Obf-CC usa o parser estrutural principal em src/parser.js para o backend web.
-- Este arquivo existe como marcador da camada 2/3 da arquitetura Lua/Luau.
return {
    layer = "parser_ast",
    implementation = "src/parser.js",
}
