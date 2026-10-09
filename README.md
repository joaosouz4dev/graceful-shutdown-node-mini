# graceful-shutdown-node-mini

Projeto de exemplo do artigo [Graceful shutdown que ninguém testou: deploy que corta requisição no meio e derruba job em andamento](https://joaovictorsouza.dev/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento).

Mostra, sem dependências externas, o que um processo Node.js precisa fazer entre o SIGTERM e o `exit` para que um deploy não corte requisição no meio nem mate job em andamento:

- **Readiness separado de liveness:** `/healthz/ready` passa a responder 503 no instante em que a drenagem começa, `/healthz/live` continua 200.
- **Atraso de propagação:** o servidor continua atendendo por alguns segundos depois do SIGTERM, enquanto os balanceadores tiram a instância de rotação.
- **Drenagem HTTP com prazo:** para de aceitar conexões, derruba keep-alive ocioso, responde com `Connection: close`, espera as requisições em andamento e corta o que sobrar quando o prazo acaba, informando quantas foram cortadas.
- **Worker que sabe parar:** deixa de reservar jobs, espera o atual terminar dentro do prazo e, se o prazo estourar, interrompe no próximo checkpoint e devolve o job para a fila.
- **Trava de segurança:** um prazo total abaixo do `terminationGracePeriodSeconds` garante que o processo sai com erro registrado antes do SIGKILL.

## Estrutura

```text
src/servidor.js      servidor HTTP com readiness, contagem de requisições e drenar()
src/worker.js        worker com parar(prazo), checkpoint via AbortSignal e devolução do job
src/fila-memoria.js  fila em memória com o contrato reservar / concluir / devolver
src/main.js          processo completo: trata SIGTERM e SIGINT e coordena tudo
test/                testes com node:test
```

## Requisitos

- Node.js 19 ou superior (usa `server.closeIdleConnections()` e `server.closeAllConnections()`).

## Instalação e execução

Não há dependências para instalar.

```bash
npm test
```

```bash
npm start
```

Com o processo rodando, em outro terminal (Linux ou macOS):

```bash
for i in 1 2 3 4 5; do curl -s localhost:3000/pedidos & done; sleep 0.2; kill -TERM <pid>
```

As cinco requisições terminam com 200, o job em andamento conclui e o log final mostra `0 requisicoes cortadas`. No Windows, `kill` encerra o processo sem entregar o sinal; use Ctrl+C (SIGINT) ou rode dentro de um container:

```bash
docker run --rm -it -v "$PWD":/app -w /app -p 3000:3000 node:22-alpine node src/main.js
```

## Variáveis de ambiente

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `ATRASO_PROPAGACAO_MS` | `5000` | Tempo atendendo depois do SIGTERM, antes de fechar o servidor |
| `PRAZO_TOTAL_MS` | `25000` | Teto do encerramento inteiro; acima dele o processo sai com código 1 |

## Licença

MIT
