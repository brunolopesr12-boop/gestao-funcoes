/** Formatação de dinheiro usada nos alertas e na comanda. */
export function brl(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

/** Converte qualquer coisa vinda da API para número seguro. */
export function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Arredonda para 2 casas evitando lixo de ponto flutuante. */
export function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
