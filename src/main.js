import { setTimeout as esperar } from 'node:timers/promises';
import { criarServidorGracioso } from './servidor.js';
import { criarWorker } from './worker.js';
import { criarFilaMemoria } from './fila-memoria.js';

const PORTA = Number(process.env.PORT ?? 3000);
// Abaixo dos 30 s padrao de terminationGracePeriodSeconds: sair antes do SIGKILL
const PRAZO_TOTAL_MS = Number(process.env.PRAZO_TOTAL_MS ?? 25_000);
const ATRASO_PROPAGACAO_MS = Number(process.env.ATRASO_PROPAGACAO_MS ?? 5_000);

const app = criarServidorGracioso(
  async (req, res) => {
    await esperar(800); // simula uma requisicao que consulta banco e servicos externos
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: process.pid }));
  },
  { atrasoPropagacaoMs: ATRASO_PROPAGACAO_MS, prazoDrenagemMs: 15_000 },
);

const fila = criarFilaMemoria(Array.from({ length: 20 }, (_, i) => ({ id: `job-${i + 1}` })));
const worker = criarWorker({
  fila,
  async processar(job, signal) {
    for (let etapa = 1; etapa <= 5; etapa++) {
      signal.throwIfAborted(); // checkpoint: entre etapas, nunca no meio de uma
      await esperar(400);
    }
    console.log(`${job.id} concluido`);
  },
});

let encerrando = false;
async function encerrar(sinal) {
  if (encerrando) return; // segundo sinal nao reinicia a drenagem
  encerrando = true;
  console.log(`${sinal} recebido, drenando`);

  // Trava de seguranca: se algo travar, sai com erro registrado antes do SIGKILL
  setTimeout(() => {
    console.error('prazo total estourado, saindo com trabalho pendente');
    process.exit(1);
  }, PRAZO_TOTAL_MS).unref();

  const [http, jobs] = await Promise.all([app.drenar(), worker.parar(15_000)]);
  // Aqui entram pool.end(), broker.close() e o flush de logs e metricas
  console.log(
    `encerrado: ${http.cortadas} requisicoes cortadas, job interrompido: ${jobs.jobInterrompido}, ` +
      `devolvidos: ${fila.devolvidos.map((d) => d.id).join(', ') || 'nenhum'}`,
  );
  process.exit(0);
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));

app.server.listen(PORTA, () => console.log(`ouvindo na porta ${PORTA}, pid ${process.pid}`));
