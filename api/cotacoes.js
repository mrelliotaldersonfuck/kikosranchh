// Função serverless da Vercel — rota /api/cotacoes
// Fonte principal: Investing.com (páginas públicas). Reserva: Yahoo Finance.
// Converte tudo para R$ com o USD/BRL do Investing.com. Cache de 15 min na borda.

const INV = 'https://www.investing.com';

const ATIVOS = [
  // fator = quantas unidades da bolsa cabem na unidade brasileira (preço da bolsa em centavos de US$)
  { id: 'boi',     nome: 'Boi gordo',    bolsa: 'CME Live Cattle',   inv: '/commodities/live-cattle',    yahoo: 'LE=F', fator: 33.0693, unidade: 'R$/@',        orig: 'US¢/lb' },
  { id: 'bezerro', nome: 'Bezerro',      bolsa: 'CME Feeder Cattle', inv: '/commodities/feeder-cattle',  yahoo: 'GF=F', fator: 33.0693, unidade: 'R$/@',        orig: 'US¢/lb' },
  { id: 'soja',    nome: 'Soja',         bolsa: 'CBOT',              inv: '/commodities/us-soybeans',    yahoo: 'ZS=F', fator: 2.20462, unidade: 'R$/sc 60 kg', orig: 'US¢/bu' },
  { id: 'milho',   nome: 'Milho',        bolsa: 'CBOT',              inv: '/commodities/us-corn',        yahoo: 'ZC=F', fator: 2.36210, unidade: 'R$/sc 60 kg', orig: 'US¢/bu' },
  { id: 'acucar',  nome: 'Açúcar',       bolsa: 'ICE NY #11',        inv: '/commodities/us-sugar-no11',  yahoo: 'SB=F', fator: 110.231, unidade: 'R$/sc 50 kg', orig: 'US¢/lb' },
  { id: 'trigo',   nome: 'Trigo',        bolsa: 'CBOT',              inv: '/commodities/us-wheat',       yahoo: 'ZW=F', fator: 2.20462, unidade: 'R$/sc 60 kg', orig: 'US¢/bu' },
  { id: 'algodao', nome: 'Algodão',      bolsa: 'ICE NY',            inv: '/commodities/us-cotton-no.2', yahoo: 'CT=F', fator: 33.0693, unidade: 'R$/@',        orig: 'US¢/lb' },
];

// Etanol — páginas públicas da Notícias Agrícolas (valores já em R$)
const NA = 'https://www.noticiasagricolas.com.br/cotacoes/sucroenergetico/';
const ETANOIS = [
  // B3 publica em R$/m³ → divide por 1000 para mostrar R$/litro
  { id: 'etanol',  nome: 'Etanol hidratado', url: NA + 'etanol-b3-prego-regular',
    divisor: 1000, fonte: 'B3 via Notícias Agrícolas', tipo: 'b3' },
  { id: 'anidro',  nome: 'Etanol anidro',    url: NA + 'indicador-semanal-etanol-anidro-cepea-esalq',
    divisor: 1,    fonte: 'CEPEA/ESALQ via Notícias Agrícolas', tipo: 'cepea' },
];

const DOLAR = { id: 'dolar', nome: 'Dólar comercial', inv: '/currencies/usd-brl', yahoo: 'BRL=X' };
const EURO  = { id: 'euro',  nome: 'Euro',            inv: '/currencies/eur-brl', yahoo: 'EURBRL=X' };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8',
};

const num = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ---------- Investing.com ----------
async function investing(path) {
  const r = await fetch(INV + path, { headers: HEADERS });
  if (!r.ok) throw new Error(`Investing ${path}: HTTP ${r.status}`);
  const html = await r.text();

  // 1) atributos data-test da página
  let preco = num(html.match(/data-test="instrument-price-last"[^>]*>([^<]+)</)?.[1]);
  const pctTag = html.match(/data-test="instrument-price-change-percent"([^>]*)>([\s\S]{0,120}?)<\/span>/);
  let pct = null;
  if (pctTag) {
    const txt = pctTag[2].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '');
    pct = num(txt.match(/[-+]?[\d.,]+/)?.[0]);
    if (pct != null && !/[-+]/.test(txt) && /negative|red/.test(pctTag[1])) pct = -pct;
  }

  // 2) reserva: JSON embutido (__NEXT_DATA__)
  if (preco == null) {
    const m = html.match(/"last"\s*:\s*([-\d.]+)/);
    preco = m ? parseFloat(m[1]) : null;
    const p = html.match(/"changePcr"\s*:\s*([-\d.]+)/);
    pct = p ? parseFloat(p[1]) : pct;
  }
  if (preco == null) throw new Error(`Investing ${path}: preço não encontrado`);

  return { preco, variacao: pct, fonte: 'Investing.com' };
}

// ---------- Yahoo (reserva + histórico de 30 dias) ----------
async function yahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!r.ok) throw new Error(`Yahoo ${ticker}: HTTP ${r.status}`);
  const res = (await r.json())?.chart?.result?.[0];
  if (!res) throw new Error(`Yahoo ${ticker}: sem dados`);
  const closes = (res.indicators?.quote?.[0]?.close || []).filter((v) => typeof v === 'number');
  const preco = res.meta?.regularMarketPrice ?? closes.at(-1);
  const ant = closes.length > 1 ? closes.at(-2) : res.meta?.chartPreviousClose;
  return { preco, variacao: ant ? (preco / ant - 1) * 100 : null, closes, fonte: 'Yahoo Finance' };
}

// ---------- Notícias Agrícolas (etanol B3) ----------
const brNum = (s) => {
  const n = parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

async function etanol(e) {
  const r = await fetch(e.url, { headers: { ...HEADERS, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (!r.ok) throw new Error(`Notícias Agrícolas: HTTP ${r.status}`);
  const html = await r.text();

  // um bloco por fechamento: "Fechamento: dd/mm/aaaa" + tabela (1ª linha = vencimento mais próximo / semana)
  const dias = [];
  const re = /class="fechamento">\s*Fechamento:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/g;
  let m;
  while ((m = re.exec(html))) {
    const tr = m[2].match(/<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>/);
    if (!tr) continue; // sem negócios
    dias.push({ data: m[1], ref: tr[1].trim(), preco: brNum(tr[2]) / e.divisor, variacao: brNum(tr[3]) });
  }
  if (!dias.length) throw new Error('Notícias Agrícolas: tabela não encontrada');
  const ult = dias[0];
  const b3 = e.tipo === 'b3';
  return {
    id: e.id, nome: e.nome,
    bolsa: b3 ? `B3 · ${ult.ref}` : 'CEPEA/ESALQ · semanal',
    unidade: 'R$/litro', casas: 4,
    preco: ult.preco, variacao: ult.variacao,
    precoOrig: b3 ? ult.preco * 1000 : null,
    orig: b3 ? `R$/m³ · fech. ${ult.data.slice(0, 5)}` : `semana ${ult.ref.replace(/\/\d{4}$/, '')}`,
    historico: dias.map((d) => d.preco).reverse(),
    fonte: e.fonte, aviso: null,
  };
}

// ---------- Boi gordo por estado (Indicador do Boi Datagro, via Notícias Agrícolas) ----------
const BOI_UF_URL = 'https://www.noticiasagricolas.com.br/cotacoes/boi-gordo/indicador-do-boi';
const UF = {
  'acre':'AC','alagoas':'AL','amapa':'AP','amazonas':'AM','bahia':'BA','ceara':'CE','distrito federal':'DF',
  'espirito santo':'ES','goias':'GO','maranhao':'MA','mato grosso':'MT','mato grosso do sul':'MS',
  'minas gerais':'MG','para':'PA','paraiba':'PB','parana':'PR','pernambuco':'PE','piaui':'PI',
  'rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS','rondonia':'RO','roraima':'RR',
  'santa catarina':'SC','sao paulo':'SP','sergipe':'SE','tocantins':'TO',
};
const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function boiPorEstado() {
  const r = await fetch(BOI_UF_URL, { headers: { ...HEADERS, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (!r.ok) throw new Error(`Datagro/Notícias Agrícolas: HTTP ${r.status}`);
  const html = await r.text();

  const dias = []; // do mais recente para o mais antigo
  const re = /class="fechamento">\s*Fechamento:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/g;
  let m;
  while ((m = re.exec(html))) {
    const linhas = [...m[2].matchAll(/<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>/g)];
    if (!linhas.length) continue;
    const mapa = {};
    for (const l of linhas) {
      const nome = l[1].trim();
      const uf = UF[semAcento(nome)] || nome.slice(0, 2).toUpperCase();
      mapa[uf] = { uf, preco: brNum(l[2]), variacao: brNum(l[3]) };
    }
    dias.push({ data: m[1], mapa });
  }
  if (!dias.length) throw new Error('Datagro: tabela não encontrada');

  const ult = dias[0];
  const estados = Object.values(ult.mapa).map((e) => ({
    ...e,
    historico: dias.map((d) => d.mapa[e.uf]?.preco).filter((v) => v != null).reverse(),
  })).sort((a, b) => b.preco - a.preco);

  return { data: ult.data, fonte: 'Datagro via Notícias Agrícolas', unidade: 'R$/@', estados };
}

async function cotar(a) {
  const [inv, yh] = await Promise.allSettled([investing(a.inv), yahoo(a.yahoo)]);
  const hist = yh.status === 'fulfilled' ? yh.value.closes : [];
  if (inv.status === 'fulfilled') return { ...inv.value, closes: hist, aviso: null };
  if (yh.status === 'fulfilled') return { ...yh.value, aviso: String(inv.reason?.message || inv.reason) };
  throw new Error(`${inv.reason?.message || inv.reason} | ${yh.reason?.message || yh.reason}`);
}

module.exports = async (req, res) => {
  try {
    const [dolar, euro] = await Promise.all([cotar(DOLAR), cotar(EURO).catch(() => null)]);
    const usd = dolar.preco;

    const itens = await Promise.all(
      ATIVOS.map(async (a) => {
        try {
          const s = await cotar(a);
          const conv = (c) => (c / 100) * a.fator * usd; // centavos US$ → R$
          const historico = s.closes.map(conv);
          // garante que o último ponto do gráfico é o preço atual
          if (historico.length) historico[historico.length - 1] = conv(s.preco);
          return {
            id: a.id, nome: a.nome, bolsa: a.bolsa, unidade: a.unidade, orig: a.orig,
            precoOrig: s.preco, preco: conv(s.preco), variacao: s.variacao,
            historico, fonte: s.fonte, aviso: s.aviso,
          };
        } catch (e) {
          return { id: a.id, nome: a.nome, bolsa: a.bolsa, unidade: a.unidade, erro: String(e.message || e) };
        }
      })
    );

    for (const e of ETANOIS) {
      try { itens.push(await etanol(e)); }
      catch (err) { itens.push({ id: e.id, nome: e.nome, bolsa: e.fonte, unidade: 'R$/litro', erro: String(err.message || err) }); }
    }

    let boiEstados = null;
    try { boiEstados = await boiPorEstado(); } catch (e) { boiEstados = { erro: String(e.message || e) }; }

    // ordem de exibição na tela
    const ORDEM = ['boi', 'bezerro', 'acucar', 'etanol', 'anidro', 'milho', 'soja', 'trigo', 'algodao'];
    itens.sort((x, y) => (ORDEM.indexOf(x.id) + 1 || 99) - (ORDEM.indexOf(y.id) + 1 || 99));

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.status(200).json({
      atualizado: Date.now(),
      dolar: { nome: DOLAR.nome, preco: usd, variacao: dolar.variacao, fonte: dolar.fonte, aviso: dolar.aviso },
      euro: euro ? { nome: EURO.nome, preco: euro.preco, variacao: euro.variacao, fonte: euro.fonte } : null,
      itens,
      boiEstados,
    });
  } catch (e) {
    res.status(502).json({ erro: String(e.message || e) });
  }
};
