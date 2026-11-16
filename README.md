# Monitor do Sistema

Extensão compacta para a barra superior do Ubuntu / GNOME 50, com rede, CPU,
memória e espaço ocupado em disco. Clique no indicador para escolher o que mostrar.
Ícones identificam cada indicador, sempre acompanhados dos números. No menu
**Aparência**, escolha ícones, texto ou ambos e ajuste o tamanho de cada um.
As cores diferenciam os indicadores; uso alto de CPU, RAM ou disco recebe destaque
em âmbar/vermelho. As cores também podem ser desligadas nesse menu.

Em **Abrir monitor de tráfego**, acompanhe conexões TCP/UDP, processos, IPs e
portas em uma janela própria, com busca, gráfico da interface, pausa e contadores
TCP disponíveis. Não requer Node.js, sudo ou captura de pacotes.

Exemplo com identificação por texto:

```text
↓4,2M/s ↑350K/s CPU12% RAM48% D180G
```

Instale ou atualize a extensão local:

```bash
python3 instalar-monitor-sistema.py
```

O instalador usa o pacote deste projeto, faz backup da versão instalada e mantém
as configurações de rede. Se já estiver instalada, saia da sessão do Ubuntu e
entre novamente para carregar o código atualizado. Salve seu trabalho antes.

- [Código, opções e funcionamento](monitor-sistema/README.md)
- [Verificações da versão](monitor-sistema/VALIDACAO.md)
- [Pacote instalável](monitor-sistema/dist/medidor-rede@gezer.local.shell-extension.zip)

Use `instalar-monitor-sistema.py` como única entrada para instalar ou atualizar.
O código, o pacote e os testes ficam em `monitor-sistema/`, sem cópias duplicadas.
O instalador faz backup da versão instalada quando houver e salva a ativação para
o próximo login.
