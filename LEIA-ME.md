# Blulivro · Fase 2

Consulte [MODERNIZACAO.md](MODERNIZACAO.md) para as mudanças, os caminhos de dados e os limites da versão.

## Uso

Abra **Sobre e manual** no menu do site para consultar o propósito do Blulivro e o passo a passo da conferência.
Em **Configurações**, escolha o tema vermelho, branco ou preto. A preferência fica salva no navegador. O histórico de conferências e o log de auditoria ficam na seção **Registros**.

1. Entre com o e-mail e a senha da sua conta. Abra **Conferência** para acompanhar a visão geral e escolher uma lista. Supervisores e administradores criam listas em **Nova lista**. O sistema aceita quatro listas ativas. Finalizar, arquivar ou excluir uma lista libera a vaga.
2. O administrador publica o Dauer por unidade em **Configurações → Fonte de dados**. TCL e Furos pesquisam nessa base. Para preparar a contagem, abra a lista e use **Sessões → Usar catálogo Dauer**. Escolha a unidade, gere a prévia, confira as sessões e confirme. Cada bloco de localização do relatório geral gera uma sessão. A página também aceita importações avulsas.
3. Na lista, selecione **Bipar** para abrir o campo de código e ver o total confirmado. Expanda **Ver progresso por produto e tempo estimado** para acompanhar os detalhes. Abra **Sessões** para buscar pelo nome ou filtrar por bipes e divergências. O nome da sessão aparece ao lado do título da lista. O botão **Tela cheia** destaca o campo de bipagem.
4. Supervisores e administradores finalizam a conferência em **Finalizar e salvar**. Em **Sessões**, administradores encontram **Editar lista** ao lado de **Limpar sessões vazias**. O histórico guarda o resultado e permite baixar a mesma conferência posteriormente.
5. Na lista, use **Resumo** para consultar as contagens e exportar em Excel ou PDF. O relatório segue a lista e os filtros selecionados. Para resultados finalizados, abra **Configurações → Histórico de conferências**. O painel semanal soma os bipes das conferências finalizadas, de segunda a domingo, no horário de São Paulo.

Em **Furos**, informe o ISBN para preencher os dados de produto disponíveis no Dauer. Se houver mais de uma unidade com o mesmo item, escolha a loja para trazer o saldo do sistema e a localização. Registre o estoque físico pela contagem.

O furo aparece na lista assim que o Firebase confirma a gravação. Use **Atualizar registros** para tentar a sincronização novamente. O filtro **Todos os status** inclui os registros arquivados.

No **TCL**, escolha a unidade e pesquise por título, autor, ISBN ou código. Pressione **Enter** após ler um código para abrir a ficha. Você também pode digitar um ISBN e escolher **Consultar ISBN**. A ficha mostra preço de venda, saldo e localização do Dauer. A consulta bibliográfica usa Google Books, Open Library e BrasilAPI, com ISBNdb disponível mediante chave. Quando uma capa está ausente ou falha, a ficha tenta as alternativas por ISBN.

Em **Filtros do catálogo**, combine autor, editora, sessão, gênero e assunto. Autor e editora podem vir do relatório ou da consulta bibliográfica. Gênero e assunto aparecem conforme os ISBNs são consultados. Use **Completar dados por ISBN** para consultar até 20 ISBNs por vez no recorte de busca e sessão. Na ficha, a sinopse aparece quando disponível e **Ver outras unidades** consulta preço, saldo e localização nas demais lojas.

O relatório **Posição do Estoque por Localização** pode trazer **Preço Venda**. Nesse caso, publique o próprio relatório em **Configurações → Fonte de dados**. Se o relatório trouxer somente **Preço Custo** e **Valor Total**, publique um complemento com **ISBN** e **Preço de venda** na mesma unidade. A coluna **URL da capa** também pode complementar produtos existentes. Na prévia, confira a quantidade de produtos com preço de venda.

A prévia mostra exemplos e destaca variações de preço de 30% ou mais e estoques que passaram a zero. No histórico da unidade, **Restaurar** republica o conteúdo da versão selecionada em uma nova versão ativa e mantém o histórico.

Um ISBN com três exemplares esperados aceita três bipes. O quarto recebe **EXCEDIDO**. O mesmo ISBN pode existir em listas diferentes, inclusive em sessões de mesmo nome. Dentro de uma única lista, o cadastro do mesmo ISBN em sessões diferentes recebe **ALERTA** e a leitura fica sinalizada no histórico da lista, sem uma sessão atribuída. Linhas repetidas do mesmo ISBN em uma sessão aparecem em **ALERTA**, com suas quantidades somadas. Reimportar o mesmo arquivo é idempotente. Reimportar uma localização com o mesmo nome substitui o catálogo daquela sessão. Se a alteração mover ou retirar ISBNs de sessões que já têm bipes, o sistema pede confirmação.

## Acompanhar e pausar uma importação

- **Lendo arquivo** e **Validando sessões** mostram o preparo da importação. Durante a gravação, o painel indica o lote atual, quantas sessões foram salvas, quantas já estavam atualizadas e quantas estão pendentes. **Aguardando Firebase** indica que o app espera a resposta do banco.
- Clique em **Pausar após este lote** e aguarde o aviso **Importação pausada**. O lote em andamento termina antes da pausa, e o painel atualiza a contagem de sessões salvas.
- Clique em **Continuar importação** para gravar as sessões pendentes na mesma lista. Após recarregar, abra **Catálogo na conferência** no mesmo navegador e com o mesmo acesso para recuperar o rascunho, a versão escolhida e o progresso.
- Se aparecer **Importação com pendências**, consulte o registro da importação para ver quais sessões precisam de atenção.

## Cronômetro e câmera na bipagem

O cronômetro no canto superior direito começa na primeira bipagem confirmada. **Pausar** congela o tempo e suspende a bipagem. **Retomar** continua do valor acumulado. O tempo é registrado por lista e operador com base nos eventos confirmados, com até 40 segundos após a última leitura. Sair da tela ou ocultar a aba tenta registrar uma parada. Em **Ver ritmo**, o campo **tempo ativo deste operador** mostra a mesma contagem.

No celular, abra o site em HTTPS, toque em **Usar câmera**, permita o acesso e centralize o código de barras ISBN-13. O foco contínuo e a lanterna dependem do suporte do aparelho. **ISBN lido** aparece assim que a câmera reconhece o código. **Bipe confirmado** aparece após o registro no Firebase. Para ler outro exemplar igual, afaste o código da faixa e aguarde **Pronto para o próximo exemplar**. O aviso sonoro respeita a opção **Som**.

**Desfazer último bipe** fica disponível por até dois minutos após a confirmação da sua leitura. A contagem é ajustada e a correção fica registrada. As sessões exibem os colegas ativos e a tela avisa quando alguém está na mesma sessão.

## Revisão de divergências

Abra **Divergências**, escolha a lista e filtre por situação ou pesquise por ISBN, título ou sessão. Em **Revisar**, marque uma recontagem ou registre a decisão tomada para resolver a divergência. A revisão registra o nome do operador e a data. Mudanças na quantidade esperada, bipada ou no tipo de divergência fazem o item aparecer como pendente novamente.
Marcações de **Recontagem** feitas nos detalhes de um bipe também aparecem nesta tela.

Em **Resumo → Tratar ISBNs não encontrados**, supervisores podem agrupar os códigos para revisão ou vincular as leituras a um produto e sessão da lista. O vínculo serve para identificar o produto na revisão e mantém a contagem e a leitura original até a decisão da equipe.

O fechamento mostra as quantidades por situação e pede confirmação se houver divergências em aberto. O Excel e o PDF da conferência incluem as decisões registradas na revisão.

## Publicação na Vercel

Extraia o ZIP na raiz do projeto conectado à Vercel, com `index.html`, `vercel.json` e a pasta `api/` no mesmo nível. A Vercel serve o site e executa a função de consulta bibliográfica em `/api/livro`. `GOOGLE_BOOKS_API_KEY` e `ISBNDB_API_KEY` são variáveis opcionais do servidor na Vercel. `ISBNDB_API_KEY` habilita essa fonte para contas com acesso ao ISBNdb. A instalação como aplicativo depende de HTTPS e de um navegador com suporte a PWA. A gravação de bipes e conferências usa a conexão com o Firebase.

A configuração em `app.js` aponta para o Firebase da versão original. O login usa contas individuais por e-mail e senha. Os dados existentes de listas, sessões, bipes e conferências continuam nos mesmos caminhos.

Antes de publicar esta versão na Vercel, aplique `firestore.rules` e `firestore.indexes.json` no Firebase. Dentro da pasta extraída, use `firebase deploy --only firestore:rules,firestore:indexes --project conferencia-blu`. Confira no Firebase Console se os índices de bipagem estão ativos. Em um banco compartilhado, mescle as regras e os índices existentes antes de publicar.

A API bibliográfica exige um perfil ativo e respeita o prazo de login configurado. Se usar outro projeto Firebase, atualize a configuração de `app.js` e defina `BLULIVRO_FIREBASE_PROJECT_ID` na Vercel.

| Caminho | Dados gravados |
| --- | --- |
| `abas/{listaId}/sessoes/{sessaoId}/catalogos/{parteId}` | Catálogo importado por sessão |
| `abas/{listaId}/sessoes/{sessaoId}/contagens/{isbnHash}` | Quantidade bipada por ISBN |
| `abas/{listaId}/revisoes/{divergenciaHash}` | Situação, decisão, operador e data da revisão |
| `conferencias/_controle_listas` | Controle das quatro vagas |
| `conferencias/{listaId}` | Histórico da conferência finalizada |
| `conferencias/{listaId}/partes/{parteId}` | Linhas do relatório arquivado |
| `perfis/{uid}` | Dados de acesso vinculados à conta do Firebase Authentication |

Para sessões antigas, o sistema procura a seção correspondente na base anterior. Quando um ISBN antigo está associado a mais de uma seção, reimporte as planilhas Dauer para recuperar as quantidades de cada sessão. Após publicar, recarregue as abas já abertas pelos operadores para usar a nova bipagem.

## Ativar os perfis no Firebase

| Perfil | Permissões |
| --- | --- |
| **Operador** | Registrar bipes, consultar conferências e solicitar recontagem pelo detalhe de um bipe. |
| **Supervisor** | Também criar listas, importar planilhas, corrigir bipes, decidir sobre divergências, consultar a auditoria e finalizar conferências. |
| **Administrador** | Também gerenciar perfis, excluir listas e sessões e limpar os registros administrativos. |

1. No **Firebase Console**, abra **Authentication → Sign-in method** e habilite **E-mail/senha**. Crie a primeira conta em **Authentication → Users** e copie seu UID.
2. Em **Firestore Database**, crie o documento `perfis/{UID}`. Use `nome` e `email` do administrador como strings, com o e-mail em minúsculas. Use `perfil` com o valor `administrador` e `ativo` como o booleano `true`.
3. Faça o mesmo para as contas que precisam de acesso no dia da migração. Os valores dos outros perfis são `supervisor` e `operador`. Depois da publicação, um administrador pode vincular e desativar perfis em **Configurações → Gerenciar acessos**. A criação da conta e a gestão da senha ficam no Firebase Authentication. Cada pessoa pode usar **Recuperar senha** na tela de login.
4. Conclua as importações que ainda estiverem em rascunho na versão antiga. Esses rascunhos ficam vinculados ao usuário anônimo que os criou. Os lotes já gravados aparecem para as contas com acesso.
5. Revise `firestore.rules` antes de publicar. Se houver outro aplicativo usando o mesmo banco, preserve as regras dele ao mesclar este arquivo. Publique as regras com a conta que administra o Firebase e publique o site na Vercel na mesma janela de atualização. Pelo CLI do Firebase, publique as regras e os índices com `firebase deploy --only firestore:rules,firestore:indexes --project conferencia-blu`.
6. Teste o acesso do primeiro administrador e de um operador. Depois da transição, desative o método **Anônimo** no Firebase Authentication, desde que o projeto seja exclusivo do Blulivro.

## Inventários grandes

- Ao escolher uma lista, os totais são calculados no Firebase. Abra o **Resumo** ou **Ver progresso por produto e tempo estimado** para consultar a contagem detalhada. Use **Atualizar** no painel quando outra pessoa registrar leituras que você quer conferir.
- O **Histórico de bipagem** mostra 50 leituras por página. Selecione uma sessão para restringir o histórico e escolha **Mostrar mais bipes** quando precisar de registros mais antigos.
- A próxima publicação de cada catálogo cria um índice menor para o TCL. A ficha completa é buscada quando você abre o produto. Os catálogos anteriores continuam disponíveis.
- Leituras feitas sem conexão ficam guardadas no mesmo navegador e sincronizam quando a rede volta. A fila também funciona se você abrir outra ferramenta enquanto espera.

A leitura roda em segundo plano. A prévia reutiliza os totais ao buscar ou trocar de página. A prévia e as telas de consulta usam paginação. Os filtros e os relatórios abrangem todos os registros correspondentes. As novas sessões vazias passam a acompanhar bipagens no primeiro registro. Catálogos anteriores continuam acessíveis e podem fazer mais leituras na abertura.

## Presença em operação

Uma aba visível envia presença a cada 30 segundos. O painel deixa de exibir contas após 90 segundos sem sinal, mesmo que a aba feche sem avisar o Firebase. A presença é registrada pelo UID da conta, então a mesma pessoa aparece uma vez mesmo que use mais de um dispositivo.
