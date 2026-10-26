// (the same as minecraft-bedrock-extractor's lib/molang.js)
// Molang, Bedrock's expression language, as far as render controllers and particle effects use it: numbers and
// strings; + - * / ! and unary -; comparisons, && || ?? and ?:; math.* functions; names (query.*, variable.*, temp.*,
// context.*, and their q. v. t. c. short forms, Geometry.*, Texture.*, Array.*), [index], ->; statements with ; and
// return; assignment to variable.* and temp.*. Names are case-insensitive. Loops and the other entity of -> are not
// evaluated (-> gives its right side as the entity's own).
//
// compile(source) -> fn(scope): scope.get(name) (a lowercase full name: 'query.is_baby') gives a name's value, 0 when
// it has none; scope.set(name, value) keeps an assignment.

const ALIASES = { q: 'query', v: 'variable', t: 'temp', c: 'context' }

const MATH = {
  abs: Math.abs,
  acos: x => Math.acos(x) * 180 / Math.PI,
  asin: x => Math.asin(x) * 180 / Math.PI,
  atan: x => Math.atan(x) * 180 / Math.PI,
  atan2: (y, x) => Math.atan2(y, x) * 180 / Math.PI,
  ceil: Math.ceil,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  cos: x => Math.cos(x * Math.PI / 180),
  sin: x => Math.sin(x * Math.PI / 180),
  die_roll: (n, lo, hi) => { let s = 0; for (let i = 0; i < n; i++) s += lo + Math.random() * (hi - lo); return s },
  die_roll_integer: (n, lo, hi) => { let s = 0; for (let i = 0; i < n; i++) s += Math.floor(lo + Math.random() * (hi - lo + 1)); return s },
  exp: Math.exp,
  floor: Math.floor,
  hermite_blend: t => 3 * t * t - 2 * t * t * t,
  lerp: (a, b, t) => a + (b - a) * t,
  lerprotate: (a, b, t) => { const d = ((((b - a) % 360) + 540) % 360) - 180; return a + d * t },
  ln: Math.log,
  max: Math.max,
  min: Math.min,
  min_angle: a => ((((a + 180) % 360) + 360) % 360) - 180,
  mod: (a, b) => a % b,
  pow: Math.pow,
  random: (lo, hi) => lo + Math.random() * (hi - lo),
  random_integer: (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1)),
  round: Math.round,
  sqrt: Math.sqrt,
  trunc: Math.trunc,
  pi: () => Math.PI
}

function tokenize (src) {
  const tokens = []
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?f?|\.\d+f?)|('[^']*')|([A-Za-z_][\w.]*)|(->|&&|\|\||\?\?|==|!=|<=|>=|[-+*/!<>?:()[\]{};,=]))/gy
  let m
  re.lastIndex = 0
  while (re.lastIndex < src.length) {
    const at = re.lastIndex
    if (/^\s*$/.test(src.slice(at))) break
    m = re.exec(src)
    if (!m) throw new Error(`molang: cannot read ${JSON.stringify(src.slice(at, at + 20))}`)
    if (m[1] !== undefined) tokens.push({ num: parseFloat(m[1]) })
    else if (m[2] !== undefined) tokens.push({ str: m[2].slice(1, -1) })
    else if (m[3] !== undefined) tokens.push({ name: m[3] })
    else tokens.push({ op: m[4] })
  }
  return tokens
}

function fullName (name) {
  const lower = name.toLowerCase()
  const dot = lower.indexOf('.')
  if (dot < 0) return lower
  const head = lower.slice(0, dot)
  return (ALIASES[head] ?? head) + lower.slice(dot)
}

const truthy = v => typeof v === 'string' ? v.length > 0 : !!v
const num = v => typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0

function parse (tokens) {
  let i = 0
  const peek = () => tokens[i]
  const isOp = (op, t = tokens[i]) => t && t.op === op
  const expect = op => { if (!isOp(op)) throw new Error(`molang: expected ${op}`); i++ }

  function primary () {
    const t = tokens[i++]
    if (!t) throw new Error('molang: unexpected end')
    if (t.num !== undefined) return () => t.num
    if (t.str !== undefined) return () => t.str
    if (t.op === '(') { const e = expression(); expect(')'); return e }
    if (t.op === '{') {
      // a block of statements (a loop's body): skipped
      let depth = 1
      while (depth && i < tokens.length) { if (isOp('{')) depth++; else if (isOp('}')) depth--; i++ }
      return () => 0
    }
    if (t.op === '-') { const e = unary(); return s => -num(e(s)) }
    if (t.name !== undefined) {
      const name = fullName(t.name)
      if (isOp('(')) {
        i++
        const args = []
        while (!isOp(')')) { args.push(expression()); if (isOp(',')) i++ }
        expect(')')
        const fn = name.startsWith('math.') ? MATH[name.slice(5)] : null
        if (!fn) return () => 0
        return s => fn(...args.map(a => num(a(s))))
      }
      if (name === 'math.pi') return () => Math.PI
      if (name === 'return' || name === 'loop' || name === 'for_each') return () => 0
      return s => s.get(name) ?? 0
    }
    throw new Error(`molang: unexpected ${JSON.stringify(t)}`)
  }

  function postfix () {
    let e = primary()
    for (;;) {
      if (isOp('[')) {
        i++
        const index = expression()
        expect(']')
        const base = e
        e = s => {
          const list = base(s)
          if (!Array.isArray(list) || !list.length) return 0
          const n = Math.max(0, Math.floor(num(index(s))))
          return list[Math.min(n, list.length - 1)]
        }
      } else if (isOp('->')) {
        i++
        e = postfix()
      } else return e
    }
  }

  function unary () {
    if (isOp('!')) { i++; const e = unary(); return s => truthy(e(s)) ? 0 : 1 }
    if (isOp('-')) { i++; const e = unary(); return s => -num(e(s)) }
    return postfix()
  }

  const binary = (next, ops) => () => {
    let left = next()
    for (;;) {
      const t = peek()
      if (!t || !ops[t.op]) return left
      i++
      const right = next()
      const fn = ops[t.op]
      const l = left
      left = s => fn(l(s), right(s))
    }
  }
  const mul = binary(unary, { '*': (a, b) => num(a) * num(b), '/': (a, b) => num(a) / num(b) })
  const add = binary(mul, { '+': (a, b) => num(a) + num(b), '-': (a, b) => num(a) - num(b) })
  const rel = binary(add, { '<': (a, b) => +(num(a) < num(b)), '>': (a, b) => +(num(a) > num(b)), '<=': (a, b) => +(num(a) <= num(b)), '>=': (a, b) => +(num(a) >= num(b)) })
  const same = (a, b) => a === b || (typeof a !== 'string' && typeof b !== 'string' && num(a) === num(b))
  const eq = binary(rel, { '==': (a, b) => +same(a, b), '!=': (a, b) => +!same(a, b) })
  const and = () => {
    let left = eq()
    while (isOp('&&')) { i++; const l = left; const r = eq(); left = s => +(truthy(l(s)) && truthy(r(s))) }
    return left
  }
  const or = () => {
    let left = and()
    while (isOp('||')) { i++; const l = left; const r = and(); left = s => +(truthy(l(s)) || truthy(r(s))) }
    return left
  }
  const coalesce = () => {
    let left = or()
    while (isOp('??')) { i++; const l = left; const r = or(); left = s => { const v = l(s); return v === undefined || v === null ? r(s) : v } }
    return left
  }
  function expression () {
    const cond = coalesce()
    if (!isOp('?')) return cond
    i++
    const yes = expression()
    if (!isOp(':')) return s => truthy(cond(s)) ? yes(s) : 0
    i++
    const no = expression()
    return s => truthy(cond(s)) ? yes(s) : no(s)
  }

  // statements: name = expression; return expression; expression
  function statement () {
    const t = peek()
    if (t?.name && t.name.toLowerCase() === 'return') { i++; const e = expression(); return { ret: e } }
    if (t?.name && isOp('=', tokens[i + 1])) {
      const name = fullName(t.name)
      i += 2
      const e = expression()
      return { run: s => s.set?.(name, e(s)) }
    }
    return { value: expression() }
  }

  const statements = []
  while (i < tokens.length) {
    if (isOp(';')) { i++; continue }
    statements.push(statement())
  }
  if (statements.length === 1 && statements[0].value) return statements[0].value
  return s => {
    for (const st of statements) {
      if (st.ret) return st.ret(s)
      if (st.run) st.run(s)
    }
    return 0
  }
}

const cache = new Map()

// a Molang expression (or a number) as a function of a scope
function compile (source) {
  if (typeof source === 'number') return () => source
  if (typeof source === 'boolean') return () => +source
  if (typeof source !== 'string') return () => 0
  if (!cache.has(source)) {
    let fn
    try { fn = parse(tokenize(source)) } catch { fn = () => 0 }
    cache.set(source, fn)
  }
  return cache.get(source)
}

module.exports = { compile, fullName }
