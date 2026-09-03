# ADR 0007 — Calibração da classificação: a regra nasce da decisão, com escopo exato

Status: aceito · Não implantado em produção · Data: 2026-09

Estende o ADR 0001 #5 (classificação determinística, nunca por adivinhação) e o
ADR 0005 (a fila é o protocolo de decisão). O 0001 definiu que sem regra a linha
vai para a fila. Este ADR define a pergunta seguinte: **como uma decisão tomada
na fila vira regra — e quando ela não deve virar.**

---

## Contexto

O primeiro ciclo mensal real deixou 80 pendências de classificação em 19 grupos.
Resolvê-las uma a uma todo mês é trabalho manual que se repete; transformá-las em
regra automática é o objetivo. O risco não é o esforço: é a regra errada nascer
calada e classificar sozinha, todo mês, algo que ninguém aprovou.

Duas propostas minhas foram recusadas durante o desenho, e as duas recusas são a
razão de este documento existir:

1. **Identificador numérico do extrato como identidade de contraparte.** No
   relatório do próprio mês, um mesmo código aparecia associado a três pessoas
   diferentes, e uma mesma pessoa aparecia sob dois códigos. Agrupar por ele
   fundiria pessoas distintas sob uma decisão só.

2. **`CONTEM` sobre o nome da contraparte.** Aprovar um grupo de **1**
   transação de um nome que é prefixo de outro capturaria **28** transações,
   porque o nome aprovado é substring de um nome maior. Vinte e sete linhas
   classificadas sem decisão humana.

Ambas as propostas *pareciam* razoáveis e eram silenciosamente erradas. É esse o
modo de falha que o desenho abaixo recusa.

---

## 1. A assinatura segura é a unidade de decisão

**Decisão.** Toda calibração opera sobre

```
assinatura = TIPO_OPERACAO | CONTRAPARTE_LITERAL | DIRECAO
```

Nenhum dígito entra na chave: todo bloco numérico é removido antes de compor a
contraparte. Ruído estrutural do extrato sai por palavra inteira, nunca por
substring.

**Porquê.** Identificador numérico do banco não é identidade de contraparte
enquanto sua unicidade não for provada — e a evidência do primeiro mês prova o
contrário. Removê-lo faz duas ocorrências do mesmo pagador convergirem para a
mesma decisão, e impede que um código compartilhado funda pagadores diferentes.

**Custo aceito.** Duas grafias da mesma entidade ("MERCADINHO XPTO" e
"MERCADINHO XPTO LTDA") são duas assinaturas e pedem duas decisões. Fundi-las é
julgamento humano; o sistema não o faz sozinho.

## 2. A regra usa IGUAL sobre a assinatura, nunca CONTEM sobre o nome

**Decisão.** A regra persistida tem `campo = assinatura`, `operador = IGUAL`,
`valor_referencia = <a assinatura inteira>`. O motor ganhou um único campo
derivado, `assinatura`, calculado pela **mesma função** que agrupa a fila.

**Porquê.** `IGUAL` sobre a chave completa não consegue generalizar: casa o
padrão exato aprovado e nada além dele. `CONTEM` consegue, e foi assim que a
aprovação de 1 item alcançaria 28. Uma regra criada por calibração não pode
alcançar nada além do grupo aprovado.

**Por que a mesma função dos dois lados.** Se o agrupamento e a regra usassem
critérios diferentes, o usuário aprovaria um conjunto e o sistema persistiria
outro — generalização silenciosa por construção.

## 3. Classificar não é aprender: três modos explícitos

**Decisão.** Cada grupo aceita exatamente três respostas:

| Resposta | Efeito |
|---|---|
| `CATEGORIA` | classifica o mês, **não** cria regra |
| `CATEGORIA APRENDER` | classifica e cria a regra |
| `PULAR` | não altera nada |

A persistência é a opção mais cara de digitar, de propósito.

**Porquê.** A mesma contraparte pode ter naturezas financeiras diferentes ao
longo do tempo. Assumir que uma classificação vale para sempre é exatamente a
suposição que produz regra errada. Persistência precisa ser conquistada, não
herdada da primeira decisão.

## 4. Cinco portões para a confiança 1,0

**Decisão.** Uma regra calibrada nasce com `confianca = 1` — ou seja,
classificando sozinha — somente se passar por todos:

| | Portão | Recusa |
|---|---|---|
| P1 | escolha explícita | `PERSISTENCIA_NAO_SOLICITADA` |
| P2 | escopo exato | `ESCOPO_MAIOR_QUE_O_GRUPO` |
| P3 | estabilidade histórica | `HISTORICO_INSTAVEL`, `DIVERGE_DO_HISTORICO` |
| P4 | sem conflito com regra vigente | `CONFLITO_COM_REGRA_VIGENTE` |
| P5 | validações do domínio | `CATEGORIA_NAO_CANONICA` |

Reprovar num portão **não** cancela a decisão do mês: o grupo é classificado
assim mesmo, sem regra. Recusar a regra nunca custa o trabalho já feito.

**Escopo do P2.** `casados` conta quantas **pendências abertas** a regra
candidata alcançaria. Linha já classificada não entra nessa conta: ela é
histórico, e quem a julga é o P3. Medi-la como escopo bloquearia todo
aprendizado a partir do segundo mês.

## 5. Histórico divergente é evidência contra a regra, não a favor

**Decisão.** Três estados de estabilidade, calculados sobre a visão corrente do
ledger (somente leitura):

| Estado | Significado | Efeito |
|---|---|---|
| `INEDITO` | nunca ocorreu | pode aprender |
| `COERENTE` | sempre a mesma categoria | pode aprender **naquela** categoria |
| `INSTAVEL` | categorias divergentes | **nunca** vira regra automática |

Histórico coerente em A com decisão atual B **não** vira regra por simples
confirmação: é sinal de que o padrão é semanticamente instável. A exceção do mês
é permitida; a regra é que não nasce.

**Porquê.** Uma proposta anterior admitia confirmação simples nesse caso. Isso
converteria a exceção de um mês em política permanente — o oposto do que a
divergência indica.

**Como o histórico é computado sem coluna nova.** `Normalize.descricao` é
determinística, então a assinatura de qualquer linha do ledger é derivável de
`descricao_origem`. Verificado em 101 de 101 linhas do primeiro mês real.

## 6. Corrigir uma regra é ato distinto, e exige a palavra CORRIGIR

**Decisão.** Quando existe regra calibrada **ativa** para a assinatura e o
usuário quer outra categoria dali em diante, a resposta é
`CATEGORIA CORRIGIR`. Só ela distingue **exceção atual** de **correção da
regra**: `CATEGORIA` sozinha muda a linha e deixa a regra intacta.

**Porquê.** As duas intenções produzem estados finais opostos e são
indistinguíveis por qualquer inferência. Perguntar é a única saída correta.

**Custo aceito — e limitação conhecida do V1.** `CORRIGIR` só é oferecido
enquanto existir uma pendência aberta daquela assinatura. Depois que a regra
passa a classificar sozinha, não há mais pendência, e a correção da regra pela
tela de calibração deixa de ser alcançável nesse caminho — resta reclassificar a
linha (exceção) pela "Reclassificar movimentação". Uma entrada dedicada para
revisar regras vigentes fica para uma onda posterior; não foi construída agora
para não ampliar o escopo aprovado.

## 7. A vigência começa na movimentação mais antiga do grupo, não na data de hoje

**Decisão.** `vigente_desde` da regra calibrada é a data da linha mais antiga do
grupo aprovado.

**Porquê.** A regra nasce **daquelas** linhas. Se a vigência começasse no dia da
calibração, a regra não classificaria as próprias pendências que a originaram, e
o mês continuaria aberto depois de o usuário já ter decidido.

**Custo aceito.** A regra passa a valer para datas anteriores à sua criação. O
alcance é contido: o reprocessamento só toca item **aberto** da fila, competência
fechada é recusada, e linha já classificada nunca é reescrita.

## 8. A correção de versão é fail-safe e idempotente — não é atômica

**Decisão.** Corrigir uma regra são dois passos, nesta ordem:

1. desativar a versão vigente da identidade (`ativo = FALSE`, `vigente_ate`,
   `observacao`), auditado e persistido por si;
2. só então gravar a nova versão ativa.

A identidade (`CAL-NNNN`) é estável entre versões; a linha antiga permanece na
aba.

**O Google Sheets não oferece atomicidade real entre essas escritas, e o código
não promete nenhuma.** O que se garante é o comportamento na falha: interrompido
entre (1) e (2), o estado é *nenhuma regra ativa para a assinatura* — as
ocorrências caem na fila e o erro é explícito. Repetir a operação inteira
conclui a correção sem duplicar, porque (1) vira no-op e a identidade é
preservada.

**Por que desativar antes de criar.** Duas versões ativas da mesma assinatura em
categorias diferentes produzem `AMBIGUIDADE_REGRAS` — o motor recusa e manda para
a fila. A ordem inversa criaria essa janela; esta ordem falha para o lado seguro.

**Idempotência.** Aprender de novo a mesma categoria devolve `JA_VIGENTE`,
`alterado = false`, sem versão nova.

## 9. A aba de regras continua interna

**Decisão.** `20_REGRAS_CLASSIFICACAO` permanece oculta e fora do submenu
"Abrir entrada". Quem escreve nela é o workflow, por comando explícito.

**Porquê.** A regra é o único artefato que classifica dinheiro sem ninguém
olhando. Edição manual dela contornaria os cinco portões, o versionamento e a
auditoria de uma vez só.

## 10. Regra de semente não é evidência

**Decisão.** As dez regras da semente deixam de ser tratadas como conhecimento
válido: a política aprovada é aposentá-las, inclusive as que parecem coerentes
com a operação real. O workflow `desativarRegras` existe para isso — desativa por
identidade, preserva a linha, é idempotente.

**Nenhuma desativação acontece por instalar código.** Nem `inicializar` nem
"Preparar planilha" desativam regra alguma; a mutação exige comando explícito, em
validação controlada.

**Porquê.** Regra financeira persistente nasce de decisão aprovada ou de
evidência operacional real. Semente é andaime de desenvolvimento, e andaime que
fica de pé vira estrutura por acidente.

---

## Compatibilidade

Nada muda para linhas já classificadas: o ledger é append-only e a correção de
uma regra não reescreve o passado. O motor ganhou um campo derivado
(`assinatura`) e nenhuma coluna nova em nenhuma aba. Snapshots já gravados são
texto imutável e não mudam.
