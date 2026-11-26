# Modernização do Blulivro

## Diagnóstico e decisões

A aplicação já usa Firebase Authentication, perfis em `perfis/{uid}` e transações do Firestore para registrar bipes e atualizar contagens. A importação original publica catálogos por seção em cada lista. A fila de leitura residia na memória e o cronômetro dependia da aba. Os novos módulos mantêm Firebase e o fluxo existente de conferência.

As mudanças foram divididas em continuidade e segurança, catálogo e TCL, Furos e administração. Novos dados usam coleções próprias. Os registros existentes de conferência não precisam ser convertidos. Os bipes antigos seguem legíveis e entram no relatório conforme os horários que já tinham.

## O que está disponível

- A bipagem entra no IndexedDB por conta antes de aparecer como pendente. O mesmo identificador é usado no reenvio, na contagem e no recibo do Firestore. O recibo é gravado na mesma transação e permanece quando o supervisor retira um bipe individual. O fechamento avisa sobre bipes pendentes encontrados no navegador atual.
- O cronômetro usa as confirmações do Firestore por conta e lista. Entre bipes, conta até 40 segundos sem nova leitura. Pausar, sair da ferramenta e trocar de lista registram uma parada quando o navegador consegue gravá-la. Se ele fechar abruptamente, o limite de 40 segundos continua valendo. O relatório guarda tempo ativo, decorrido, inativo e ritmo ativo dos operadores.
- O login mantém as permissões no Firestore. Sem **Lembre-se de mim**, o Firebase usa persistência de sessão do navegador. Com a opção marcada, o login persiste até o prazo máximo configurado. A aba encerra a sessão após 30 minutos de inatividade. O limite absoluto é verificado no Firestore, com padrão de sete dias e ajuste de 1 a 30 dias em **Configurações**.
- A tela **Ferramentas** abre Conferência, TCL e Furos. Em **Configurações → Fonte de dados**, o administrador publica um catálogo do Dauer para cada unidade, com prévia e histórico. A nova versão só se torna visível depois que as partes forem salvas. Uma atualização mantém os produtos ausentes do novo arquivo e conserva campos anteriores quando a planilha não os informa.
- O TCL pesquisa pelo título, autor, ISBN, código, editora ou categoria. Um leitor que envia Enter abre a ficha do código localizado na unidade selecionada.
- Furos preenche os campos disponíveis do catálogo pelo ISBN ou código. Quando o item consta em várias unidades, a loja selecionada determina o saldo do sistema e a localização. O estoque físico vem da contagem. Operadores registram, enquanto supervisores e administradores editam e registram as duas conferências. Arquivar mantém o registro e as alterações.
- **Conferência** reúne a visão geral e a seleção de listas. Cada lista oferece **Bipar**, **Resumo** e acesso a **Sessões** junto ao título. O resumo e seus relatórios usam a lista e os filtros selecionados. O administrador encontra **Editar lista** junto de **Limpar sessões vazias**.
- A conferência pode usar a versão publicada do Dauer para montar a lista. A aplicação gera uma prévia com os saldos por sessão e mantém a versão selecionada até a conclusão da importação. Uma publicação posterior fica disponível para novas prévias. Arquivar preserva as contagens e libera uma das quatro vagas. A restauração libera a lista para novos bipes.

## Dados e publicação

| Caminho novo | Uso |
| --- | --- |
| `abas/{lista}/atividadeBipagem/{evento}` | Recibos de bipes e paradas, com horário do servidor |
| `catalogosDauer/{unidade}/versoes/{versao}/partes/{parte}` | Versões publicadas e partes do catálogo |
| `furos/{id}/alteracoes/{evento}` | Histórico de inclusão, estados, estoques e conferências |
| `configuracao/sessao` | Prazo máximo absoluto da sessão |

Publique em homologação com o `firestore.rules` incluído. Preserve as regras de outros aplicativos se o projeto Firestore for compartilhado. O primeiro administrador e os perfis seguem os passos do LEIA-ME. No catálogo, use um XLS/XLSX tabular identificado por título e ISBN, código de barras ou código interno. O importador também aceita o relatório de localização do Dauer já utilizado pela conferência. Homologue os nomes das colunas com os arquivos que serão usados pela equipe.

## Limites desta entrega

- Uma leitura offline só fica acessível em outro aparelho depois da confirmação no Firestore. A perda ou limpeza do armazenamento do navegador antes da sincronização também elimina essa fila local. Um fechamento em outro dispositivo não consegue detectar o que ainda está offline.
- O cronômetro usa o horário de confirmação do servidor. Bipes enviados em lote após uma queda podem ficar concentrados no horário da reconexão. O tempo ativo é recuperado por operador. A pausa manual continua vinculada ao acesso local.
- Login e logout usam o Firebase Authentication no navegador. A inatividade é aplicada na interface. A revogação imediata de tokens de todos os dispositivos, cookies de sessão controlados pelo servidor e um serviço de sessões revogáveis exigem uma camada de servidor.
- A integração SQL está sem conexão e sem credenciais. A separação do repositório de consulta permite acrescentar um conector real de leitura, com credenciais mantidas no servidor.
- A conferência mantém a opção de importação avulsa. Catálogos antigos com várias localizações e apenas saldo agregado aparecem em **Localização a revisar**. O painel administrativo cruzado por período, unidade, operador e lista fica pendente.

## Verificação

Os testes de integração devem rodar com Auth e Firestore emuladores em localhost. O roteiro cobre fila offline, reabertura, reenvio idempotente, cronômetro, retomada em outro navegador, catálogo, consulta TCL, Furos, sessão e administração. Antes de trocar a versão de produção, teste a migração com os arquivos Dauer da operação e os dispositivos usados pela equipe.
