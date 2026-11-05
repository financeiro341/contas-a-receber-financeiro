"""Compara o relatório de cobrança das 17h (Chrome) com o paralelo (Supabase) de um dia.

Uso: python3 -I compara_relatorios.py atual.json paralelo.json [confirmados.json] > resultado.json
     confirmados.json (opcional): [["nome no das 17h", "nome no paralelo"], ...] pares fracos conferidos.

Lê os dois dia.json (mesmo esquema, v8) e devolve um JSON com os números, os clientes que só um deles
contou, os status diferentes e o veredito "bate". Critérios (definidos em 05/11/2026 para a troca da
fonte do relatório das 17h, pedido do Marcus):
  1. cobrados: diferença de no máximo 5% (ou 3 clientes, o que for maior);
  2. clientes em comum: pelo menos 90% da união dos dois;
  3. mesmo status: pelo menos 90% dos clientes em comum;
  4. responderam (com interação): diferença de no máximo 3.
Ligações não entram no veredito: a fonte nova conta pelo botão do sistema e pelo Chrome, a antiga só pelo
Chrome (decisão do Marcus de 05/11/2026), então a diferença é esperada e vai só como informação.
Só leitura: não grava nada, não manda nada.
"""
import json
import sys
import unicodedata


def norm(t):
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode().lower()
    for x in ("-", ".", ",", "&", "'", '"', "|", ":"):
        t = t.replace(x, " ")
    return " ".join(t.split())


# Palavras que não identificam ninguém (tipo de empresa, setores, cargos, ligações).
VAZIAS = set("""ltda eireli epp me sa s a cia comercio comercial servicos servico industria e de da do das dos
financeiro financeira fin adm administrativo dp rh contabil contabilidade grupo empresa empresas loja lojas sr sra
dona seu dra dr filial matriz transportes transporte logistica distribuidora importacao atacado varejo""".split())


def _tokens(t):
    # Palavras longas comparadas pelas 8 primeiras letras ("brasautomotivo" e "brasautomotive" são a mesma).
    return {w[:8] for w in norm(t).replace("/", " ").replace("(", " ").replace(")", " ").split() if len(w) >= 3 and w not in VAZIAS}


def partes(c):
    """(pessoa, empresa): o nome "Fulano - Empresa" vira duas partes; sem " - ", tudo conta como empresa também."""
    nome = str(c.get("nome") or "")
    emp = set().union(*[_tokens(e) for e in (c.get("empresas") or [])]) if c.get("empresas") else set()
    if " - " in nome:
        pessoa, resto = nome.split(" - ", 1)
        return _tokens(pessoa), emp | _tokens(resto)
    t = _tokens(nome)
    return t, emp | t


def casar(atual, paralelo, confirmados=()):
    """Casa cada cliente do relatório das 17h com um do paralelo pelas palavras do nome e da empresa.
    O das 17h usa o nome salvo no celular ("Bruno - Britto e Menezes"); o paralelo usa "Nome - EMPRESA".
    Par forte: alguma palavra da parte da empresa em comum, ou duas palavras em comum. Par fraco (só um
    primeiro nome ou sobrenome em comum, como "Rafael" e "Rafael"): não conta, a menos que esteja em
    `confirmados` (lista de [nome no das 17h, nome no paralelo] conferida por quem compara)."""
    conf = {(norm(a), norm(b)) for a, b in confirmados}
    pa = [partes(c) for c in atual]
    pp = [partes(c) for c in paralelo]
    nota = {}
    for i, (pa_p, pa_e) in enumerate(pa):
        for j, (pp_p, pp_e) in enumerate(pp):
            comum = (pa_p | pa_e) & (pp_p | pp_e)
            if not comum:
                continue
            forte = bool(pa_e & pp_e) or len(comum) >= 2
            if (norm(atual[i].get("nome")), norm(paralelo[j].get("nome"))) in conf:
                forte = True
            nota[(i, j)] = (2 if forte else 0) + len(pa_e & pp_e) + len(comum) / 10 + sum(len(w) for w in comum) / 1000, forte
    pares, fracos, usados_a, usados_p = [], [], set(), set()
    for (i, j), (_, forte) in sorted(nota.items(), key=lambda x: -x[1][0]):
        if i in usados_a or j in usados_p:
            continue
        usados_a.add(i); usados_p.add(j)
        (pares if forte else fracos).append((atual[i], paralelo[j]))
    for a, b in fracos:  # par fraco não conferido: fica dos dois lados como "só em um"
        usados_a.discard(atual.index(a)); usados_p.discard(paralelo.index(b))
    so_atual = [c for i, c in enumerate(atual) if i not in usados_a]
    so_paralelo = [c for j, c in enumerate(paralelo) if j not in usados_p]
    return pares, fracos, so_atual, so_paralelo


def resumo_cliente(c):
    return {"nome": c.get("nome"), "empresa": (c.get("empresas") or [None])[0], "status": c.get("status")}


def comparar(a, p, confirmados=()):
    ca, cp = a.get("clientes") or [], p.get("clientes") or []
    pares, fracos, so_a, so_p = casar(ca, cp, confirmados)
    st = lambda c: c.get("status")
    iguais = [x for x in pares if st(x[0]) == st(x[1])]
    difs = [{"nome_atual": x[0].get("nome"), "nome_paralelo": x[1].get("nome"), "atual": st(x[0]), "paralelo": st(x[1])} for x in pares if st(x[0]) != st(x[1])]
    uniao = len(pares) + len(so_a) + len(so_p)
    ra, rp = a.get("resumo") or {}, p.get("resumo") or {}
    n_a, n_p = len(ca), len(cp)
    tol = max(3, round(0.05 * max(n_a, n_p)))
    crit = {
        "cobrados": abs(n_a - n_p) <= tol,
        "em_comum": uniao == 0 or len(pares) / uniao >= 0.90,
        "mesmo_status": not pares or len(iguais) / len(pares) >= 0.90,
        "responderam": abs((ra.get("com_interacao") or 0) - (rp.get("com_interacao") or 0)) <= 3,
    }
    return {
        "dia": a.get("data") or p.get("data"),
        "periodo": {"atual": a.get("periodo"), "paralelo": p.get("periodo")},
        "status": {"atual": a.get("status"), "paralelo": p.get("status")},
        "numeros": {
            "cobrados": {"atual": n_a, "paralelo": n_p, "tolerancia": tol},
            "responderam": {"atual": ra.get("com_interacao"), "paralelo": rp.get("com_interacao")},
            "em_comum": len(pares), "uniao": uniao,
            "pct_em_comum": round(100 * len(pares) / uniao, 1) if uniao else 100.0,
            "mesmo_status": len(iguais),
            "pct_mesmo_status": round(100 * len(iguais) / len(pares), 1) if pares else 100.0,
            "ligacoes": {"atual": (ra.get("lig_atendidas") or 0) + (ra.get("lig_nao_atendidas") or 0), "paralelo": (rp.get("lig_atendidas") or 0) + (rp.get("lig_nao_atendidas") or 0)},
        },
        "criterios": crit,
        "bate": all(crit.values()) and a.get("status") == "completo" and p.get("status") == "completo",
        "so_no_atual": [resumo_cliente(c) for c in so_a],
        "so_no_paralelo": [resumo_cliente(c) for c in so_p],
        "status_diferente": difs,
        "pares": [[x[0].get("nome"), x[1].get("nome")] for x in pares],
        "pares_fracos_para_conferir": [[x[0].get("nome"), x[1].get("nome")] for x in fracos],
    }


if __name__ == "__main__":
    atual = json.load(open(sys.argv[1], encoding="utf-8"))
    paralelo = json.load(open(sys.argv[2], encoding="utf-8"))
    confirmados = json.load(open(sys.argv[3], encoding="utf-8")) if len(sys.argv) > 3 else []
    json.dump(comparar(atual, paralelo, confirmados), sys.stdout, ensure_ascii=False, indent=1)
