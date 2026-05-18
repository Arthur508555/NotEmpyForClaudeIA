-- Obf-CC usa o Base85 custom principal em src/base85.js.
-- O alfabeto do runtime final e reconstruido por codigos numericos dentro da VM.
return {
    layer = "base85",
    implementation = "src/base85.js",
}
