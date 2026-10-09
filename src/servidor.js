import http from 'node:http';
import { setTimeout as esperar } from 'node:timers/promises';

// Servidor HTTP que sabe sair: readiness separado de liveness, contagem das
// requisicoes em andamento e uma drenagem com prazo.
export function criarServidorGracioso(handler, opcoes = {}) {
  const { atrasoPropagacaoMs = 5000, prazoDrenagemMs = 15000 } = opcoes;
  let pronto = true;
  let ativas = 0;
  let aoZerar = null;

  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz/live') {
      res.writeHead(200).end('ok'); // o processo esta vivo, mesmo encerrando
      return;
    }
    if (req.url === '/healthz/ready') {
      res.writeHead(pronto ? 200 : 503).end(pronto ? 'ok' : 'encerrando');
      return;
    }

    ativas++;
    // Durante a drenagem, cada resposta fecha a conexao em vez de devolve-la ao pool
    if (!pronto) res.setHeader('Connection', 'close');
    res.on('close', () => {
      ativas--;
      if (ativas === 0 && aoZerar) aoZerar();
    });

    try {
      await handler(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  async function drenar() {
    pronto = false; // 1. readiness passa a 503: o balanceador comeca a tirar a instancia
    await esperar(atrasoPropagacaoMs); // 2. tempo para a remocao chegar a todos os balanceadores

    const fechado = new Promise((resolve) => server.close(resolve)); // 3. para de aceitar conexoes
    server.closeIdleConnections(); // 4. derruba o keep-alive que nao tem requisicao

    const semAtivas = ativas === 0 ? Promise.resolve() : new Promise((r) => (aoZerar = r));
    const resultado = await Promise.race([
      semAtivas.then(() => 'drenado'),
      esperar(prazoDrenagemMs, 'prazo', { ref: false }),
    ]);

    const cortadas = ativas;
    if (resultado === 'prazo') server.closeAllConnections(); // 5. prazo estourou: corta o resto
    else server.closeIdleConnections(); // conexoes que ficaram ociosas durante a drenagem
    await fechado;
    return { cortadas };
  }

  return {
    server,
    drenar,
    get ativas() {
      return ativas;
    },
  };
}
