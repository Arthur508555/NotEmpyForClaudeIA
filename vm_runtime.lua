-- O runtime VM final e gerado dinamicamente por src/runtime_builder.js.
-- Ele inicia com local LIBS = {...}, acessa nativas somente por LIBS.*,
-- executa OP_Codes customizados e retorna return(function() ... end)().
return {
    layer = "runtime_vm",
    implementation = "src/runtime_builder.js",
}
