# 🔵 BLUCONTROL
### Gestão, Conferência e Inteligência Operacional

O **BLUCONTROL** é uma solução web desenvolvida para otimizar processos de gestão e conferência de estoque, integrando ferramentas de consulta, monitoramento, controle de divergências e análise operacional.

O sistema centraliza informações e oferece recursos para tornar as operações mais organizadas, rastreáveis e eficientes, conectando dados de estoque às atividades realizadas pelas equipes.

---

## 🎯 Objetivo do projeto

Desenvolver uma plataforma que facilite o controle operacional, reduza inconsistências nos processos de conferência e proporcione maior visibilidade sobre os indicadores e movimentações de estoque.

## ⚙️ Funcionalidades

- **Conferência de estoque:** controle de inventários por listas, sessões e produtos.
- **Leitura de códigos de barras:** bipagem por leitor ou câmera do dispositivo.
- **Gestão de divergências:** identificação, revisão e acompanhamento de inconsistências.
- **Consulta de livros (TCL):** pesquisa de produtos, preços, disponibilidade e localização.
- **Controle de furos:** registro e acompanhamento de diferenças entre estoque físico e sistema.
- **Catálogo Dauer:** importação, atualização e versionamento de informações de estoque.
- **Relatórios:** geração e exportação de dados em Excel e PDF.
- **Auditoria:** histórico de operações e registros de atividades.
- **Gestão de usuários:** autenticação e controle de permissões por perfil.
- **Monitoramento operacional:** acompanhamento de atividades, tempo de execução e produtividade.

## 🛠️ Tecnologias utilizadas

| Tecnologia | Aplicação |
|---|---|
| HTML5 | Estrutura da aplicação |
| CSS3 | Estilização e interface |
| JavaScript | Lógica e funcionalidades |
| Firebase Authentication | Autenticação de usuários |
| Cloud Firestore | Banco de dados em tempo real |
| IndexedDB | Armazenamento local e fila de leituras |
| Vercel | Hospedagem e funções de API |
| PWA | Experiência de aplicação instalável |
| ExcelJS / SheetJS | Manipulação de planilhas |
| jsPDF | Geração de relatórios PDF |
| ZXing | Leitura de códigos de barras |

## 🏗️ Estrutura do projeto

```text
BLUCONTROL/
│
├── api/
│   └── livro.js
│
├── vendor/
│   └── Bibliotecas externas
│
├── index.html
├── app.css
├── app.js
├── acesso.js
├── dados.js
├── camera-bipe.js
├── consultas-conferencia.js
├── catalogo-dauer.js
├── tcl-filtros.js
├── ficha-tcl.js
├── furos.js
├── isbn.js
├── leitor-dauer.js
├── administrar-listas.js
├── relatorios.js
├── revisao.js
├── recursos.js
├── tema.js
│
├── firestore.rules
├── firestore.indexes.json
├── firebase.json
├── vercel.json
├── manifest.webmanifest
└── sw.js
```

## 🔐 Segurança e controle de acesso

O BLUCONTROL utiliza autenticação individual e controle de permissões para organizar o acesso às funcionalidades.

Os perfis disponíveis são:

- **Operador:** execução de atividades operacionais e registros de conferência.
- **Supervisor:** gerenciamento de listas, importações e revisão de divergências.
- **Administrador:** gerenciamento de acessos, configurações e operações administrativas.

As regras de segurança do Firestore controlam as permissões de leitura e gravação dos dados.

## 🚀 Implantação

A aplicação pode ser publicada utilizando a plataforma Vercel, integrada ao Firebase.

Etapas gerais:

1. Configure um projeto no Firebase.
2. Habilite o Firebase Authentication com e-mail e senha.
3. Configure o Cloud Firestore.
4. Atualize as configurações de conexão no projeto.
5. Publique as regras de segurança e os índices do Firestore.
6. Configure o repositório na Vercel.
7. Configure as variáveis de ambiente necessárias para as consultas bibliográficas.
8. Realize os testes de autenticação, permissões e operações.

**Importante:** revise as regras e os índices antes da publicação. Caso o Firebase seja compartilhado com outros sistemas, preserve as configurações existentes.

## 📱 Aplicação

O sistema possui suporte a dispositivos móveis, instalação como Progressive Web App (PWA) e leitura de códigos de barras pela câmera, mediante suporte do navegador e conexão HTTPS.

## 📌 Status do projeto

Projeto em desenvolvimento e evolução contínua, com foco na modernização dos processos operacionais, segurança dos dados e melhoria da experiência dos usuários.

---

**BLUCONTROL** — Tecnologia, controle e eficiência para operações mais inteligentes.
