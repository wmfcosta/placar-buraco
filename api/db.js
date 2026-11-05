// API do Placar do Buraco: roda no Vercel e conversa com o banco Neon.
// A string de conexão fica só na variável DATABASE_URL do Vercel, nunca no navegador.
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const nome = v => {
  const s = String(v ?? '').trim();
  if (s.length < 1 || s.length > 40) throw new Erro('Cada jogador precisa de um nome com até 40 letras.');
  return s;
};
const inteiro = (v, min, max, msg) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Erro(msg);
  return n;
};
class Erro extends Error {}

// Recalcula o placar a partir das rodadas e decide se a partida terminou.
const recalcular = id => sql`
  update partidas p set
    placar_a = s.a, placar_b = s.b,
    status   = case when (s.a >= p.limite or s.b >= p.limite) and s.a <> s.b then 'encerrada' else 'andamento' end,
    vencedor = case when (s.a >= p.limite or s.b >= p.limite) and s.a <> s.b then (case when s.a > s.b then 'A' else 'B' end) end,
    finished_at = case when (s.a >= p.limite or s.b >= p.limite) and s.a <> s.b then coalesce(p.finished_at, now()) end,
    updated_at = now()
  from (select coalesce(sum(pontos_a),0)::int a, coalesce(sum(pontos_b),0)::int b from rodadas where partida_id = ${id}) s
  where p.id = ${id} and p.status <> 'cancelada'`;

async function partidaCompleta(id) {
  const [p, r] = await sql.transaction([
    sql`select * from partidas where id = ${id}`,
    sql`select * from rodadas where partida_id = ${id} order by numero`
  ]);
  return { partida: p[0] || null, rodadas: r };
}

const uuid = v => {
  const s = String(v || '');
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Erro('Partida não encontrada.');
  return s;
};

const leituras = {
  partida: q => partidaCompleta(uuid(q.id)),
  // versão leve, usada a cada poucos segundos para saber se algo mudou
  versao: async q => {
    const r = await sql`select updated_at, status from partidas where id = ${uuid(q.id)}`;
    return r[0] || null;
  },
  abertas: () => sql`select * from partidas where status = 'andamento' order by created_at desc limit 10`,
  historico: () => sql`select * from partidas where status <> 'cancelada' order by created_at desc limit 200`,
  ranking: () => sql`select a1,a2,b1,b2,vencedor from partidas where status = 'encerrada' limit 5000`,
  jogadores: () => sql`select a1,a2,b1,b2 from partidas order by created_at desc limit 300`
};

const escritas = {
  criar: async b => {
    const limite = inteiro(b.limite, 100, 100000, 'O limite precisa ficar entre 100 e 100.000 pontos.');
    const [p] = await sql`insert into partidas (a1,a2,b1,b2,limite)
      values (${nome(b.a1)},${nome(b.a2)},${nome(b.b1)},${nome(b.b2)},${limite}) returning *`;
    return p;
  },
  rodada: async b => {
    const id = uuid(b.partida_id);
    const numero = inteiro(b.numero, 1, 10000, 'Número de rodada inválido.');
    const pa = inteiro(b.pontos_a, -20000, 20000, 'Pontos fora do limite permitido.');
    const pb = inteiro(b.pontos_b, -20000, 20000, 'Pontos fora do limite permitido.');
    const [p] = await sql`select status from partidas where id = ${id}`;
    if (!p) throw new Erro('Partida não encontrada.');
    if (p.status !== 'andamento') throw new Erro('Esta partida já foi encerrada.');
    try {
      await sql.transaction([
        sql`insert into rodadas (partida_id, numero, pontos_a, pontos_b) values (${id}, ${numero}, ${pa}, ${pb})`,
        recalcular(id)
      ]);
    } catch (e) {
      if (e.code === '23505') { const x = new Erro('Outro celular lançou esta rodada. O placar foi atualizado.'); x.conflito = true; throw x; }
      throw e;
    }
    return partidaCompleta(id);
  },
  desfazer: async b => {
    const id = uuid(b.partida_id);
    await sql.transaction([
      sql`delete from rodadas where id = (select id from rodadas where partida_id = ${id} order by numero desc limit 1)`,
      recalcular(id)
    ]);
    return partidaCompleta(id);
  },
  cancelar: async b => {
    const id = uuid(b.partida_id);
    await sql`update partidas set status = 'cancelada', updated_at = now() where id = ${id}`;
    return { ok: true };
  }
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const fn = leituras[req.query.r];
      if (!fn) return res.status(404).json({ erro: 'Consulta desconhecida.' });
      return res.status(200).json(await fn(req.query));
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const fn = escritas[body.acao];
      if (!fn) return res.status(404).json({ erro: 'Ação desconhecida.' });
      return res.status(200).json(await fn(body));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (e) {
    if (e instanceof Erro) return res.status(e.conflito ? 409 : 400).json({ erro: e.message, conflito: !!e.conflito });
    console.error(e);
    return res.status(500).json({ erro: 'O servidor não respondeu. Tente de novo.' });
  }
}
