# Kikos Ranch · Painel de Cotações

Tela de cotações de commodities do agro, pronta para a Vercel.

## Estrutura
- `index.html` — a tela (cores da marca no topo do `<style>`, bloco `:root`)
- `logo.svg` — logo provisória; **substitua pelo arquivo oficial com o mesmo nome** (ou troque `logo.svg` por `logo.png` no `index.html`)
- `api/cotacoes.js` — função da Vercel que busca os preços e converte para R$

## Publicar
1. Crie um repositório no GitHub e suba estes arquivos.
2. Na Vercel: **Add New → Project → Import** o repositório. Framework: *Other*. Sem build.
3. Deploy. A tela fica em `https://seu-projeto.vercel.app`.

Ou pela linha de comando: `npx vercel --prod` dentro desta pasta.

## Opções na URL
- `?tv=1` — modo TV (tela cheia, fontes maiores, faixa rolando)
- `?destaque=soja` — muda o card de destaque (`boi`, `bezerro`, `acucar`, `etanol`, `anidro`, `milho`, `soja`, `trigo`, `algodao`)

Ordem dos cards: lista `ORDEM` em `api/cotacoes.js`. Logo: troque `logo.svg` (aparece ao lado do nome).

## Sobre os preços
São referências das bolsas internacionais (CME, CBOT, ICE), via Yahoo Finance, convertidas para R$/@ e R$/saca pelo dólar do momento. Atualização a cada 15 min, atraso de ~15 min. **Não são o indicador CEPEA/B3 nem o preço físico da praça** — para isso é preciso uma fonte paga (ex.: B3 Market Data, Broadcast Agro, Notícias Agrícolas) e trocar só o `api/cotacoes.js`.

Para adicionar/remover produtos, edite a lista `ATIVOS` em `api/cotacoes.js`.

**Etanol hidratado:** vem do contrato futuro da B3 (vencimento mais próximo negociado), já em R$/m³, lido da página pública da Notícias Agrícolas. Atualiza uma vez por dia, no fechamento.

**Boi gordo por estado:** seção abaixo dos cards, com o Indicador do Boi da Datagro (R$/@, por sigla de estado), lido da página pública da Notícias Agrícolas. Ranking do maior para o menor, diferença para a média dos estados e variação do dia. Se a fonte falhar, a seção some e o resto da tela continua normal.
