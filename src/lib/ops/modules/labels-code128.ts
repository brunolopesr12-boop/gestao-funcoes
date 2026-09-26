/* ------------------------------------------------------------------ */
/* Módulo ETIQUETAS · codificador Code 128 (subconjuntos B e C)         */
/*                                                                      */
/* Gera a sequência de larguras de barras/espaços de um código Code 128 */
/* para desenhar um SVG na etiqueta. Não depende de biblioteca externa.  */
/* Na impressão ZPL o código é gerado pela própria impressora (^BC).     */
/* ------------------------------------------------------------------ */

/** Padrões oficiais do Code 128 (valores 0..106): larguras alternadas barra/espaço, soma 11 (stop = 13). */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

export type Code128 = {
  /** larguras em módulos, começando por barra e alternando barra/espaço */
  widths: number[];
  /** total de módulos (soma das larguras) — largura do código em unidades */
  modules: number;
  /** subconjunto usado */
  subset: "B" | "C";
};

/** Texto pode ser codificado em Code 128B? (ASCII imprimível 32..126) */
export function code128Supported(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 80) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

/**
 * Codifica um texto em Code 128.
 * - Só dígitos com quantidade par → subconjunto C (mais compacto: 2 dígitos por símbolo).
 * - Demais textos ASCII imprimíveis → subconjunto B.
 * Devolve null quando o texto tem caracteres não suportados (a interface mostra o texto em vez do código).
 */
export function encodeCode128(value: string): Code128 | null {
  const v = value.trim();
  if (!code128Supported(v)) return null;
  const digitsOnly = /^\d+$/.test(v);
  const useC = digitsOnly && v.length % 2 === 0;
  const codes: number[] = [];
  if (useC) {
    codes.push(START_C);
    for (let i = 0; i < v.length; i += 2) codes.push(Number(v.slice(i, i + 2)));
  } else {
    codes.push(START_B);
    for (let i = 0; i < v.length; i++) codes.push(v.charCodeAt(i) - 32);
  }
  // dígito verificador: (start + Σ posição × valor) mod 103
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += i * codes[i];
  codes.push(sum % 103);
  codes.push(STOP);

  const widths: number[] = [];
  for (const c of codes) for (const ch of PATTERNS[c]) widths.push(Number(ch));
  const modules = widths.reduce((a, b) => a + b, 0);
  return { widths, modules, subset: useC ? "C" : "B" };
}

/** Quantidade aproximada de módulos que o código terá (para calibrar a largura do módulo no ZPL). */
export function code128Modules(value: string): number {
  const enc = encodeCode128(value);
  if (enc) return enc.modules;
  // estimativa: start + n símbolos + verificador (11 cada) + stop (13)
  return 11 * (value.length + 2) + 13;
}
