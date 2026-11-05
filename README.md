# Placar do Buraco

App para marcar os pontos do jogo de baralho Buraco no celular (Android e iPhone).

- Cadastro das duplas e limite de pontos definido a cada partida
- Calculadora da rodada (canastras, batida, morto, cartas na mesa e na mão)
- Placar ao vivo entre celulares
- Histórico de todas as partidas e ranking de vitórias por jogador e por dupla

## Como funciona

Site estático hospedado no Vercel. Os dados ficam no Neon (projeto `buraco`, tabelas `partidas` e `rodadas`).
O navegador nunca fala direto com o banco: tudo passa pela função `api/db.js`, que lê a conexão
da variável de ambiente `DATABASE_URL` configurada no Vercel. O placar se atualiza entre celulares
consultando a API a cada 3 segundos.

## Instalar no celular

- iPhone: abra o site no Safari → Compartilhar → Adicionar à Tela de Início
- Android: abra no Chrome → menu ⋮ → Adicionar à tela inicial

## Rodar localmente

```bash
npm install
DATABASE_URL="postgresql://..." npx vercel dev
```
