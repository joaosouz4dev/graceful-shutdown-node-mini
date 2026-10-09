import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { criarWorker } from '../src/worker.js';
import { criarFilaMemoria } from '../src/fila-memoria.js';

const jobs = (n) => Array.from({ length: n }, (_, i) => ({ id: `job-${i + 1}` }));

async function emEtapas(signal, etapas, msPorEtapa) {
  for (let i = 0; i < etapas; i++) {
    signal.throwIfAborted();
    await esperar(msPorEtapa);
  }
}

test('job em andamento termina dentro do prazo e nenhum outro e reservado', async () => {
  const fila = criarFilaMemoria(jobs(3));
  const worker = criarWorker({ fila, processar: (job, signal) => emEtapas(signal, 4, 50) });
  await esperar(30); // job-1 em execucao
  assert.deepEqual(await worker.parar(2000), { jobInterrompido: false });
  assert.deepEqual(fila.concluidos, ['job-1']);
  assert.deepEqual(fila.pendentes.map((j) => j.id), ['job-2', 'job-3']);
  assert.deepEqual(fila.devolvidos, []);
});

test('prazo estourado interrompe no checkpoint e devolve o job para a fila', async () => {
  const fila = criarFilaMemoria(jobs(2));
  const worker = criarWorker({ fila, processar: (job, signal) => emEtapas(signal, 50, 50) });
  await esperar(30);
  assert.deepEqual(await worker.parar(150), { jobInterrompido: true });
  assert.deepEqual(fila.concluidos, []);
  assert.deepEqual(fila.devolvidos, [{ id: 'job-1', motivo: 'encerramento' }]);
  assert.deepEqual(fila.pendentes.map((j) => j.id), ['job-1', 'job-2']);
});

test('falha real do job tambem devolve, com o motivo do erro', async () => {
  const fila = criarFilaMemoria(jobs(1));
  const worker = criarWorker({
    fila,
    processar: async () => {
      throw new Error('erp indisponivel');
    },
  });
  await esperar(20);
  await worker.parar(500);
  assert.equal(fila.devolvidos[0].motivo, 'erp indisponivel');
});
