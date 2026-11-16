# Monitor do Sistema

Extensão local para a barra superior do Ubuntu com GNOME 50. Monitora a rede,
o processador, a memória RAM e o espaço ocupado no disco. Não requer internet
ou privilégios de administrador durante o uso.

O padrão mostra ícones + números. Exemplo com identificação por texto, no modo
compacto: `↓4,2M/s ↑350K/s CPU12% RAM48% D180G`.

Os números têm **10 px**, os indicadores ficam separados por **3 px** e não
reservam largura fixa. Clique no monitor para abrir o menu:

- **Mostrar na barra**: ligue/desligue download, upload, CPU, RAM, disco e rede
  acumulada individualmente. Os detalhes continuam disponíveis no menu.
  Se desligar tudo, um pequeno `•` mantém o acesso às configurações.
- **Abrir monitor de tráfego**: abre uma janela nativa com conexões TCP/UDP,
  aplicativos/processos e PIDs disponíveis, estado, IP local/remoto e portas.
  A busca aceita processo, PID, IP e porta; o seletor filtra TCP/UDP. Duplo
  clique abre os detalhes, com opção para copiar. Cliques repetidos no menu
  apresentam a mesma janela.
  Os cartões e o gráfico mostram a velocidade da **interface selecionada**;
  a tabela mostra conexões de **todas as interfaces**. Automática escolhe uma
  interface pela rota padrão; também é possível escolher uma manualmente.
  O acumulado começa ao abrir a janela e pode ser zerado; trocar a interface
  reinicia esse acumulado. Ele é independente do acumulado da barra.
  A atualização ocorre a cada 2 segundos e pode ser pausada. Enquanto pausada,
  a janela não contabiliza tráfego; ao retomar, estabelece uma nova amostra base.
  Fechar a janela interrompe suas leituras.
  Taxas por conexão e totais são **TCP**, quando fornecidos pelo sistema; os
  totais contam desde a abertura do socket e as taxas exigem duas amostras.
  UDP mostra IPs, portas e processo, com `—` nos contadores indisponíveis.
  Conexões que abrem e fecham entre amostras podem não aparecer. Processos de
  outros usuários podem ficar indisponíveis. Não captura pacotes, não decifra
  HTTPS/TLS, não faz consultas externas nem grava histórico.
- **Aparência**: modo compacto ou espaçado, fonte de 9 a 14 px e cores opcionais.
  Em **Identificação dos indicadores**, escolha **Ícones + números** (padrão),
  **Texto + números** ou **Ícones, texto e números**. Os números continuam
  visíveis em todos os modos. No início de **Aparência**, use **− / +** em
  **Tamanho dos ícones** para ajustar de **10 a 32 px**, de 2 em 2 px;
  o padrão é 12 px. O tamanho atual aparece entre os botões e muda imediatamente,
  sem fechar o menu. Role a lista para ver as outras opções abaixo.
  Ícones e texto têm tamanhos independentes.
  Os seis SVGs acompanham o pacote, sem depender de ícones instalados no tema.
  Download azul, upload verde, CPU verde-claro, RAM lilás e disco ciano.
  CPU a partir de 70% e RAM/disco a partir de 80% ficam em âmbar;
  a partir de 90%, ficam vermelhos. Dados indisponíveis aparecem em cinza.
  Desligar **Cores dos indicadores** restaura a cor padrão do tema.
- **Rede acumulada da sessão**: recebido, enviado e reset. O indicador opcional
  `Σ` mostra a soma recebida + enviada. Começa em zero ao ativar a extensão ou
  zerar os contadores; sair da sessão ou desativar também reinicia esse acumulado.
- **Interface de rede**: automática pela rota padrão ou escolha manual.
- **Disco monitorado**: sistema (`/`) ou pasta pessoal. Se ambos estiverem na
  mesma partição, os números são iguais. Mostra o uso do sistema de arquivos
  que contém o caminho, e não o tamanho isolado da pasta.
- **Velocidade em bits/s**: altera só a velocidade da rede. Acumulados e disco
  continuam em bytes. Todas as opções são salvas automaticamente.

Aqui, **disco acumulado significa espaço atualmente ocupado**: `D180G` indica
180 GB usados. O menu detalha usado, total, percentual e livre. Não é um contador
de leituras/gravações e não é zerado pela ação de reset da rede.

## Instalar ou atualizar

Na raiz do projeto:

```bash
python3 instalar-monitor-sistema.py
```

Ou dentro desta pasta:

```bash
bash instalar.sh
```

O ZIP já está incluído em `dist/`. Não há downloads nem sudo. Antes de atualizar,
o instalador copia a versão instalada para `backups/anterior-…`. A atualização
requer sair da sessão e entrar novamente para carregar os novos módulos do GNOME.
Uma primeira instalação pode também precisar de um novo login para ser reconhecida.
Não é necessário reiniciar o computador. O instalador não encerra sua sessão.

A janela usa **Python 3 + PyGObject, GTK 4, libadwaita e ss (iproute2)**,
presentes nesta instalação do Ubuntu/GNOME. O instalador confere essas
dependências antes de atualizar. **Node.js não é necessário.**
Para abrir a janela diretamente, sem aguardar o novo login:

```bash
python3 extension/traffic-window.py
```

O produto foi renomeado de **Medidor de Rede** para **Monitor do Sistema**.
O UUID `medidor-rede@gezer.local` e o schema
`org.gnome.shell.extensions.medidor-rede` são mantidos intencionalmente para
atualizar a instalação existente sem duplicação nem perda das preferências.
O pacote usa esse UUID, como exige o instalador do GNOME.

Desativar: `gnome-extensions disable medidor-rede@gezer.local`.
Remover: `gnome-extensions uninstall medidor-rede@gezer.local`.

## Medição e consumo

- Rede: `/proc/net/dev` a cada segundo; diferenças de bytes divididas pelo tempo
  monotônico decorrido. O modo automático escolhe uma rota padrão IPv4 de menor
  métrica, com IPv6 como alternativa. Loopback é ignorado; uma interface por vez
  evita dupla contagem em redes virtuais. Para VPNs com rotas divididas, escolha
  manualmente a interface desejada.
- CPU: diferença dos tempos agregados de `/proc/stat`, entre 0 e 100% do conjunto
  de núcleos. A primeira amostra estabelece a base e mostra `—`; guest não é
  contado duas vezes e idle/iowait não entram como processamento ativo.
- RAM: `MemTotal - MemAvailable` em `/proc/meminfo`; memória recuperável pelo
  kernel permanece disponível. O menu também mostra os valores absolutos.
- Disco: consulta assíncrona de tamanho e espaço livre via Gio a cada 10 segundos.
  Não percorre pastas nem executa `du`. Cada sensor trata seus próprios erros.

As leituras são assíncronas, sem comandos externos no ciclo de atualização.
A extensão impede ciclos sobrepostos e cancela leituras ao desativar. Ocultar
indicadores controla a exibição; a medição continua para manter os detalhes do
menu e os acumulados de rede atualizados.

As velocidades incluem tráfego local da interface; não são um teste da velocidade
contratada. Unidades de bytes usam base decimal (1000): `K`, `M`, `G` compactam
KB, MB, GB. `Mb/s` significa megabits/s. A RAM é convertida dos KiB do kernel
para bytes antes da formatação decimal. Não há envio de dados nem histórico em disco.

## Desenvolvimento e testes

```bash
bash empacotar.sh
```

Executa os testes dos cálculos, leituras reais de CPU/RAM/rede/disco, GSettings
e análise de conexões/cálculo de taxas. Valida o schema e recria o ZIP incluindo
`network.js`, `system.js`, `icons/`, `traffic.py` e `traffic-window.py`.

Teste de integração em GNOME isolado, sem alterar a sessão principal:

```bash
dbus-run-session -- gnome-shell-test-tool --headless \
  --extra-filter org.gnome.Shell.Extensions.MonitorSistema.Trafego \
  --extra-filter org.gnome.Shell.Extensions.MonitorSistema.Trafego.Test \
  --extension "$PWD/dist/medidor-rede@gezer.local.shell-extension.zip" \
  "$PWD/tests/shell.js"
```

O teste também grava `/tmp/monitor-sistema-preview.png` e
`/tmp/monitor-trafego-preview.png`. Valida a abertura pelo menu, instância única,
conexão TCP local real, processo/PID, filtros, pausa, reset, detalhes e falhas de
leitura. Requer suporte a uma
sessão gráfica virtual. O [guia do GNOME 50](https://gjs.guide/extensions/upgrading/gnome-shell-50.html)
documenta a instalação de extensões pelo test tool. As consultas de disco seguem
[a API assíncrona Gio](https://docs.gtk.org/gio/method.File.query_filesystem_info_async.html).
Os cálculos de CPU e RAM seguem [a documentação do kernel](https://www.kernel.org/doc/html/v6.7/filesystems/proc.html).
