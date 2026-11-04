# Placar do Buraco

App para marcar os pontos do jogo de baralho Buraco no celular (Android e iPhone).

- Cadastro das duplas e limite de pontos definido a cada partida
- Calculadora da rodada (canastras, batida, morto, cartas na mesa e na mão)
- Placar ao vivo entre celulares
- Histórico de todas as partidas e ranking de vitórias por jogador e por dupla

## Como funciona

Site estático hospedado no Vercel, com os dados no Supabase (projeto `buraco`, tabelas `partidas` e `rodadas`).
A chave em `config.js` é a chave pública do Supabase; o acesso é controlado pelas políticas RLS.

## Instalar no celular

- iPhone: abra o site no Safari → Compartilhar → Adicionar à Tela de Início
- Android: abra no Chrome → menu ⋮ → Adicionar à tela inicial

## Rodar localmente

```bash
npx serve .
```
