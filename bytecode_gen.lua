-- BYTECODE GENERATOR: Converte AST em bytecode virtual customizado
-- OP_Codes completamente customizados, não é bytecode Lua nativo

local BytecodeGen = {}

-- OP_Codes customizados (não relacionados ao bytecode Lua)
BytecodeGen.OP = {
    -- Controle de fluxo
    NOP = 0x00,
    JMP = 0x01,
    COND_JMP = 0x02,
    LOOP = 0x03,
    CALL = 0x04,
    RET = 0x05,
    
    -- Stack operations
    PUSH = 0x10,
    POP = 0x11,
    DUP = 0x12,
    SWAP = 0x13,
    
    -- Operações aritméticas
    ADD = 0x20,
    SUB = 0x21,
    MUL = 0x22,
    DIV = 0x23,
    MOD = 0x24,
    POW = 0x25,
    
    -- Operações lógicas
    AND = 0x30,
    OR = 0x31,
    NOT = 0x32,
    EQ = 0x33,
    NE = 0x34,
    LT = 0x35,
    LE = 0x36,
    GT = 0x37,
    GE = 0x38,
    
    -- Operações com tabelas
    TABLE_NEW = 0x40,
    TABLE_SET = 0x41,
    TABLE_GET = 0x42,
    TABLE_PUSH = 0x43,
    
    -- Operações com variáveis
    LOAD_CONST = 0x50,
    LOAD_VAR = 0x51,
    STORE_VAR = 0x52,
    LOAD_GLOBAL = 0x53,
    STORE_GLOBAL = 0x54,
    
    -- String operations
    CONCAT = 0x60,
    LEN = 0x61,
    
    -- Tipo de dados
    TYPE_OF = 0x70,
    TO_NUMBER = 0x71,
    TO_STRING = 0x72,
}

-- Reversão de OP_Codes (para debugging)
BytecodeGen.OP_NAMES = {}
for name, code in pairs(BytecodeGen.OP) do
    BytecodeGen.OP_NAMES[code] = name
end

function BytecodeGen.new()
    return {
        bytecode = {},
        constants = {},
        labels = {},
        label_counter = 0,
        var_table = {},
        scope_depth = 0,
    }
end

-- Adicionar instrução com argumentos
function BytecodeGen:emit(opcode, ...)
    local instr = {
        op = opcode,
        args = {...},
    }
    table.insert(self.bytecode, instr)
    return #self.bytecode
end

-- Adicionar constante
function BytecodeGen:add_constant(value)
    for i, const in ipairs(self.constants) do
        if const == value then
            return i - 1  -- Índice 0-based
        end
    end
    table.insert(self.constants, value)
    return #self.constants - 1
end

-- Gerar novo label
function BytecodeGen:new_label()
    self.label_counter = self.label_counter + 1
    return "L_" .. self.label_counter
end

-- Marcar posição de label
function BytecodeGen:mark_label(label)
    self.labels[label] = #self.bytecode + 1
end

-- Corrigir jump
function BytecodeGen:fix_jump(jump_addr, label)
    local target = self.labels[label]
    if target then
        self.bytecode[jump_addr].args[1] = target
    end
end

-- Compilar AST para bytecode
function BytecodeGen:compile(ast)
    if ast.type == "BLOCK" then
        self:compile_block(ast)
    end
    
    return {
        bytecode = self.bytecode,
        constants = self.constants,
    }
end

function BytecodeGen:compile_block(block)
    for _, stmt in ipairs(block.statements or {}) do
        self:compile_statement(stmt)
    end
end

function BytecodeGen:compile_statement(stmt)
    if not stmt then return end
    
    local type = stmt.type
    
    if type == "LOCAL_VAR" then
        for i, name in ipairs(stmt.names or {}) do
            if stmt.values[i] then
                self:compile_expression(stmt.values[i])
            else
                self:emit(self.OP.PUSH, nil)  -- Push nil for uninitialized
            end
            self:emit(self.OP.STORE_VAR, name)
        end
    
    elseif type == "ASSIGNMENT" then
        for i, value in ipairs(stmt.values or {}) do
            self:compile_expression(value)
        end
        
        for i = #stmt.targets, 1, -1 do
            local target = stmt.targets[i]
            if target.type == "IDENTIFIER" then
                self:emit(self.OP.STORE_VAR, target.name)
            elseif target.type == "INDEX" then
                self:compile_expression(target.object)
                self:compile_expression(target.index)
                self:emit(self.OP.TABLE_SET)
            end
        end
    
    elseif type == "IF_STMT" then
        self:compile_if_stmt(stmt)
    
    elseif type == "WHILE_STMT" then
        self:compile_while_stmt(stmt)
    
    elseif type == "FOR_STMT" then
        self:compile_for_stmt(stmt)
    
    elseif type == "RETURN_STMT" then
        for _, val in ipairs(stmt.values or {}) do
            self:compile_expression(val)
        end
        self:emit(self.OP.RET, #stmt.values)
    
    elseif type == "EXPR_STMT" then
        self:compile_expression(stmt.expr)
    end
end

function BytecodeGen:compile_if_stmt(stmt)
    self:compile_expression(stmt.condition)
    
    local cond_jump = self:emit(self.OP.COND_JMP, 0)
    local else_label = self:new_label()
    
    self:compile_block(stmt.then_block)
    
    local end_label = self:new_label()
    self:emit(self.OP.JMP, 0)
    local jmp_addr = #self.bytecode
    
    self:mark_label(else_label)
    
    for _, part in ipairs(stmt.elseif_parts or {}) do
        self:compile_expression(part.condition)
        local jump = self:emit(self.OP.COND_JMP, 0)
        self:compile_block(part.block)
        self:emit(self.OP.JMP, 0)
    end
    
    if stmt.else_block then
        self:compile_block(stmt.else_block)
    end
    
    self:mark_label(end_label)
end

function BytecodeGen:compile_while_stmt(stmt)
    local loop_label = self:new_label()
    self:mark_label(loop_label)
    
    self:compile_expression(stmt.condition)
    local cond_jump = self:emit(self.OP.COND_JMP, 0)
    
    self:compile_block(stmt.block)
    self:emit(self.OP.JMP, self.labels[loop_label])
    
    self:fix_jump(cond_jump, loop_label)
end

function BytecodeGen:compile_for_stmt(stmt)
    -- Compilar start, finish, step
    self:compile_expression(stmt.start)
    self:compile_expression(stmt.finish)
    
    if stmt.step then
        self:compile_expression(stmt.step)
    else
        self:emit(self.OP.PUSH, 1)  -- Default step is 1
    end
    
    local loop_label = self:new_label()
    self:mark_label(loop_label)
    
    self:compile_block(stmt.block)
    self:emit(self.OP.LOOP, self.labels[loop_label])
end

function BytecodeGen:compile_expression(expr)
    if not expr then return end
    
    local type = expr.type
    
    if type == "NUMBER" then
        local const_idx = self:add_constant(expr.value)
        self:emit(self.OP.LOAD_CONST, const_idx)
    
    elseif type == "STRING" then
        local const_idx = self:add_constant(expr.value)
        self:emit(self.OP.LOAD_CONST, const_idx)
    
    elseif type == "BOOLEAN" then
        local const_idx = self:add_constant(expr.value)
        self:emit(self.OP.LOAD_CONST, const_idx)
    
    elseif type == "NIL" then
        self:emit(self.OP.PUSH, nil)
    
    elseif type == "IDENTIFIER" then
        self:emit(self.OP.LOAD_VAR, expr.name)
    
    elseif type == "BINARY_OP" then
        self:compile_expression(expr.left)
        self:compile_expression(expr.right)
        
        local op_code = self:get_binary_op_code(expr.operator)
        if op_code then
            self:emit(op_code)
        end
    
    elseif type == "UNARY_OP" then
        self:compile_expression(expr.operand)
        
        if expr.operator == "not" then
            self:emit(self.OP.NOT)
        elseif expr.operator == "-" then
            self:emit(self.OP.PUSH, -1)
            self:emit(self.OP.MUL)
        elseif expr.operator == "#" then
            self:emit(self.OP.LEN)
        end
    
    elseif type == "FUNCTION_CALL" then
        self:compile_expression(expr.func)
        for _, arg in ipairs(expr.args or {}) do
            self:compile_expression(arg)
        end
        self:emit(self.OP.CALL, #expr.args)
    
    elseif type == "TABLE_LITERAL" then
        self:emit(self.OP.TABLE_NEW)
        for _, field in ipairs(expr.fields or {}) do
            if field.key then
                self:compile_expression(field.key)
                self:compile_expression(field.value)
                self:emit(self.OP.TABLE_SET)
            else
                self:compile_expression(field.value)
                self:emit(self.OP.TABLE_PUSH)
            end
        end
    
    elseif type == "INDEX" then
        self:compile_expression(expr.object)
        self:compile_expression(expr.index)
        self:emit(self.OP.TABLE_GET)
    end
end

function BytecodeGen:get_binary_op_code(op)
    local op_map = {
        ["+"] = self.OP.ADD,
        ["-"] = self.OP.SUB,
        ["*"] = self.OP.MUL,
        ["/"] = self.OP.DIV,
        ["%"] = self.OP.MOD,
        ["^"] = self.OP.POW,
        ["and"] = self.OP.AND,
        ["or"] = self.OP.OR,
        ["=="] = self.OP.EQ,
        ["~="] = self.OP.NE,
        ["<"] = self.OP.LT,
        ["<="] = self.OP.LE,
        [">"] = self.OP.GT,
        [">="] = self.OP.GE,
        [".."] = self.OP.CONCAT,
    }
    return op_map[op]
end

return BytecodeGen
