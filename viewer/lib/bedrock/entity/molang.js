// Molang, the expression language of Bedrock's entity resources (scripts, render controllers, animations), compiled
// to closures once per expression.
//
// An expression runs against a context:
//  - query (name, args): the entity's queries (query.is_baby, query.property('minecraft:climate_variant'))
//  - variables: the entity's variables (variable.x / v.x), kept across frames; a dotted name is one variable
//    (variable.TropicalFish.Base)
//  - context: the variables the caller provides (context.x / c.x)
//  - resource (namespace, name): Array.x, Geometry.x, Texture.x, Material.x of a render controller
//  - self: `this`, the value of the channel an animation is about to change
// temp.x / t.x live for one run. Names are case-insensitive, strings are not. Statements end with ';' and a
// multi-statement expression gives what `return` gives (0 without one); a single expression gives its value.
// What is not known (an unset variable, a query the context lacks) is 0, or null for `??`.

const MATH = {
  abs: Math.abs,
  acos: x => Math.acos(x) * 180 / Math.PI,
  asin: x => Math.asin(x) * 180 / Math.PI,
  atan: x => Math.atan(x) * 180 / Math.PI,
  atan2: (y, x) => Math.atan2(y, x) * 180 / Math.PI,
  ceil: Math.ceil,
  clamp: (v, min, max) => Math.min(Math.max(v, min), max),
  cos: x => Math.cos(x * Math.PI / 180),
  sin: x => Math.sin(x * Math.PI / 180),
  die_roll: (n, low, high) => { let s = 0; for (let i = 0; i < n; i++) s += low + Math.random() * (high - low); return s },
  die_roll_integer: (n, low, high) => { let s = 0; for (let i = 0; i < n; i++) s += Math.floor(low + Math.random() * (high - low + 1)); return s },
  exp: Math.exp,
  floor: Math.floor,
  hermite_blend: t => 3 * t * t - 2 * t * t * t,
  inverse_lerp: (a, b, v) => a === b ? 0 : (v - a) / (b - a),
  lerp: (a, b, t) => a + (b - a) * t,
  lerprotate: (a, b, t) => {
    const wrap = x => ((x + 180) % 360 + 360) % 360 - 180
    return a + wrap(b - a) * t
  },
  ln: Math.log,
  max: Math.max,
  min: Math.min,
  min_angle: x => ((x + 180) % 360 + 360) % 360 - 180,
  mod: (a, b) => b === 0 ? 0 : a % b,
  pi: () => Math.PI,
  pow: Math.pow,
  random: (low, high) => low + Math.random() * (high - low),
  random_integer: (low, high) => Math.floor(low + Math.random() * (high - low + 1)),
  round: Math.round,
  sign: Math.sign,
  sqrt: Math.sqrt,
  trunc: Math.trunc,
  copy_sign: (a, b) => Math.sign(b) * Math.abs(a)
}

// math.ease_<name>(start, end, t)
const EASES = {
  in_quad: t => t * t,
  out_quad: t => 1 - (1 - t) * (1 - t),
  in_out_quad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  in_cubic: t => t * t * t,
  out_cubic: t => 1 - Math.pow(1 - t, 3),
  in_out_cubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  in_quart: t => t ** 4,
  out_quart: t => 1 - Math.pow(1 - t, 4),
  in_out_quart: t => t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2,
  in_quint: t => t ** 5,
  out_quint: t => 1 - Math.pow(1 - t, 5),
  in_out_quint: t => t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2,
  in_sine: t => 1 - Math.cos(t * Math.PI / 2),
  out_sine: t => Math.sin(t * Math.PI / 2),
  in_out_sine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  in_expo: t => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
  out_expo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  in_out_expo: t => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  in_circ: t => 1 - Math.sqrt(1 - t * t),
  out_circ: t => Math.sqrt(1 - Math.pow(t - 1, 2)),
  in_out_circ: t => t < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  in_back: t => 2.70158 * t ** 3 - 1.70158 * t * t,
  out_back: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  in_out_back: t => {
    const c2 = 1.70158 * 1.525
    return t < 0.5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
  },
  in_elastic: t => t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI) / 3),
  out_elastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
  in_out_elastic: t => {
    const c5 = (2 * Math.PI) / 4.5
    if (t === 0 || t === 1) return t
    return t < 0.5 ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2 : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1
  },
  out_bounce: t => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  }
}
EASES.in_bounce = t => 1 - EASES.out_bounce(1 - t)
EASES.in_out_bounce = t => t < 0.5 ? (1 - EASES.out_bounce(1 - 2 * t)) / 2 : (1 + EASES.out_bounce(2 * t - 1)) / 2
for (const [name, f] of Object.entries(EASES)) MATH['ease_' + name] = (a, b, t) => a + (b - a) * f(t)

const NAMESPACES = { q: 'query', query: 'query', v: 'variable', variable: 'variable', t: 'temp', temp: 'temp', c: 'context', context: 'context', math: 'math', array: 'array', geometry: 'geometry', texture: 'texture', material: 'material' }

// ---- tokens ------------------------------------------------------------------------------------------------------

function tokenize (src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) {
      const m = /^(\d*\.?\d+(?:e[+-]?\d+)?)f?/i.exec(src.slice(i))
      tokens.push({ t: 'num', v: Number(m[1]) })
      i += m[0].length
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/.exec(src.slice(i))
      tokens.push({ t: 'id', v: m[0] })
      i += m[0].length
      continue
    }
    if (ch === "'") {
      const end = src.indexOf("'", i + 1)
      tokens.push({ t: 'str', v: src.slice(i + 1, end === -1 ? src.length : end) })
      i = end === -1 ? src.length : end + 1
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||', '??', '->'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/<>!?:()[]{},;='.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue }
    throw new Error(`unexpected '${ch}' at ${i}`)
  }
  return tokens
}

// ---- parser: AST nodes as plain arrays ---------------------------------------------------------------------------

function parse (src) {
  const tokens = tokenize(src)
  let p = 0
  const peek = (v) => tokens[p] && tokens[p].t === 'op' && tokens[p].v === v
  const take = (v) => { if (peek(v)) { p++; return true } return false }
  const expect = (v) => { if (!take(v)) throw new Error(`expected '${v}' at token ${p} in ${src}`) }

  // statements: a block of them, or a single expression
  function statements (closing) {
    const list = []
    const end = () => p >= tokens.length || (closing !== null && peek(closing))
    while (!end()) {
      if (take(';')) continue
      list.push(statement())
      if (!take(';') && !(closing && peek(closing)) && p < tokens.length) throw new Error(`expected ';' at token ${p} in ${src}`)
    }
    return list
  }
  function statement () {
    const tok = tokens[p]
    if (tok && tok.t === 'id') {
      const word = tok.v.toLowerCase()
      if (word === 'return') { p++; return ['return', expression()] }
      if (word === 'break' || word === 'continue') { p++; return ['nop'] }
    }
    return expression()
  }
  function expression () { return assignment() }
  function assignment () {
    const left = conditional()
    if (take('=')) {
      if (left[0] !== 'var') throw new Error(`cannot assign to ${JSON.stringify(left)} in ${src}`)
      return ['assign', left[1], left[2], assignment()]
    }
    return left
  }
  function conditional () {
    const cond = coalesce()
    if (take('?')) {
      const yes = conditional()
      if (take(':')) return ['?:', cond, yes, conditional()]
      return ['?', cond, yes]
    }
    return cond
  }
  function coalesce () {
    let left = or()
    while (take('??')) left = ['??', left, or()]
    return left
  }
  function or () {
    let left = and()
    while (take('||')) left = ['||', left, and()]
    return left
  }
  function and () {
    let left = equality()
    while (take('&&')) left = ['&&', left, equality()]
    return left
  }
  function equality () {
    let left = comparison()
    for (;;) {
      if (take('==')) left = ['==', left, comparison()]
      else if (take('!=')) left = ['!=', left, comparison()]
      else return left
    }
  }
  function comparison () {
    let left = additive()
    for (;;) {
      const op = ['<=', '>=', '<', '>'].find(o => peek(o))
      if (!op) return left
      p++
      left = [op, left, additive()]
    }
  }
  function additive () {
    let left = multiplicative()
    for (;;) {
      if (take('+')) left = ['+', left, multiplicative()]
      else if (take('-')) left = ['-', left, multiplicative()]
      else return left
    }
  }
  function multiplicative () {
    let left = unary()
    for (;;) {
      if (take('*')) left = ['*', left, unary()]
      else if (take('/')) left = ['/', left, unary()]
      else return left
    }
  }
  function unary () {
    if (take('-')) return ['neg', unary()]
    if (take('+')) return unary()
    if (take('!')) return ['!', unary()]
    return postfix()
  }
  function postfix () {
    let node = primary()
    for (;;) {
      if (take('[')) { node = ['index', node, expression()]; expect(']') } else if (take('->')) {
        // another entity's value (c.owning_entity->v.x): this context has no other entity
        postfix()
        node = ['num', 0]
      } else return node
    }
  }
  function primary () {
    const tok = tokens[p++]
    if (!tok) throw new Error(`unexpected end of ${src}`)
    if (tok.t === 'num') return ['num', tok.v]
    if (tok.t === 'str') return ['str', tok.v]
    if (tok.t === 'op') {
      if (tok.v === '(') { const e = expression(); expect(')'); return e }
      if (tok.v === '{') { const body = statements('}'); expect('}'); return ['block', body] }
      throw new Error(`unexpected '${tok.v}' in ${src}`)
    }
    const name = tok.v.toLowerCase()
    if (name === 'true') return ['num', 1]
    if (name === 'false') return ['num', 0]
    if (name === 'this') return ['this']
    const dot = name.indexOf('.')
    const ns = dot === -1 ? null : NAMESPACES[name.slice(0, dot)]
    if (!ns) return ['num', 0] // a bare word Molang does not know
    const rest = name.slice(dot + 1)
    let args = null
    if (take('(')) {
      args = []
      if (!take(')')) {
        do args.push(expression()); while (take(','))
        expect(')')
      }
    }
    if (ns === 'math') return ['math', rest, args ?? []]
    if (ns === 'query') return ['query', rest, args ?? []]
    if (ns === 'array' || ns === 'geometry' || ns === 'texture' || ns === 'material') return ['resource', ns, rest]
    return ['var', ns, rest]
  }

  const body = statements(null)
  if (body.length === 1 && body[0][0] !== 'return' && body[0][0] !== 'assign') return body[0]
  return ['program', body]
}

// ---- closures ----------------------------------------------------------------------------------------------------

const num = v => typeof v === 'number' ? (Number.isFinite(v) ? v : 0) : (typeof v === 'boolean' ? +v : (v == null ? 0 : (typeof v === 'string' ? (v ? 1 : 0) : 1)))
const truthy = v => typeof v === 'string' ? v !== '' : (v != null && v !== 0 && v !== false)

function build (node) {
  switch (node[0]) {
    case 'num': { const v = node[1]; return () => v }
    case 'str': { const v = node[1]; return () => v }
    case 'this': return ctx => ctx.self ?? 0
    case 'nop': return () => 0
    case 'var': {
      const [, ns, name] = node
      if (ns === 'variable') return ctx => ctx.variables?.[name]
      if (ns === 'temp') return ctx => ctx.temp?.[name]
      return ctx => ctx.context?.[name]
    }
    case 'assign': {
      const [, ns, name, valueNode] = node
      const value = build(valueNode)
      const store = ns === 'variable' ? 'variables' : ns === 'temp' ? 'temp' : 'context'
      return ctx => {
        const v = value(ctx)
        if (!ctx[store]) ctx[store] = {}
        ctx[store][name] = v
        return v
      }
    }
    case 'query': {
      const [, name, argNodes] = node
      const args = argNodes.map(build)
      return ctx => ctx.query ? ctx.query(name, args.map(a => a(ctx))) : 0
    }
    case 'math': {
      const [, name, argNodes] = node
      const args = argNodes.map(build)
      const f = MATH[name]
      if (!f) return () => 0
      if (name === 'pi') return () => Math.PI
      return ctx => num(f(...args.map(a => num(a(ctx)))))
    }
    case 'resource': {
      const [, ns, name] = node
      return ctx => ctx.resource ? ctx.resource(ns, name) : null
    }
    case 'index': {
      const target = build(node[1])
      const index = build(node[2])
      return ctx => {
        const arr = target(ctx)
        if (!Array.isArray(arr) || arr.length === 0) return null
        const i = Math.floor(num(index(ctx)))
        return arr[((i % arr.length) + arr.length) % arr.length]
      }
    }
    case 'neg': { const a = build(node[1]); return ctx => -num(a(ctx)) }
    case '!': { const a = build(node[1]); return ctx => truthy(a(ctx)) ? 0 : 1 }
    case '?:': {
      const c = build(node[1]); const a = build(node[2]); const b = build(node[3])
      return ctx => truthy(c(ctx)) ? a(ctx) : b(ctx)
    }
    case '?': {
      const c = build(node[1]); const a = build(node[2])
      return ctx => truthy(c(ctx)) ? a(ctx) : 0
    }
    case '??': {
      const a = build(node[1]); const b = build(node[2])
      return ctx => { const v = a(ctx); return v == null ? b(ctx) : v }
    }
    case '&&': { const a = build(node[1]); const b = build(node[2]); return ctx => truthy(a(ctx)) && truthy(b(ctx)) ? 1 : 0 }
    case '||': { const a = build(node[1]); const b = build(node[2]); return ctx => truthy(a(ctx)) || truthy(b(ctx)) ? 1 : 0 }
    case '==': case '!=': {
      const a = build(node[1]); const b = build(node[2]); const eq = node[0] === '=='
      return ctx => {
        let x = a(ctx)
        let y = b(ctx)
        if (typeof x !== 'string' || typeof y !== 'string') {
          if (typeof x === 'string' || typeof y === 'string') return (x === y) === eq ? 1 : 0
          x = num(x); y = num(y)
        }
        return (x === y) === eq ? 1 : 0
      }
    }
    case '<': case '>': case '<=': case '>=': case '+': case '-': case '*': case '/': {
      const a = build(node[1]); const b = build(node[2])
      switch (node[0]) {
        case '<': return ctx => num(a(ctx)) < num(b(ctx)) ? 1 : 0
        case '>': return ctx => num(a(ctx)) > num(b(ctx)) ? 1 : 0
        case '<=': return ctx => num(a(ctx)) <= num(b(ctx)) ? 1 : 0
        case '>=': return ctx => num(a(ctx)) >= num(b(ctx)) ? 1 : 0
        case '+': return ctx => num(a(ctx)) + num(b(ctx))
        case '-': return ctx => num(a(ctx)) - num(b(ctx))
        case '*': return ctx => num(a(ctx)) * num(b(ctx))
        case '/': return ctx => { const d = num(b(ctx)); return d === 0 ? 0 : num(a(ctx)) / d }
      }
      break
    }
    case 'return': return build(node[1]) // run by 'program', which stops there
    case 'block': {
      const body = node[1].map(build)
      return ctx => { for (const s of body) s(ctx); return 0 }
    }
    case 'program': {
      // statements in order; a return statement gives the program's value and ends it
      const body = node[1].map(s => [s[0] === 'return', build(s)])
      return ctx => {
        for (const [isReturn, run] of body) {
          const v = run(ctx)
          if (isReturn) return v
        }
        return 0
      }
    }
  }
  throw new Error(`unknown Molang node ${node[0]}`)
}

const cache = new Map()

// expression (string, number or boolean) -> (ctx) => value; a broken expression compiles to 0 (and warns once)
function compile (expr) {
  if (typeof expr === 'number') return () => expr
  if (typeof expr === 'boolean') return () => +expr
  if (expr == null) return () => 0
  const src = String(expr)
  let fn = cache.get(src)
  if (fn) return fn
  try {
    const node = parse(src)
    const run = build(node)
    fn = ctx => { if (ctx.temp === undefined) ctx.temp = {}; return run(ctx) }
  } catch (err) {
    if (typeof console !== 'undefined') console.warn(`Molang: ${err.message}`)
    fn = () => 0
  }
  cache.set(src, fn)
  return fn
}

// a single run, its value as a number
function evaluate (expr, ctx) {
  return num(compile(expr)(ctx))
}

module.exports = { compile, evaluate, parse, num, truthy, MATH }
