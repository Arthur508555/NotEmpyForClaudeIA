const crypto = require("crypto");

function q(s) {
  return JSON.stringify(s);
}

function hiddenChars(text) {
  return text.split("").map(c => c.charCodeAt(0)).join(",");
}

function arr(values) {
  return "{" + values.join(",") + "}";
}

function chunkLiteral(text) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const size = 53 + crypto.randomBytes(1)[0] % 67;
    const chunk = text.slice(i, i + size);
    let sum = 0;
    for (let j = 0; j < chunk.length; j++) sum = (sum + chunk.charCodeAt(j) * ((j % 31) + 1)) % 65535;
    chunks.push("{" + [q(chunk), chunk.length, sum].join(",") + "}");
    i += size;
  }
  return "{" + chunks.join(",") + "}";
}

function opcodeBlob() {
  const values = [11, 17, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71];
  const key = crypto.randomBytes(1)[0] || 149;
  const salt = crypto.randomBytes(1)[0] || 83;
  const data = values.map((value, index) => ((value ^ key) + salt + (index + 1) * 7) & 0xff);
  const seal = data.reduce((sum, value, index) => (sum + value * (index + 11)) % 65535, 0);
  return { key, salt, data, seal };
}

function minifyLua(src) {
  let out = "";
  let i = 0;
  let lastSpace = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let s = ch;
      i++;
      while (i < src.length) {
        const c = src[i];
        s += c;
        i++;
        if (c === "\\") {
          if (i < src.length) s += src[i++];
        } else if (c === quote) break;
      }
      out += s;
      lastSpace = false;
      continue;
    }
    if (/\s/.test(ch)) {
      const a = out[out.length - 1] || "";
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      const b = src[j] || "";
      if (/[A-Za-z0-9_]/.test(a) && /[A-Za-z0-9_]/.test(b) && !lastSpace) {
        out += " ";
        lastSpace = true;
      }
      i = j;
      continue;
    }
    if ("=+-*/%^#<>{}[]();,:".includes(ch)) {
      if (out.endsWith(" ")) out = out.slice(0, -1);
      out += ch;
      lastSpace = false;
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      continue;
    }
    out += ch;
    lastSpace = false;
    i++;
  }
  return out.trim();
}

const LUA_RESERVED = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while"
]);

function randomLuaName(used) {
  const alphabet = "IiIlL10O";
  while (true) {
    const bytes = crypto.randomBytes(7);
    let out = bytes[0] % 2 ? "_" : "I";
    for (const b of bytes) out += alphabet[b % alphabet.length];
    if (!used.has(out) && !LUA_RESERVED.has(out)) {
      used.add(out);
      return out;
    }
  }
}

function obfuscateLuaIdentifiers(src) {
  const ids = [
    "ENV", "LIBS", "DEBUG", "DBG", "FAIL", "K", "BX", "KEY", "CHECKP", "A", "AL", "B85", "INF", "BIN", "OPC",
    "SAFEENV", "WATCH", "DENY", "SNAP", "SNAPENV", "INTEGRITY", "OP", "CLEAN", "VM", "WIPE",
    "DEC", "READ", "CONSTV", "WATCHDOG", "BOOT", "P", "PUSH", "POP", "NIL", "VMSEED",
    "DECOYVM", "FAKEDC", "FAKESEAL", "TAG", "BOX", "UNBOX", "RSET", "RGET", "ROLL",
    "PEEK", "RGETF", "READC", "PERMUTE", "HAND", "HM", "SLOT", "BGET", "SEG", "PROBE",
    "MAYBE", "TRACESEAL", "MIXOP", "WINDOW", "NBRIDGE", "MICRO", "MON", "KILL",
    "CTX", "WRAP", "SHADOW", "PHANTOM", "nativeToken", "nativeSig", "poisonSalt",
    "rawcode", "seg", "zz", "frag",
    "env", "const", "fns", "key", "salt", "root", "poisoned", "truth", "sx", "op", "run",
    "blocked", "G", "closure", "regs", "st", "ticks", "argc", "base", "avs", "mark", "last", "decoded",
    "program", "opKey", "opSalt", "constants", "functions", "code", "mir", "rmask", "flux", "ic",
    "ret", "fn", "ins", "fake", "seal", "budget", "again", "ctx", "nonce"
  ];
  const used = new Set(ids);
  const map = new Map(ids.map(id => [id, randomLuaName(used)]));
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let s = ch;
      i++;
      while (i < src.length) {
        const c = src[i++];
        s += c;
        if (c === "\\") {
          if (i < src.length) s += src[i++];
        } else if (c === quote) {
          break;
        }
      }
      out += s;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (/[A-Za-z0-9_]/.test(src[j] || "")) j++;
      const id = src.slice(i, j);
      out += map.get(id) || id;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function buildRuntime(serializedProgram, options = {}, keySystem) {
  const debugEnabled = options.debug ? "true" : "false";
  const errorSalt = crypto.randomBytes(3).toString("hex").toUpperCase();
  const programChecksum = Buffer.from(serializedProgram, "utf8").reduce((a, b, i) => (a + b * ((i % 251) + 1)) % 65535, 0);
  const programSize = Buffer.byteLength(serializedProgram, "utf8");
  const key = keySystem || { encoded: [1], layers: [[2], [3], [4]], checksum: 4, size: 1 };
  const programLiteral = chunkLiteral(serializedProgram);
  const opBlob = opcodeBlob();
  const bootName = randomLuaName(new Set(LUA_RESERVED));
  const vmSeed = crypto.randomBytes(2).readUInt16BE(0) || 4099;
  const fakeSeal = crypto.randomBytes(2).readUInt16BE(0) || 27191;

  // Runtime hardening notes:
  // - The binary parser fragments encrypted function code before VM execution, so fetch reads a small byte window
  //   instead of exposing a linear code string to simple dumpers.
  // - The VM creates one contextual handler closure per instruction and drops it immediately, reducing closure
  //   snapshot value and making opcode->handler reconstruction depend on rolling VM state.
  // - Constants are still serialized by the existing pipeline, but runtime reconstruction happens in short windows
  //   with contextual noise and aggressive table wiping to limit hookable intermediate buffers.
  const runtime = `
local ${bootName}=function()
local ENV=(getfenv and getfenv(1)) or _ENV or _G
local LIBS={
byte=string.byte,char=string.char,sub=string.sub,concat=table.concat,insert=table.insert,
unpack=unpack or table.unpack,tonumber=tonumber,tostring=tostring,floor=math.floor,
pack=table.pack or function(...) return {n=select("#",...),...} end,pcall=pcall,xpcall=xpcall,
error=error,type=type,setmetatable=setmetatable,getmetatable=getmetatable,select=select,
rawset=rawset,rawget=rawget,print=print,clock=os and os.clock,gc=collectgarbage,
rawequal=rawequal,pairs=pairs,ipairs=ipairs,next=next
}
local VMSEED=${vmSeed}
local DEBUG=${debugEnabled}
local DBG={on=DEBUG,log={}}
local function D(x) if DBG.on then DBG.log[#DBG.log+1]=LIBS.tostring(x) end end
local function FAIL(id)
if LIBS.print then LIBS.print("Execution failed, please check what you ran in your previous executor, try again later...\\nError ID: "..id.."\\nBy wRyObf.") end
return nil
end
local function K(...)
local t=LIBS.pack(...)
local r={}
for i=1,t.n do r[i]=LIBS.char(t[i]) end
return LIBS.concat(r)
end
local function BX(a,b)
local r=0
local p=1
while a>0 or b>0 do
local aa=a%2
local bb=b%2
if aa~=bb then r=r+p end
a=LIBS.floor(a/2)
b=LIBS.floor(b/2)
p=p*2
end
return r%256
end
local function KEY()
local data=${arr(key.encoded)}
local k1=${arr(key.layers[0])}
local k2=${arr(key.layers[1])}
local k3=${arr(key.layers[2])}
local sum=0
if #data~=${key.size} then return false end
for i=1,#data do
local v=BX(data[i],k3[i])
v=(v-k2[i])%256
v=BX(v,k1[i])
sum=(sum+v*(i+16))%65535
end
return sum==${key.checksum}
end
local function CHECKP(s)
if LIBS.type(s)~="string" and LIBS.type(s)~="table" then return false end
local sum=0
local n=0
if LIBS.type(s)=="string" then
for i=1,#s do n=n+1;sum=(sum+LIBS.byte(s,i)*(((n-1)%251)+1))%65535 end
else
for c=1,#s do
local chunk=s[c]
if LIBS.type(chunk)=="table" then
local data=chunk[1]
if LIBS.type(data)~="string" or #data~=chunk[2] then return false end
local csum=0
for i=1,#data do csum=(csum+LIBS.byte(data,i)*(((i-1)%31)+1))%65535 end
if csum~=chunk[3] then return false end
chunk=data
end
if LIBS.type(chunk)~="string" then return false end
for i=1,#chunk do n=n+1;sum=(sum+LIBS.byte(chunk,i)*(((n-1)%251)+1))%65535 end
end
end
if n~=${programSize} then return false end
return sum==${programChecksum}
end
local function A()
local b={}
for i=33,117 do LIBS.insert(b,LIBS.char(i)) end
return LIBS.concat(b)
end
local AL=A()
local function B85(s)
if LIBS.type(s)~="string" and LIBS.type(s)~="table" then LIBS.error("E85",0) end
local out={}
local total=0
if LIBS.type(s)=="string" then total=#s else for i=1,#s do local chunk=s[i];if LIBS.type(chunk)=="table" then chunk=chunk[1] end;total=total+#chunk end end
if total>4000000 then LIBS.error("E87",0) end
local p=1
local ci=1
local cp=1
local function nx()
if LIBS.type(s)=="string" then local ch=LIBS.sub(s,p,p);p=p+1;return ch end
while ci<=#s do local chunk=s[ci];if LIBS.type(chunk)=="table" then chunk=chunk[1] end;if cp<=#chunk then break end;ci=ci+1;cp=1 end
if ci>#s then return "" end
local chunk=s[ci]
if LIBS.type(chunk)=="table" then chunk=chunk[1] end
local ch=LIBS.sub(chunk,cp,cp)
cp=cp+1
p=p+1
return ch
end
while p<=total do
local keep=total-p+1
if keep>5 then keep=5 end
local v=0
for i=1,5 do
local ch=i<=keep and nx() or ""
local n=84
if ch~="" then
local found=false
for j=1,#AL do if LIBS.sub(AL,j,j)==ch then n=j-1 found=true break end end
if not found then LIBS.error("E86",0) end
end
v=v*85+n
end
local a=LIBS.floor(v/16777216)%256
local b=LIBS.floor(v/65536)%256
local d=LIBS.floor(v/256)%256
local e=v%256
keep=keep-1
if keep>=1 then LIBS.insert(out,LIBS.char(a)) end
if keep>=2 then LIBS.insert(out,LIBS.char(b)) end
if keep>=3 then LIBS.insert(out,LIBS.char(d)) end
if keep>=4 then LIBS.insert(out,LIBS.char(e)) end
end
return LIBS.concat(out)
end
local function INF(s)
if LIBS.type(s)~="string" or #s<16 then LIBS.error("E70",0) end
local lim=#s-2
local want=LIBS.byte(s,#s-1)*256+LIBS.byte(s,#s)
local got=0
for z=1,lim do got=(got+LIBS.byte(s,z)*(((z-1)%199)+3))%65535 end
if got~=want then LIBS.error("E71",0) end
local p=1
local function u8()
if p>lim then LIBS.error("E72",0) end
local b=LIBS.byte(s,p)
p=p+1
return b
end
local function u16()
local a,b=u8(),u8()
return a*256+b
end
local function u32()
local a,b,c,d=u8(),u8(),u8(),u8()
return ((a*256+b)*256+c)*256+d
end
if u8()~=79 or u8()~=67 or u8()~=3 or u8()~=1 then LIBS.error("E73",0) end
local rawLen=u32()
local rawSum=u16()
local packedLen=u32()
if packedLen<0 or p+packedLen-1>lim or rawLen>5000000 then LIBS.error("E74",0) end
local stop=p+packedLen
local out={}
while p<stop do
local tag=u8()
if tag>=128 then
local len=(tag%128)+3
local dist=u16()
local start=#out-dist+1
if dist<1 or start<1 then LIBS.error("E75",0) end
for n=0,len-1 do
local v=out[start+n]
if v==nil then LIBS.error("E76",0) end
out[#out+1]=v
if #out>rawLen or #out>5000000 then LIBS.error("E77",0) end
end
else
if p+tag-1>stop then LIBS.error("E78",0) end
for _=1,tag do out[#out+1]=u8() end
end
end
if p~=stop or #out~=rawLen then LIBS.error("E79",0) end
local sum=0
local chars={}
for i=1,#out do
sum=(sum+out[i]*(((i-1)%251)+1))%65535
chars[i]=LIBS.char(out[i])
out[i]=nil
end
if sum~=rawSum then LIBS.error("E80",0) end
local r=LIBS.concat(chars)
for i=1,#chars do chars[i]=nil end
return r
end
local function BIN(s)
local p=1
if #s<9 then LIBS.error("E58",0) end
local lim=#s-2
local want=LIBS.byte(s,#s-1)*256+LIBS.byte(s,#s)
local got=0
for z=1,lim do got=(got+LIBS.byte(s,z)*(((z-1)%251)+1))%65535 end
if got~=want then LIBS.error("E59",0) end
local function u8()
if p>lim then LIBS.error("E60",0) end
local b=LIBS.byte(s,p)
if not b then LIBS.error("E60",0) end
p=p+1
return b
end
local function u16()
local a,b=u8(),u8()
return a*256+b
end
local function u32()
local a,b,c,d=u8(),u8(),u8(),u8()
return ((a*256+b)*256+c)*256+d
end
local function take(n)
if n<0 or p+n-1>lim then LIBS.error("E61",0) end
local r=LIBS.sub(s,p,p+n-1)
p=p+n
return r
end
local h1,h2,h3=u8(),u8(),u8()
local ok,os,rt=u8(),u8(),u8()
local hc=u8()
if (h1*3+h2*5+h3*7+ok*11+os*13+rt*17)%256~=hc then LIBS.error("E62",0) end
local P={opKey=ok,opSalt=os,root=rt,constants={},functions={}}
local cc=u16()
if cc>65535 then LIBS.error("E63",0) end
for i=1,cc do
local t,k,l=u8(),u8(),u32()
if l>2000000 then LIBS.error("E64",0) end
P.constants[i]={t=t,k=k,b=take(l)}
end
local fc=u16()
if fc>4096 then LIBS.error("E65",0) end
for i=1,fc do
local params=u16()
local locals=u16()
local count=u32()
local k=u8()
local m=u8()
if count>200000 then LIBS.error("E66",0) end
local rawcode=take(count*15)
local seg={}
local zz=((P.root+k+m+i*11)%29)+37
local pp=1
while pp<=#rawcode do
local frag=LIBS.sub(rawcode,pp,pp+zz-1)
seg[#seg+1]=frag
pp=pp+#frag
zz=((zz*5+#frag+k+m)%41)+29
end
rawcode=nil
P.functions[i]={p=params,l=locals,n=count,k=k,m=m,x=(P.root+(i-1)*7)%256,seg=seg,z=((P.root+k+m+i)%29)+37}
end
if p~=lim+1 then LIBS.error("E68",0) end
return P
end
local function SAFEENV()
local e={}
local allow={
{${hiddenChars("assert")}}, {${hiddenChars("error")}}, {${hiddenChars("ipairs")}}, {${hiddenChars("next")}},
{${hiddenChars("pairs")}}, {${hiddenChars("pcall")}}, {${hiddenChars("print")}}, {${hiddenChars("select")}},
{${hiddenChars("tonumber")}}, {${hiddenChars("tostring")}}, {${hiddenChars("type")}}, {${hiddenChars("typeof")}},
{${hiddenChars("unpack")}}, {${hiddenChars("warn")}}, {${hiddenChars("xpcall")}},
{${hiddenChars("string")}}, {${hiddenChars("table")}}, {${hiddenChars("math")}}, {${hiddenChars("coroutine")}},
{${hiddenChars("utf8")}}, {${hiddenChars("bit32")}}, {${hiddenChars("bit")}}, {${hiddenChars("task")}},
{${hiddenChars("game")}}, {${hiddenChars("workspace")}}, {${hiddenChars("script")}}, {${hiddenChars("shared")}},
{${hiddenChars("Vector2")}}, {${hiddenChars("Vector3")}}, {${hiddenChars("CFrame")}}, {${hiddenChars("Color3")}},
{${hiddenChars("ColorSequence")}}, {${hiddenChars("NumberSequence")}}, {${hiddenChars("UDim")}}, {${hiddenChars("UDim2")}},
{${hiddenChars("Enum")}}, {${hiddenChars("Instance")}}, {${hiddenChars("Ray")}}, {${hiddenChars("Rect")}}, {${hiddenChars("TweenInfo")}}
}
for i=1,#allow do local key=K(LIBS.unpack(allow[i]));local v=ENV and ENV[key] or nil;if v~=nil then e[key]=v end end
e[K(${hiddenChars("_G")})]=e
e[K(${hiddenChars("_ENV")})]=e
return LIBS.setmetatable(e,{__index=function() return nil end,__newindex=function(t,k,v) LIBS.rawset(t,k,v) end,__metatable=false})
end
local WATCH={
{${hiddenChars("load")}}, {${hiddenChars("loadstring")}}, {${hiddenChars("pcall")}}, {${hiddenChars("xpcall")}},
{${hiddenChars("tostring")}}, {${hiddenChars("type")}}, {${hiddenChars("pairs")}}, {${hiddenChars("ipairs")}},
{${hiddenChars("table")}}, {${hiddenChars("string")}}, {${hiddenChars("math")}}, {${hiddenChars("coroutine")}}
}
local DENY={
{${hiddenChars("hookfunction")}}, {${hiddenChars("replaceclosure")}}, {${hiddenChars("newcclosure")}},
{${hiddenChars("old_load")}}, {${hiddenChars("old_loadstring")}}, {${hiddenChars("hookmetamethod")}},
{${hiddenChars("getgc")}}, {${hiddenChars("getreg")}}, {${hiddenChars("getrenv")}}, {${hiddenChars("getrawmetatable")}},
{${hiddenChars("setreadonly")}}, {${hiddenChars("islclosure")}}, {${hiddenChars("iscclosure")}},
{${hiddenChars("debug.getinfo")}}, {${hiddenChars("debug.sethook")}}
}
local SNAP={}
local function SNAPENV()
for i=1,#WATCH do
local n=K(LIBS.unpack(WATCH[i]))
local v=ENV and ENV[n] or nil
SNAP[n]={v=v,t=LIBS.type(v),s=LIBS.tostring(v)}
end
end
SNAPENV()
local function INTEGRITY(env)
local mt=LIBS.getmetatable(env)
if mt~=false then return false end
for i=1,#DENY do
local n=K(LIBS.unpack(DENY[i]))
if ENV and ENV[n]~=nil then return false end
end
for name,rec in LIBS.pairs(SNAP) do
local cur=ENV and ENV[name] or nil
if rec.v~=nil and (cur~=rec.v or not LIBS.rawequal(cur,rec.v)) then return false end
if cur~=nil and LIBS.type(cur)~=rec.t then return false end
if cur~=nil and (rec.t=="function" or rec.t=="table") and LIBS.tostring(cur)~=rec.s then return false end
end
local st=ENV and ENV[K(${hiddenChars("string")})] or nil
if LIBS.type(st)=="table" then if LIBS.getmetatable(st)~=nil then return false end;if st.byte and not LIBS.rawequal(st.byte,LIBS.byte) then return false end;if st.char and not LIBS.rawequal(st.char,LIBS.char) then return false end;if st.sub and not LIBS.rawequal(st.sub,LIBS.sub) then return false end end
local tt=ENV and ENV[K(${hiddenChars("table")})] or nil
if LIBS.type(tt)=="table" then if LIBS.getmetatable(tt)~=nil then return false end;if tt.concat and not LIBS.rawequal(tt.concat,LIBS.concat) then return false end;if tt.insert and not LIBS.rawequal(tt.insert,LIBS.insert) then return false end end
local mtb=ENV and ENV[K(${hiddenChars("math")})] or nil
if LIBS.type(mtb)=="table" then if LIBS.getmetatable(mtb)~=nil then return false end;if mtb.floor and not LIBS.rawequal(mtb.floor,LIBS.floor) then return false end end
if LIBS.type({})~="table" or LIBS.type(function() end)~="function" then return false end
if LIBS.getmetatable(LIBS.pcall)~=nil or LIBS.getmetatable(LIBS.type)~=nil or LIBS.getmetatable(LIBS.tostring)~=nil then return false end
if not LIBS.rawequal(LIBS.rawequal,LIBS.rawequal) or LIBS.rawequal(function() end,function() end) then return false end
if LIBS.tostring(123)~="123" then return false end
local ok,res=LIBS.pcall(function() return 77 end)
if not ok or res~=77 then return false end
local ok2=LIBS.pcall(function() LIBS.error("v",0) end)
if ok2 then return false end
if LIBS.xpcall then
local xok,xr=LIBS.xpcall(function() LIBS.error("x",0) end,function() return "h" end)
if xok or xr~="h" then return false end
end
local c=0
for _,v in LIBS.pairs({a=1}) do c=c+v end
if c~=1 then return false end
local ic=0
for _,v in LIBS.ipairs({2,3}) do ic=ic+v end
if ic~=5 then return false end
if LIBS.byte("A")~=65 or LIBS.concat({"a","b"},"")~="ab" or LIBS.floor(1.9)~=1 then return false end
local fp=0
local pok,perr=LIBS.pcall(function() LIBS.error("q",0) end)
if pok or perr~="q" then return false end
local tok,tv=LIBS.pcall(function() return LIBS.tostring(LIBS.pcall),LIBS.tostring(LIBS.rawequal) end)
if not tok or LIBS.type(tv)~="string" or #tv<6 then return false end
local r1,r2={},{}
if not LIBS.rawequal(r1,r1) or LIBS.rawequal(r1,r2) then return false end
local pm=LIBS.setmetatable({},{__index=function() fp=fp+3 return 12 end,__newindex=function() fp=fp+5 end,__metatable=false})
if pm.x~=12 then return false end
pm.y=1
if fp~=8 or LIBS.getmetatable(pm)~=false then return false end
local ct=ENV and ENV[K(${hiddenChars("coroutine")})] or nil
local co=ct and ct.create and ct.create(function() return 9 end) or nil
if co and ct.resume then local cok,cv=ct.resume(co);if not cok or cv~=9 then return false end end
local dbg=ENV and ENV[K(${hiddenChars("debug")})] or nil
if LIBS.type(dbg)=="table" and dbg.gethook then
local hok,ha=LIBS.pcall(dbg.gethook)
if hok and ha~=nil then return false end
end
if LIBS.type(dbg)=="table" and dbg.traceback then
local bok,bt=LIBS.pcall(dbg.traceback,"z",1)
if bok and (LIBS.type(bt)~="string" or LIBS.sub(bt,1,1)~="z") then return false end
end
local t0=LIBS.clock and LIBS.clock() or 0
for _=1,192 do end
local t1=LIBS.clock and LIBS.clock() or t0
if t1<t0 or t1-t0>0.50 then return false end
return true
end
local function OPC()
local raw=${arr(opBlob.data)}
local seal=0
local t={}
for i=1,#raw do
seal=(seal+raw[i]*(i+10))%65535
t[i]=BX((raw[i]-${opBlob.salt}-i*7)%256,${opBlob.key})
raw[i]=nil
end
if seal~=${opBlob.seal} then LIBS.error("E92",0) end
return t
end
local OP=OPC()
local FAKESEAL=${fakeSeal}
local function DECOYVM(x)
local a={17,29,43,61,89,113}
local b={}
local s=FAKESEAL
for i=1,#a do b[i]=BX((a[i]+i*7)%256,(s+i*13)%256);s=(s+b[i]*i)%65535 end
if x==s then return b[3] end
for i=1,#b do b[i]=nil end
return nil
end
local function FAKEDC(x,k)
local z={}
for i=1,#x do z[i]=LIBS.char(BX(LIBS.byte(x,i),(k+i*19+FAKESEAL)%256)) end
for i=1,#z do z[i]=nil end
return (k+FAKESEAL)%257
end
local function NBRIDGE()
local np=ENV and ENV[K(${hiddenChars("newproxy")})] or nil
if LIBS.type(np)~="function" then return nil,0 end
local ok,u=LIBS.pcall(np,true)
if not ok or u==nil then return nil,0 end
local s=LIBS.tostring(u)
local sig=0
for i=1,#s do sig=(sig+LIBS.byte(s,i)*(i%17+1))%65535 end
return u,sig
end
local function CLEAN(t) if LIBS.type(t)=="table" then for k in LIBS.pairs(t) do t[k]=nil end end end
local function VM(P)
if not KEY() then if LIBS.print then LIBS.print("Error, key not found!") end return nil end
local env=SAFEENV()
if not INTEGRITY(env) then return nil end
local nativeToken,nativeSig=NBRIDGE()
local const=P.constants or {}
local fns=P.functions or {}
local key=P.opKey or 0
local salt=P.opSalt or 0
local root=P.root or 0
local poisoned=false
local poisonSalt=(VMSEED+root*17+key*31+salt*43)%65535
local function op(n) return BX((n-salt)%256,key) end
local function truth(v) return not (v==false or v==nil) end
local blocked={[K(${hiddenChars("load")})]=true,[K(${hiddenChars("loadstring")})]=true,[K(${hiddenChars("debug")})]=true,[K(${hiddenChars("hookfunction")})]=true,[K(${hiddenChars("replaceclosure")})]=true,[K(${hiddenChars("getgc")})]=true,[K(${hiddenChars("getreg")})]=true}
local function G(k)
if LIBS.type(k)~="string" or blocked[k] then return nil end
local v=env[k]
if LIBS.type(v)=="table" and LIBS.getmetatable(v)~=nil then return nil end
return v
end
local function sx(n) if n>=2147483648 then return n-4294967296 end return n end
local function WIPE()
poisoned=true
nativeToken=nil
for i=1,#const do const[i]=nil end
for i=1,#fns do if fns[i] then if fns[i].seg then CLEAN(fns[i].seg) end;fns[i].code="" end;fns[i]=nil end
end
local function DEC(b,k,pos,extra) return BX(b,(k+pos*13+extra)%256) end
local function U32(n) return n%4294967296 end
local function UNMASK(v,pc,m,slot,ctx)
local c=ctx or 0
local n=(c*37+pc*101+slot*211+m*17+poisonSalt)%65535
local r=BX(n%256,(c+slot*29)%256)
local p1=U32(v+n)
local p2=U32(p1-r)
local p3=U32(p2+r-n)
local d=U32(m*65537+pc*31337+slot*9173)
local g=(BX(p3%256,(c+pc+slot)%256)+n)%256
if BX((g-n)%256,(c+pc+slot)%256)~=(v%256) then WIPE() LIBS.error("E57",0) end
return U32(p3-d)
end
local function BGET(F,idx)
local seg=F.seg
if LIBS.type(seg)~="table" then LIBS.error("E43",0) end
local n=idx
for i=1,#seg do
local s=seg[i]
local l=#s
if n<=l then return LIBS.byte(s,n) end
n=n-l
end
LIBS.error("E43",0)
end
local function READ(F,pc,ctx)
if pc<1 or pc>(F.n or 0) then LIBS.error("E42",0) end
local p=(pc-1)*15+1
local function rb(o)
local b=BGET(F,p+o)
if not b then LIBS.error("E43",0) end
return DEC(b,F.k,p+o,F.x)
end
local rop=rb(0)*256+rb(1)
local chk=rb(2)
local ea=((rb(3)*256+rb(4))*256+rb(5))*256+rb(6)
local eb=((rb(7)*256+rb(8))*256+rb(9))*256+rb(10)
local ec=((rb(11)*256+rb(12))*256+rb(13))*256+rb(14)
if ((rop+ea+eb+ec+pc*17+(F.m or 0)*29)%256)~=chk then LIBS.error("E52",0) end
local ctxv=ctx or 0
local phantom=(BX(chk,(ctxv+pc)%256)+ctxv+poisonSalt)%256
if BX((phantom-ctxv-poisonSalt)%256,(ctxv+pc)%256)~=chk then WIPE() LIBS.error("E56",0) end
local a=sx(UNMASK(ea,pc,F.m or 0,1,ctxv))
local b=sx(UNMASK(eb,pc,F.m or 0,2,(ctxv+a)%65535))
local c=sx(UNMASK(ec,pc,F.m or 0,3,(ctxv+b)%65535))
return op(rop),a,b,c,chk
end
local function CONSTV(i,ctx,pcx)
local r=const[i+1]
if not r then LIBS.error("E45",0) end
if r.t==0 then return nil end
if r.t==1 then return false end
if r.t==2 then return true end
local out={}
local frag={}
local step=((ctx or 0)+(pcx or 0)+r.k+root)%9+5
local n=0
for p=1,#r.b do
local b=LIBS.byte(r.b,p)
local noise=((ctx or 0)+p*7+(pcx or 0))%256
b=BX(BX(b,noise),noise)
frag[#frag+1]=LIBS.char(BX(b,(r.k+p*31+r.t*17+root)%256))
if #frag>=step then n=n+1;out[n]=LIBS.concat(frag);CLEAN(frag);step=((step*3+n+r.k)%11)+4 end
end
if #frag>0 then n=n+1;out[n]=LIBS.concat(frag);CLEAN(frag) end
local s=LIBS.concat(out)
CLEAN(out)
if r.t==3 then return LIBS.tonumber(s) end
return s
end
local last=LIBS.clock and LIBS.clock() or 0
local function WATCHDOG(ticks)
if poisoned then return false end
if ticks%97~=13 then return true end
local now=LIBS.clock and LIBS.clock() or last
if now and last and now<last then WIPE() return false end
last=now or last
if not INTEGRITY(env) then WIPE() return false end
return true
end
local run
local function closure(id,up)
local mark=(id*131+root+key)%65535
return function(...)
if mark~=(id*131+root+key)%65535 or poisoned then return nil end
return run(id,up,LIBS.pack(...))
end
end
function run(id,up,args)
local F=fns[id+1]
if LIBS.type(F)~="table" then LIBS.error("E40",0) end
local regs={}
local mir={}
local st={}
local NIL={}
local rmask=(VMSEED+id*19+(F.k or 0)+(F.m or 0))%65535
local flux=(root+key+salt+id*11+(nativeSig or 0))%65535
local function TAG(i) return (rmask+i*97+flux*3)%65535 end
local function BOX(v,i)
local n=v==nil
local m=TAG(i or 0)
return {v=n and NIL or v,n=n,m=m,s=(m+(i or 0)*37+13)%65535}
end
local function UNBOX(b,i)
if LIBS.type(b)~="table" or b.s~=(b.m+(i or 0)*37+13)%65535 then WIPE() LIBS.error("E53",0) end
local v=b.v
if b.n or v==NIL then return nil end
return v
end
local function RSET(i,v)
regs[i]=BOX(v,i)
mir[i]=(TAG(i)+i*5)%65535
end
local function RGET(i)
local b=regs[i]
if b==nil then return nil end
if mir[i]~=(TAG(i)+i*5)%65535 then WIPE() LIBS.error("E54",0) end
return UNBOX(b,i)
end
local function KILL(code)
poisoned=true
flux=(flux+poisonSalt+(code or 0)*97)%65535
rmask=(rmask+flux+(code or 0)*13)%65535
for i=1,#st do st[i]=BOX((poisonSalt+i+code)%257,i) end
for i=1,#regs do regs[i]=BOX((flux+i*3)%257,i);mir[i]=(mir[i] or 0)+1 end
CLEAN(st)
CLEAN(regs)
CLEAN(mir)
WIPE()
return nil
end
local function ROLL(t)
if t%31~=7 then return end
flux=(flux+rmask+t)%65535
rmask=(rmask+flux+t*3)%65535
for i=1,#regs do
local v=regs[i] and UNBOX(regs[i],i) or nil
regs[i]=BOX(v,i)
mir[i]=(TAG(i)+i*5)%65535
end
end
local function PUSH(v) st[#st+1]=BOX(v,#st+1) end
local function PEEK(i) local b=st[i];if not b then return nil end;return UNBOX(b,i) end
local function POP() local i=#st;local v=PEEK(i);st[i]=nil;return v end
local function RGETF(fr,i) if fr and fr.get then return fr.get(i) end return nil end
for i=1,(F.l or 0) do RSET(i,nil) end
for i=1,(args and args.n or 0) do RSET(i,args[i]) end
if args then CLEAN(args) end
local pc=1
local ticks=0
local seal=(id*257+(F.n or 0)+root+(F.l or 0))%65535
local ic={}
local function CTX(at)
return (flux+rmask+ticks*19+seal+at*23+#st*5+#regs*7+poisonSalt)%65535
end
local function READC(at)
if ic[1] then CLEAN(ic) end
local ctx=CTX(at)
local o,a,b,c,k=READ(F,at,ctx)
ic[1]=o;ic[2]=a;ic[3]=b;ic[4]=c;ic[5]=k;ic[6]=(at*17+k+flux+ctx)%65535;ic[7]=ctx
return ic
end
local ret=nil
local HM={}
local hkey=(flux+rmask+seal+VMSEED)%256
local function MIXOP(i) return (BX(i,(hkey+i*23+root+id)%256)*257+i)%65535 end
for i=1,#OP do HM[OP[i]]=MIXOP(i) end
local function SLOT(o)
local v=HM[o]
if v==nil then return nil end
local pivot=(flux+rmask+pc+hkey)%#OP
for n=1,#OP do local i=((n+pivot-1)%#OP)+1;if MIXOP(i)==v then return i end end
return nil
end
local function MON(stage,t)
if poisoned then return false end
local s=(stage*113+t*17+flux+rmask+seal+poisonSalt)%65535
if s==FAKESEAL then return false end
if stage%3==1 and #st>4096 then return false end
if stage==19 and ic[1] and ic[7]~=CTX(pc) then return false end
if stage%7==3 and HM[OP[((t+stage)%#OP)+1]]==nil then return false end
if stage%11==4 and not INTEGRITY(env) then return false end
return true
end
local function WRAP(kind,nonce,body)
local gate=(nonce+kind*409+flux+rmask+seal)%65535
return function(ra,rb,rc)
local shadow={(ra or 0),(rb or 0),(rc or 0),gate}
local probe=(shadow[1]*3+shadow[2]*5+shadow[3]*7+shadow[4]+poisonSalt)%65535
if gate~=(nonce+kind*409+flux+rmask+seal)%65535 then CLEAN(shadow) return KILL(61) end
if probe==FAKESEAL then CLEAN(shadow) return KILL(62) end
if not MON(kind,nonce+ticks) then CLEAN(shadow) return KILL(63) end
local ok,a,b,c=LIBS.pcall(body,ra,rb,rc)
CLEAN(shadow)
if not ok then KILL(64) LIBS.error(a,0) end
return a,b,c
end
end
local function HAND(kind,nonce)
if kind==1 then return WRAP(kind,nonce,function(ra) PUSH(CONSTV(ra,nonce,pc)) end) end
if kind==2 then return WRAP(kind,nonce,function(ra) PUSH(G(CONSTV(ra,nonce,pc))) end) end
if kind==3 then return WRAP(kind,nonce,function(ra,rb)
if ra>0 then local fr=up;for _=2,ra do fr=fr and fr.up end;PUSH(RGETF(fr,rb+1)) else PUSH(RGET(rb+1)) end
end) end
if kind==4 then return WRAP(kind,nonce,function(ra) RSET(ra+1,POP()) end) end
if kind==5 then return WRAP(kind,nonce,function(ra) PUSH(closure(ra,{regs=regs,up=up,get=RGET,mask=rmask,seal=seal,flux=flux})) end) end
if kind==6 then return WRAP(kind,nonce,function(ra)
local argc=ra
local base=#st-argc
local fn=PEEK(base)
if LIBS.type(fn)~="function" then LIBS.error("E48",0) end
local avs={}
for n=1,argc do avs[n]=PEEK(base+n) end
for n=#st,base,-1 do st[n]=nil end
local r=LIBS.pack(fn(LIBS.unpack(avs,1,argc)))
CLEAN(avs)
PUSH(r[1])
CLEAN(r)
end) end
if kind==7 then return WRAP(kind,nonce,function(ra)
local n=ra or 0
local out={}
for i=1,n do out[i]=PEEK(#st-n+i) end
CLEAN(st)
CLEAN(regs)
CLEAN(mir)
ret={n=n,out=out}
end) end
if kind==8 then return WRAP(kind,nonce,function(ra) pc=ra-1 end) end
if kind==9 then return WRAP(kind,nonce,function(ra) local v=POP();if not truth(v) then pc=ra-1 end end) end
if kind==10 then return WRAP(kind,nonce,function(ra)
local bv=POP()
local av=POP()
local k=ra
if k==1 then PUSH(av+bv) elseif k==2 then PUSH(av-bv) elseif k==3 then PUSH(av*bv) elseif k==4 then PUSH(av/bv)
elseif k==5 then PUSH(av%bv) elseif k==6 then PUSH(av^bv) elseif k==7 then PUSH(LIBS.tostring(av)..LIBS.tostring(bv))
elseif k==8 then PUSH(av==bv) elseif k==9 then PUSH(av~=bv) elseif k==10 then PUSH(av<bv) elseif k==11 then PUSH(av<=bv)
elseif k==12 then PUSH(av>bv) elseif k==13 then PUSH(av>=bv) elseif k==14 then PUSH(truth(av) and bv or av) elseif k==15 then PUSH(truth(av) and av or bv)
else LIBS.error("E49",0) end
end) end
if kind==11 then return WRAP(kind,nonce,function(ra) local v=POP();if ra==1 then PUSH(-v) elseif ra==2 then PUSH(not truth(v)) elseif ra==3 then PUSH(#v) else LIBS.error("E50",0) end end) end
if kind==12 then return WRAP(kind,nonce,function(ra) local v=POP();PUSH(v and v[CONSTV(ra,nonce,pc)] or nil) end) end
if kind==13 then return WRAP(kind,nonce,function() st[#st]=nil end) end
if kind==14 then return WRAP(kind,nonce,function() CLEAN(st);CLEAN(regs);CLEAN(mir);WIPE();ret={n=0,out={}} end) end
return nil
end
local function PERMUTE(t)
if t%43~=19 then return end
hkey=(hkey+t+flux+rmask)%256
for i=1,#OP do HM[OP[i]]=MIXOP(i) end
FAKEDC("xx",hkey)
end
local function PROBE(t)
local q=(t*37+flux+rmask+pc*11)%257
if q%29==11 then
local t0=LIBS.clock and LIBS.clock() or 0
local s=0
for i=1,24 do s=(s+BX(i,(q+i*3)%256))%65535 end
local t1=LIBS.clock and LIBS.clock() or t0
if t1<t0 or t1-t0>0.35 then return false end
if s==FAKESEAL then return false end
end
if q%47==9 then
local ok=LIBS.pcall(function() return RGET(1) end)
if not ok then return false end
end
if q%83==5 and not INTEGRITY(env) then return false end
return true
end
local function STEP(budget)
while budget>0 do
ticks=ticks+1
if ticks>200000 then LIBS.error("E41",0) end
if #st>4096 then LIBS.error("E51",0) end
if ticks%89==23 and seal~=((id*257+(F.n or 0)+root+(F.l or 0))%65535) then return KILL(71) end
if ticks%53==17 then st[#st+1]=BOX(nil,#st+1);st[#st]=nil;DECOYVM(ticks) end
if not WATCHDOG(ticks) then return KILL(72) end
if not PROBE(ticks) then return KILL(73) end
ROLL(ticks)
PERMUTE(ticks)
if not MON(17,ticks) then return KILL(74) end
local ins=READC(pc)
if ins[6]~=(pc*17+ins[5]+flux+ins[7])%65535 then KILL(75) LIBS.error("E55",0) end
if not MON(19,ticks) then return KILL(77) end
local fn=HAND(SLOT(ins[1]),(ins[5]+ticks+flux+rmask)%65535)
if not fn then LIBS.error("E44",0) end
fn(ins[2],ins[3],ins[4])
fn=nil
if ret then local out=ret.out or {};local n=ret.n or 0;CLEAN(ic);return LIBS.unpack(out,1,n) end
if ticks%37==11 and not MON(23,ticks) then return KILL(76) end
pc=pc+1
budget=budget-1
end
return STEP(((flux+ticks+pc)%17)+7)
end
return STEP(((seal+id+root)%17)+9)
end
if DEBUG and LIBS.print then LIBS.print("trace ok") end
local ok,a,b,c=LIBS.pcall(run,0,nil,{n=0})
WIPE()
if not ok then if DEBUG and LIBS.print then LIBS.print(a) end;LIBS.error(a,0) end
return a,b,c
end
local function BOOT()
D("boot")
local p=${programLiteral}
if not CHECKP(p) then LIBS.error("E30",0) end
local decoded=INF(B85(p))
local program=BIN(decoded)
decoded=nil
p=nil
return VM(program)
end
local ok,a,b,c=LIBS.pcall(BOOT)
if not ok then if DEBUG and LIBS.print then LIBS.print(a) end;return FAIL("${errorSalt}") end
return a,b,c
end
return ${bootName}()
`;
  return obfuscateLuaIdentifiers(minifyLua(runtime));
}

module.exports = { buildRuntime, minifyLua };
