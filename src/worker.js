import { setTimeout as esperar } from 'node:timers/promises';

// Worker que para de reservar jobs ao receber o pedido de parada, deixa o job
// atual terminar dentro do prazo e, se o prazo estourar, pede que ele pare no
// proximo checkpoint e o devolve para a fila.
export function criarWorker({ fila, processar, intervaloMs = 200 }) {
  const controle = new AbortController();
  let parando = false;

  const rodando = (async () => {
    while (!parando) {
      const job = await fila.reservar();
      if (!job) {
        await esperar(intervaloMs, undefined, { ref: false });
        continue;
      }
      try {
        await processar(job, controle.signal);
        await fila.concluir(job);
      } catch (erro) {
        // Abortado no encerramento ou falha real: volta para a fila e outra instancia retoma
        const motivo = controle.signal.aborted ? 'encerramento' : String(erro.message);
        await fila.devolver(job, motivo);
        if (!controle.signal.aborted) await esperar(intervaloMs, undefined, { ref: false }); // sem laco quente
      }
    }
  })();

  async function parar(prazoMs) {
    parando = true; // 1. nao reserva mais nada
    const terminou = await Promise.race([
      rodando.then(() => true),
      esperar(prazoMs, false, { ref: false }),
    ]);
    if (!terminou) {
      controle.abort(); // 2. prazo estourou: o job para no proximo checkpoint
      await rodando;
    }
    return { jobInterrompido: !terminou };
  }

  return { parar };
}
