# Verificação da versão 7 — Monitor do Sistema

Validado em 16/11/2026, com GNOME Shell 50.1 e GJS local.

- **30 verificações de rede**: rotas IPv4/IPv6, interface manual, amostragem por
  tempo decorrido, desconexão, troca de interface, reset, totais e unidades.
- **33 verificações de sistema**: CPU agregada sem duplicar guest, deltas,
  resets, RAM disponível, disco usado/livre, limites e unidades compactas.
  Inclui leitura real de CPU, RAM e espaço em disco.
- **30 verificações de GSettings**: defaults, controles individuais, fonte, cores,
  modos de identificação, tamanho dos ícones e seus limites,
  limites do schema e compatibilidade das preferências antigas de rede.
- **78 verificações em GNOME Shell isolado**: carregamento do ZIP, sensores reais,
  ocultação individual, controles sincronizados, acesso com tudo oculto, fonte,
  bytes/bits, modo compacto, acumulado, reset, recuperação após caminho de disco
  inválido e desativação/reativação com leituras em andamento. Inclui cores por
  indicador, controle de cores, limites de alerta e dados indisponíveis em cinza.
  Valida também os seis ícones locais, renderização simbólica, ícones/texto/ambos,
  tamanho imediato, cores herdadas e ocultação conjunta de ícone e número.
  O controle de tamanho aparece no início de Aparência. Os botões − / +
  percorrem 10 a 32 px, de 2 em 2 px, conferindo a preferência salva, o tamanho
  exibido e as dimensões renderizadas. O menu permanece aberto e os botões
  respeitam os limites mínimo/máximo. O schema rejeita 9 e 33 px.
- **19 testes Python de tráfego**: parser TCP/UDP e IPv4/IPv6, processos/PIDs,
  filtros, contadores indisponíveis, tempo decorrido, sockets novos/fechados,
  resets, desconexão/troca de interface, rotas, falhas e ausência do comando ss.
- **21 verificações de janela GTK com conexão TCP local real**: identifica
  socket e processo/PID, confere bytes recebidos, filtros por PID/protocolo,
  busca vazia, detalhes, pausa/retomada, escolha de interface, taxas reais,
  reset, tratamento de erro e cancelamento do temporizador ao fechar.
  A integração GNOME abre a janela pelo menu, confirma uma única instância
  em ativações repetidas e fecha a janela antes do teste GTK.
- Sintaxe JavaScript/Python/Bash e schema estrito validados.
- ZIP gerado pelo `gnome-extensions pack` com os dois módulos JavaScript, os
  módulos Python `traffic.py`/`traffic-window.py` e os seis SVGs em `icons/`.
  Os SVGs e o conteúdo completo do ZIP foram validados.
  A instalação pelo test tool compilou o schema e carregou o pacote corretamente.
- Captura visual inspecionada: fonte de 10 px, ícones de 12 px, espaçamento de
  3 px entre indicadores e 2 px entre ícone e número. Sem largura mínima fixa;
  cinco indicadores usaram 216 px na amostra real após reativação.
- Janela de tráfego inspecionada visualmente em 1280×720, com tabela rolável,
  filtros, cartões, gráfico e limites de dados disponíveis indicados no rodapé.
  Não exige Node.js, captura de pacotes ou privilégios de administrador.

Total: **211 testes/verificações**. O caso de disco inválido gera uma mensagem de erro
intencional durante o teste e confirma que os demais sensores continuam ativos.
O teste usa D-Bus e diretórios XDG isolados; não altera as preferências reais.

A instalação local é conferida comparando fontes e schema compilado.
O instalador cria backups em `backups/anterior-…/` antes de futuras atualizações.
As cópias duplicadas, os logs antigos e os backups v1/v2 foram removidos na limpeza
do projeto, mantendo somente as fontes, o pacote e os testes da versão atual.
O GNOME que já está em execução mantém o código antigo em memória: é preciso salvar o trabalho,
sair da sessão e entrar novamente. Não foi feito logout automático.
