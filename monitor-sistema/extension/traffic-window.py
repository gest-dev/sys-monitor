#!/usr/bin/env python3
"""Native, single-instance traffic window launched by the panel extension."""
from collections import deque
import math
import sys
import threading

import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
gi.require_version('Graphene', '1.0')
from gi.repository import Adw, Gdk, Gio, GLib, GObject, Graphene, Gtk, Pango

from traffic import (ConnectionTracker, InterfaceTracker, format_bytes, snapshot)


STATES = {'ESTAB': 'Conectado', 'LISTEN': 'Escuta', 'UNCONN': 'Sem destino',
          'TIME-WAIT': 'Encerrando', 'CLOSE-WAIT': 'Aguardando fechar',
          'SYN-SENT': 'Conectando', 'SYN-RECV': 'Recebendo conexão'}


def label(text='', css=None, **kwargs):
    widget = Gtk.Label(label=text, xalign=0, **kwargs)
    if css:
        widget.add_css_class(css)
    return widget


class ConnectionRow(GObject.Object):
    def __init__(self, connection):
        super().__init__()
        self.connection = connection
        self.cells = {
            'process': f'{connection.process}\nPID {connection.pids}',
            'protocol': connection.protocol,
            'state': STATES.get(connection.state, connection.state),
            'local': connection.local, 'remote': connection.remote,
            'down': format_bytes(connection.down, True),
            'up': format_bytes(connection.up, True),
            'total': f'↓ {format_bytes(connection.received)}\n↑ {format_bytes(connection.sent)}',
        }


class TrafficGraph(Gtk.Widget):
    """GTK snapshot drawing avoids requiring the optional Cairo GI bridge."""
    def __init__(self, history):
        super().__init__(hexpand=True, height_request=80)
        self.history = history
        self.set_accessible_role(Gtk.AccessibleRole.IMG)

    def do_snapshot(self, drawing):
        width, height = self.get_width(), self.get_height()
        history = list(self.history)
        if not history or width <= 0 or height <= 4:
            return
        end = history[-1][0]
        history = [point for point in history if point[0] >= end - 60]
        peak = max(1, *(max(down or 0, up or 0) for _when, down, up in history))
        grid = Gdk.RGBA(red=0.5, green=0.5, blue=0.5, alpha=0.2)
        for fraction in (0.25, 0.5, 0.75, 1):
            drawing.append_color(grid, Graphene.Rect().init(0, fraction * (height - 4) + 2, width, 1))
        for index, color in [(1, (0.2, 0.6, 0.95)), (2, (0.2, 0.75, 0.5))]:
            rgba = Gdk.RGBA(red=color[0], green=color[1], blue=color[2], alpha=1)
            previous = None
            for point in history:
                if point[index] is None:
                    previous = None
                    continue
                x = width * (point[0] - end + 60) / 60
                y = height - 2 - point[index] / peak * (height - 4)
                if previous is not None:
                    px, py = previous
                    drawing.save()
                    drawing.translate(Graphene.Point().init(px, py))
                    drawing.rotate(math.degrees(math.atan2(y - py, x - px)))
                    drawing.append_color(rgba, Graphene.Rect().init(0, -1, math.hypot(x - px, y - py), 2))
                    drawing.restore()
                previous = x, y


class TrafficWindow(Adw.ApplicationWindow):
    def __init__(self, application, reader=snapshot):
        super().__init__(application=application, title='Monitor de tráfego',
                         default_width=1180, default_height=780)
        self._reader = reader
        self._closed = False
        self._busy = False
        self._paused = False
        self._connections = []
        self._connection_tracker = ConnectionTracker()
        self._interface_tracker = InterfaceTracker()
        self._interface_names = []
        self._interface = None
        self._history = deque(maxlen=31)
        self._updating_interfaces = False

        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.set_content(root)
        header = Adw.HeaderBar()
        header.set_title_widget(Adw.WindowTitle(title='Monitor de tráfego',
                                              subtitle='Monitor do Sistema'))
        self._pause_button = Gtk.ToggleButton(icon_name='media-playback-pause-symbolic',
                                              tooltip_text='Pausar atualização')
        self._pause_button.connect('toggled', self._toggle_pause)
        header.pack_end(self._pause_button)
        reset = Gtk.Button(icon_name='edit-clear-all-symbolic', tooltip_text='Zerar acumulado desta janela')
        reset.connect('clicked', lambda _button: self._reset())
        header.pack_end(reset)
        root.append(header)
        body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12,
                      margin_top=12, margin_bottom=16, margin_start=16, margin_end=16)
        root.append(body)

        toolbar = Gtk.Box(spacing=8)
        toolbar.append(label('Interface'))
        self._interfaces = Gtk.DropDown.new_from_strings(['Automática'])
        self._interfaces.connect('notify::selected', self._interface_changed)
        toolbar.append(self._interfaces)
        self._search = Gtk.SearchEntry(placeholder_text='Filtrar por processo, PID, IP ou porta…', hexpand=True)
        self._search.connect('search-changed', lambda _entry: self._render_rows())
        toolbar.append(self._search)
        self._protocol = Gtk.DropDown.new_from_strings(['Todos', 'TCP', 'UDP'])
        self._protocol.set_tooltip_text('Filtrar protocolo')
        self._protocol.connect('notify::selected', lambda *_args: self._render_rows())
        toolbar.append(self._protocol)
        body.append(toolbar)

        metrics = Gtk.Box(spacing=12, homogeneous=True)
        self._down, self._down_note = self._metric(metrics, '↓ Recebendo', 'Aguardando leitura', 'Interface selecionada')
        self._up, self._up_note = self._metric(metrics, '↑ Enviando', 'Aguardando leitura', 'Interface selecionada')
        self._total, self._total_note = self._metric(metrics, 'Transferido nesta janela', '0 B', '↓ 0 B  ·  ↑ 0 B')
        body.append(metrics)
        graph_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        graph_box.append(label('Últimos 60 segundos · azul: recebido · verde: enviado', 'dim-label'))
        self._graph = TrafficGraph(self._history)
        self._graph.set_tooltip_text('Taxas da interface selecionada; o gráfico não é filtrado pela busca de conexões.')
        graph_box.append(self._graph)
        body.append(graph_box)

        self._error = label('', 'error', wrap=True)
        self._error.set_visible(False)
        body.append(self._error)
        self._status = label('Lendo conexões…', 'dim-label')
        body.append(self._status)
        self._store = Gio.ListStore.new(ConnectionRow)
        self._selection = Gtk.SingleSelection.new(self._store)
        self._selection.set_autoselect(False)
        self._selection.set_can_unselect(True)
        self._table = Gtk.ColumnView.new(self._selection)
        self._table.set_show_row_separators(True)
        self._table.connect('activate', self._show_details)
        for title, key, width, expand in [
            ('Aplicativo / PID', 'process', 160, True), ('Protocolo', 'protocol', 78, False),
            ('Estado', 'state', 105, False), ('IP local : porta', 'local', 170, True),
            ('IP remoto : porta', 'remote', 185, True), ('↓ TCP/s', 'down', 90, False),
            ('↑ TCP/s', 'up', 90, False), ('Total TCP', 'total', 110, False),
        ]:
            factory = Gtk.SignalListItemFactory()
            factory.connect('setup', self._cell_setup)
            factory.connect('bind', self._cell_bind, key)
            column = Gtk.ColumnViewColumn.new(title, factory)
            column.set_fixed_width(width)
            column.set_expand(expand)
            column.set_resizable(True)
            self._table.append_column(column)
        self._scroller = Gtk.ScrolledWindow(vexpand=True, hexpand=True, min_content_height=180)
        self._scroller.set_child(self._table)
        self._scroller.add_css_class('card')
        self._empty = Adw.StatusPage(title='Nenhuma conexão encontrada',
                                     description='Altere os filtros ou aguarde novas conexões.',
                                     icon_name='network-wired-symbolic', vexpand=True)
        self._stack = Gtk.Stack(vexpand=True)
        self._stack.add_named(self._scroller, 'table')
        self._stack.add_named(self._empty, 'empty')
        body.append(self._stack)
        body.append(label('As conexões abrangem todas as interfaces. A busca filtra apenas a tabela. '
                          'Dê dois cliques em uma conexão para ver os detalhes.', 'dim-label', wrap=True))
        body.append(label('Taxas por conexão: TCP, quando disponível. UDP aparece sem taxa. '
                          'Processos de outros usuários podem ficar indisponíveis. '
                          'O conteúdo dos pacotes não é capturado.', 'dim-label', wrap=True))
        self.connect('close-request', self._on_close)
        self._timer = GLib.timeout_add_seconds(2, self._tick)
        self._tick()

    @staticmethod
    def _metric(parent, title, value, note):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4,
                      margin_start=14, margin_end=14, margin_top=12, margin_bottom=12)
        box.append(label(title, 'dim-label'))
        number = label(value, 'title-1', ellipsize=Pango.EllipsizeMode.END)
        box.append(number)
        subtitle = label(note, 'dim-label', ellipsize=Pango.EllipsizeMode.END)
        box.append(subtitle)
        frame = Gtk.Frame(child=box, hexpand=True)
        frame.add_css_class('card')
        parent.append(frame)
        return number, subtitle

    @staticmethod
    def _cell_setup(_factory, item):
        item.set_child(label('', ellipsize=Pango.EllipsizeMode.END,
                             margin_start=10, margin_end=10, margin_top=9, margin_bottom=9))

    @staticmethod
    def _cell_bind(_factory, item, key):
        text = item.get_item().cells[key]
        item.get_child().set_text(text)
        item.get_child().set_tooltip_text(text)

    def _tick(self):
        if self._closed:
            return GLib.SOURCE_REMOVE
        if self._busy or self._paused:
            return GLib.SOURCE_CONTINUE
        self._busy = True

        def read():
            try:
                data = self._reader()
            except Exception:
                data = {'connections': None, 'interfaces': None, 'errors': ['Falha ao ler o tráfego local.']}
            GLib.idle_add(self._apply_snapshot, data)

        threading.Thread(target=read, daemon=True, name='monitor-trafego').start()
        return GLib.SOURCE_CONTINUE

    def _apply_snapshot(self, data):
        self._busy = False
        if self._closed or self._paused:
            return GLib.SOURCE_REMOVE
        errors = data['errors']
        self._error.set_text(' '.join(errors))
        self._error.set_visible(bool(errors))
        if data['connections'] is None:
            self._connections = []
            self._connection_tracker.previous.clear()
        else:
            self._connections = self._connection_tracker.sample(data['connections'], data['now'])
        self._render_rows()
        counters = data['interfaces']
        if counters is None:
            self._interface_tracker.previous = None
            self._down.set_text('Indisponível')
            self._up.set_text('Indisponível')
            return GLib.SOURCE_REMOVE
        names = sorted(counters)
        if names != self._interface_names:
            selected = self._selected_interface()
            self._interface_names = names
            self._updating_interfaces = True
            self._interfaces.set_model(Gtk.StringList.new(['Automática'] + names))
            if selected and selected not in names:
                # Keep a disconnected selection explicit rather than silently
                # changing the monitored interface to the automatic choice.
                self._interface_names.append(selected)
                self._interfaces.set_model(Gtk.StringList.new(['Automática'] + self._interface_names))
            self._interfaces.set_selected(self._interface_names.index(selected) + 1 if selected else 0)
            self._updating_interfaces = False
        name = self._selected_interface() or data.get('default_interface')
        if name != self._interface:
            self._interface = name
            self._reset()
        down, up = self._interface_tracker.sample(name, counters, data['now'])
        self._down.set_text(format_bytes(down, True))
        self._up.set_text(format_bytes(up, True))
        description = name if name in counters else 'Interface indisponível'
        self._down_note.set_text(description)
        self._up_note.set_text(description)
        self._render_totals()
        self._history.append((data['now'], down, up))
        self._graph.queue_draw()
        return GLib.SOURCE_REMOVE

    def _selected_interface(self):
        index = self._interfaces.get_selected()
        return self._interface_names[index - 1] if 0 < index <= len(self._interface_names) else None

    def _interface_changed(self, *_args):
        if not self._updating_interfaces:
            self._interface = self._selected_interface()
            self._reset()
            self._tick()

    def _reset(self):
        self._interface_tracker.reset()
        self._history.clear()
        self._graph.queue_draw()
        self._down.set_text('—')
        self._up.set_text('—')
        self._render_totals()

    def _render_totals(self):
        tracker = self._interface_tracker
        self._total.set_text(format_bytes(tracker.received + tracker.sent))
        self._total_note.set_text(f'↓ {format_bytes(tracker.received)}  ·  ↑ {format_bytes(tracker.sent)}')

    def _toggle_pause(self, button):
        self._paused = button.get_active()
        button.set_icon_name('media-playback-start-symbolic' if self._paused else 'media-playback-pause-symbolic')
        button.set_tooltip_text('Retomar atualização' if self._paused else 'Pausar atualização')
        self._connection_tracker.previous.clear()
        self._interface_tracker.previous = None
        if not self._paused:
            self._history.clear()
            self._tick()
        self._render_rows()

    def _render_rows(self):
        if not hasattr(self, '_store'):
            return
        selected = self._selection.get_selected_item()
        key = selected.connection.key if selected else None
        protocol = ['Todos', 'TCP', 'UDP'][min(self._protocol.get_selected(), 2)]
        rows = [row for row in self._connections if row.matches(self._search.get_text(), protocol)]
        rows.sort(key=lambda row: (-(row.down or 0) - (row.up or 0), row.process.casefold(), row.remote))
        self._store.splice(0, self._store.get_n_items(), [ConnectionRow(row) for row in rows])
        for index, row in enumerate(rows):
            if row.key == key:
                self._selection.set_selected(index)
                break
        self._stack.set_visible_child_name('table' if rows else 'empty')
        status = 'Pausado' if self._paused else 'Atualização a cada 2 s'
        self._status.set_text(f'{len(rows)} de {len(self._connections)} conexões  ·  {status}')

    def _show_details(self, _table, position):
        item = self._store.get_item(position)
        if not item:
            return
        row = item.connection
        text = (f'{row.process}\nPID: {row.pids}\nProtocolo: {row.protocol}\n'
                f'Estado: {STATES.get(row.state, row.state)}\n\n'
                f'Local: {row.local}\nRemoto: {row.remote}\n\n'
                f'Recebido TCP: {format_bytes(row.received)}\nEnviado TCP: {format_bytes(row.sent)}\n\n'
                'Totais TCP desde a abertura do socket, quando disponíveis.\n'
                'IPs e portas não identificam o conteúdo ou o serviço com certeza.\n'
                'HTTPS/TLS permanece criptografado; esta janela não captura pacotes.')
        dialog = Adw.MessageDialog.new(self, 'Detalhes da conexão', text)
        dialog.set_application(self.get_application())
        dialog.add_response('copy', 'Copiar detalhes')
        dialog.add_response('close', 'Fechar')
        dialog.connect('response', lambda _dialog, response:
                       self.get_clipboard().set(text) if response == 'copy' else None)
        dialog.set_default_response('close')
        dialog.set_close_response('close')
        dialog.present()

    def _on_close(self, *_args):
        self._closed = True
        if self._timer:
            GLib.source_remove(self._timer)
            self._timer = 0
        return False


class TrafficApplication(Adw.Application):
    def __init__(self):
        super().__init__(application_id='org.gnome.Shell.Extensions.MonitorSistema.Trafego',
                         flags=Gio.ApplicationFlags.DEFAULT_FLAGS)

    def do_activate(self):
        window = self.get_active_window()
        if window is None:
            window = TrafficWindow(self)
        window.present()


if __name__ == '__main__':
    sys.exit(TrafficApplication().run(sys.argv))
