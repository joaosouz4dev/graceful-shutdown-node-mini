import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as esperar } from 'node:timers/promises';
import { criarServidorGracioso } from '../src/servidor.js';

async function subir(handler, opcoes) {
  const app = criarServidorGracioso(handler, opcoes);
  app.server.listen(0);
  await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, url };
}

function get(url, agent) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { agent }, (res) => {
        let corpo = '';
        res.on('data', (parte) => (corpo += parte));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo }));
      })
      .on('error', reject);
  });
}

const lento = (ms) => async (req, res) => {
  await esperar(ms);
  res.writeHead(200).end('feito');
};

test('requisicao em andamento termina com 200 durante o encerramento', async () => {
  const { app, url } = await subir(lento(400), { atrasoPropagacaoMs: 50, prazoDrenagemMs: 2000 });
  const resposta = get(`${url}/pedidos`);
  await esperar(50);
  const drenagem = app.drenar();
  const { status, corpo } = await resposta;
  assert.equal(status, 200);
  assert.equal(corpo, 'feito');
  assert.deepEqual(await drenagem, { cortadas: 0 });
});

test('readiness responde 503 e liveness 200 assim que a drenagem comeca', async () => {
  const { app, url } = await subir(lento(10), { atrasoPropagacaoMs: 300, prazoDrenagemMs: 1000 });
  assert.equal((await get(`${url}/healthz/ready`)).status, 200);
  const drenagem = app.drenar();
  assert.equal((await get(`${url}/healthz/ready`)).status, 503);
  assert.equal((await get(`${url}/healthz/live`)).status, 200);
  await drenagem;
});

test('requisicao que chega durante o atraso de propagacao ainda e atendida, com Connection: close', async () => {
  const { app, url } = await subir(lento(50), { atrasoPropagacaoMs: 300, prazoDrenagemMs: 1000 });
  const drenagem = app.drenar();
  const { status, headers } = await get(`${url}/pedidos`);
  assert.equal(status, 200);
  assert.equal(headers.connection, 'close');
  await drenagem;
});

test('conexao keep-alive ociosa nao segura o encerramento', async () => {
  const { app, url } = await subir(lento(10), { atrasoPropagacaoMs: 0, prazoDrenagemMs: 10_000 });
  const agent = new http.Agent({ keepAlive: true });
  assert.equal((await get(`${url}/pedidos`, agent)).status, 200);
  const inicio = Date.now();
  await app.drenar();
  assert.ok(Date.now() - inicio < 1000, 'drenagem esperou o keep-alive ocioso');
  agent.destroy();
});

test('prazo estourado corta a requisicao presa e informa quantas foram cortadas', async () => {
  const { app, url } = await subir(lento(5000), { atrasoPropagacaoMs: 0, prazoDrenagemMs: 200 });
  const resposta = get(`${url}/relatorio`).catch((erro) => erro);
  await esperar(50);
  assert.deepEqual(await app.drenar(), { cortadas: 1 });
  assert.ok((await resposta) instanceof Error);
});
