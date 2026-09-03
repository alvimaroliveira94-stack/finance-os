# Registros de decisão de arquitetura (ADR)

Índice canônico. Cada ADR registra **decisões técnicas reversíveis** e o porquê
delas — não o que o código faz, mas o que ele recusa fazer e a razão.

Decisões financeiras canônicas (categorias, os sete eventos, as quatro métricas
de trading, regras de estado, provisões e sinais) vieram definidas pelo usuário e
não são objeto destes documentos. A exceção é o ADR 0002, que registra uma
política financeira aprovada explicitamente e que o código implementa como está.

| # | Título | Status | Escopo |
|---|---|---|---|
| [0001](0001-arquitetura-nucleo.md) | Arquitetura do núcleo do Finance OS | aceito | 25 decisões das ondas 1 (núcleo), 2 (experiência) e da auditoria final |
| [0002](0002-politica-de-cambio.md) | Política de câmbio: a taxa pertence à competência | aceito | Data de referência, cotação efetiva, cache versionado, proteção de período fechado |
| [0003](0003-ciclo-de-vida-de-parametro.md) | Ciclo de vida de um parâmetro de configuração | aceito | Estado `DEPRECIADO`, depreciação sem apagar linha, ausência intencional |
| [0004](0004-entrada-humana.md) | Entrada humana: a planilha oferece conveniência, o código guarda a verdade | aceito | Lista fechada vs. validação, erro nunca silencioso, tabela em vez de formulário |
| [0005](0005-fila-como-protocolo.md) | Fila de revisão como protocolo de decisão | aceito | Pergunta por origem do item, `DESCARTAR`, cancelar não resolve, correção posterior |
| [0006](0006-superficie-operacional.md) | Superfície operacional de quatro abas | aceito | Abas visíveis, navegação por menu, restauração canônica |
| [0007](0007-calibracao-de-classificacao.md) | Calibração da classificação: a regra nasce da decisão, com escopo exato | aceito | Assinatura segura, IGUAL sobre assinatura, três modos, cinco portões, correção fail-safe |

## Como ler

O **0001** cobre o núcleo e para no commit `b5937e3`. Os ADRs **0002 a 0006**
registram as decisões estruturais posteriores à implantação, cada um citando as
decisões do 0001 que estende. Nenhum deles substitui o 0001, e o 0001 não foi
alterado.

Os pares **0005/0006** e **0003/0002** tratam de assuntos vizinhos e foram
mantidos separados de propósito: fila é decisão de domínio e superfície é decisão
de produto; ciclo de vida de parâmetro é configuração e política de câmbio é
regra financeira. Podem evoluir e ser superseded independentemente.

O **0007** é o único ainda não implantado em produção: o código está construído e
testado, e a mutação da planilha real depende de validação controlada.

## Convenção

- Um arquivo por contexto de decisão, numerado sequencialmente e nunca
  renumerado.
- Status: `proposto`, `aceito`, `superseded por NNNN`. ADR aceito não é
  reescrito quando muda de ideia — cria-se um novo que o supersede, e o antigo
  passa a `superseded`.
- Cada decisão traz o **porquê** e o **custo aceito**; alternativas descartadas
  aparecem quando a escolha não é óbvia.
- Registra-se apenas o que foi aprovado e implementado.
