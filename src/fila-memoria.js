// Fila em memoria com o mesmo contrato de uma fila real (reservar, concluir,
// devolver). Em producao, devolver equivale a liberar o lease ou o ack negativo.
export function criarFilaMemoria(jobs = []) {
  const pendentes = [...jobs];
  const concluidos = [];
  const devolvidos = [];

  return {
    async reservar() {
      return pendentes.shift() ?? null;
    },
    async concluir(job) {
      concluidos.push(job.id);
    },
    async devolver(job, motivo) {
      devolvidos.push({ id: job.id, motivo });
      pendentes.unshift(job);
    },
    pendentes,
    concluidos,
    devolvidos,
  };
}
