/**
 * Processamento de texto em português para a busca do VILA GPT.
 *
 * Tudo aqui é puro (sem React, sem rede) para poder ser testado com node.
 * A ideia não é ser um motor de busca perfeito, e sim ser previsível:
 * normaliza acentos, tira palavras vazias, reduz palavras à raiz e junta
 * sinônimos do dia a dia da operação (abrir/abertura, ifood/delivery…).
 */

/* ------------------------------------------------------------------ */
/* Normalização                                                        */
/* ------------------------------------------------------------------ */

/** minúsculas, sem acento, só letras/números separados por espaço */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ */
/* Palavras vazias (stopwords) — inclui "palavras de pergunta"         */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set(
  `a o as os um uma uns umas de do da dos das em no na nos nas por para pra pro
   com sem sob sobre e ou mas que se ao aos ate ja la aqui ali entao tambem
   muito mais menos bem mal sim nao
   e eh ser sao foi era esta estao estar estou ter tem tenho teve tinha ha
   isso isto esse essa este esta aquele aquela aquilo ele ela eles elas eu voce
   voces nos meu minha meus minhas seu sua seus suas dele dela me te lhe
   dessa desse deste desta nesse nessa neste nesta num numa pelo pela pelos pelas
   como faco fazer faz fazem fazendo feito feita devo deve devem deveria dever
   posso pode podem poderia preciso precisa precisam precisar
   quando onde qual quais quem o que porque por que
   procedimento procedimentos processo processos regra regras norma normas
   instrucao instrucoes orientacao orientacoes politica politicas
   passo passos etapa etapas
   quero queria gostaria saber sei da dar ficar fica fico vou vai vamos ir
   algum alguma alguns algumas cada todo toda todos todas outro outra mesmo mesma
   determinado determinada certo certa correto correta jeito forma maneira
   oi ola obrigado obrigada favor ok ta tá ne`
    .split(/\s+/)
    .map((w) => normalize(w))
    .filter(Boolean),
);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/* ------------------------------------------------------------------ */
/* Raiz da palavra (stemmer bem simples para pt-BR)                    */
/* ------------------------------------------------------------------ */

const SUFFIXES = [
  "amento", "imento", "mento", "agem", "acao", "icao", "ucao", "cao",
  "ando", "endo", "indo", "ador", "edor", "idor", "eiro", "eira", "ista",
  "eza", "ado", "ido", "ada", "ida", "ar", "er", "ir", "a", "e", "o",
];

export function stem(raw: string): string {
  let t = raw;
  if (t.length <= 3) return t;

  // plural
  if (t.endsWith("oes")) t = t.slice(0, -3) + "ao";
  else if (t.endsWith("aes")) t = t.slice(0, -3) + "ao";
  else if (t.endsWith("ais")) t = t.slice(0, -3) + "al";
  else if (t.endsWith("eis")) t = t.slice(0, -3) + "el";
  else if (t.endsWith("ois")) t = t.slice(0, -3) + "ol";
  else if (t.endsWith("ns")) t = t.slice(0, -2) + "m";
  else if (t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);

  // sufixo
  for (const s of SUFFIXES) {
    if (t.endsWith(s) && t.length - s.length >= 3) {
      t = t.slice(0, -s.length);
      break;
    }
  }
  // vogal final solta (opera -> oper, fecha -> fech)
  if (t.length >= 5 && /[aeo]$/.test(t)) t = t.slice(0, -1);
  return t;
}

/* ------------------------------------------------------------------ */
/* Sinônimos da operação                                               */
/* ------------------------------------------------------------------ */

const SYNONYM_GROUPS: string[][] = [
  ["abrir", "abertura", "abre", "abrindo", "abriu"],
  ["fechar", "fechamento", "fecha", "fechando", "encerrar", "encerramento"],
  ["pedido", "comanda", "pedidos", "comandas"],
  ["ifood", "delivery", "entrega", "entregar", "entregas", "motoboy", "entregador"],
  ["devolucao", "devolver", "devolve", "troca", "trocar", "reembolso", "estorno", "estornar"],
  ["cancelar", "cancelamento", "cancela", "cancelado"],
  ["limpar", "limpeza", "higienizar", "higienizacao", "lavar", "lavagem", "sanitizar"],
  ["perda", "perdas", "quebra", "desperdicio", "descarte", "descartar", "estragou", "vencido"],
  ["montar", "montagem", "monta", "montando"],
  ["preparar", "preparo", "prepara", "preparando"],
  ["embalagem", "embalar", "embalado", "embalagens", "pote", "potes", "marmita", "marmitex"],
  ["ingrediente", "ingredientes", "insumo", "insumos"],
  ["quantidade", "quantidades", "gramatura", "medida", "medidas", "dose", "porcao", "porcoes", "gramas"],
  ["cliente", "clientes", "consumidor", "freguês", "fregues"],
  ["reclamar", "reclamacao", "reclama", "reclamou", "queixa", "insatisfeito"],
  ["responsavel", "responsabilidade", "responsabilidades", "encarregado", "cuida", "cuidar"],
  ["funcionario", "funcionarios", "colaborador", "colaboradores", "equipe"],
  ["falta", "faltar", "faltou", "faltando", "acabou", "acabar", "esgotado", "esgotou", "zerou"],
  ["estoque", "estocar", "almoxarifado", "reposicao", "repor"],
  ["problema", "problemas", "erro", "erros", "falha", "falhou", "travou", "travado", "caiu", "bug"],
  ["cardapio", "menu"],
  ["cadastrar", "cadastro", "registrar", "registro", "lancar", "lancamento", "anotar", "inserir", "incluir"],
  ["checklist", "conferir", "conferencia", "checar", "verificar", "check"],
  ["treinamento", "treinar", "treino", "capacitacao", "treinado"],
  ["apto", "aptidao", "certificado", "certificar", "certificacao", "certificada"],
  ["strogonoff", "estrogonofe", "strogonofe", "estrogonoff", "stroganoff", "estroganofe"],
  ["equipamento", "equipamentos", "maquina", "maquinas", "fritadeira", "chapa", "forno", "freezer", "geladeira"],
  ["horario", "horarios", "turno", "turnos", "escala"],
  ["caixa", "pdv"],
  ["pagamento", "pagar", "pago", "cobrar", "cobranca", "pix", "cartao", "dinheiro"],
  ["sistema", "programa", "tela"],
];

const CANONICAL = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const canonical = stem(normalize(group[0]));
  for (const word of group) {
    const s = stem(normalize(word));
    if (!CANONICAL.has(s)) CANONICAL.set(s, canonical);
  }
}

export function canonical(stemmed: string): string {
  return CANONICAL.get(stemmed) ?? stemmed;
}

/* ------------------------------------------------------------------ */
/* Tokenização                                                         */
/* ------------------------------------------------------------------ */

/** Tokens úteis (sem stopwords), reduzidos à raiz e com sinônimos unificados. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of normalize(s).split(" ")) {
    if (!raw || raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    const t = canonical(stem(raw));
    if (t.length < 2) continue;
    out.push(t);
  }
  return out;
}

export function uniqueTokens(s: string): string[] {
  return [...new Set(tokenize(s))];
}

/** Chave estável para agrupar perguntas parecidas. */
export function topicKey(s: string): string {
  const toks = uniqueTokens(s).sort();
  return toks.slice(0, 4).join(" ");
}
