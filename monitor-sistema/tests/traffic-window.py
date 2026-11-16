"""Run inside the isolated GNOME session; exercises real loopback and GTK."""
import importlib.util
import os
from pathlib import Path
import socket
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'extension'))
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Adw, Gio, GLib
from traffic import read_connections

spec = importlib.util.spec_from_file_location('traffic_window',
    Path(__file__).resolve().parents[1] / 'extension' / 'traffic-window.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

count = 0
failed = False


def check(condition, message):
    global count
    count += 1
    if not condition:
        raise AssertionError(message)


server = socket.socket()
server.bind(('127.0.0.1', 0))
server.listen(1)
port = server.getsockname()[1]
client = socket.create_connection(('127.0.0.1', port))
peer, _address = server.accept()
client.sendall(b'x' * 8192)
peer.settimeout(2)
received = 0
while received < 8192:
    received += len(peer.recv(8192))
rows = [row for row in read_connections() if row.local.endswith(f':{port}') and row.state == 'ESTAB']
check(len(rows) == 1, 'Real loopback socket found')
check(str(os.getpid()) in rows[0].pids, 'Real process/PID found')
check(rows[0].received >= 8192, 'Real TCP received counter found')

app = Adw.Application(application_id='org.gnome.Shell.Extensions.MonitorSistema.Trafego.Test',
                      flags=Gio.ApplicationFlags.NON_UNIQUE)
started = time.monotonic()
stage = 0
window = None
ticks = 0


def activate(application):
    global window
    window = module.TrafficWindow(application)
    window.present()


def exercise():
    global failed, stage, ticks
    try:
        if time.monotonic() - started >= 20:
            raise AssertionError('Window test exceeded 20 seconds')
        if not window or window._busy or not window._connections:
            return GLib.SOURCE_CONTINUE
        if stage == 0:
            check(not window._error.get_visible(), 'Real sensors read without errors')
            window._search.set_text(str(os.getpid()))
            window._protocol.set_selected(1)
            window._render_rows()
            check(window._store.get_n_items() >= 3, 'PID and TCP filters include listener and sockets')
            check(all(window._store.get_item(i).connection.protocol == 'TCP'
                      for i in range(window._store.get_n_items())), 'Protocol filter excludes UDP')
            window._search.set_text('no-connection-matches-this-value')
            window._render_rows()
            check(window._stack.get_visible_child_name() == 'empty', 'Empty filter is explained')
            window._search.set_text('')
            window._protocol.set_selected(0)
            window._render_rows()
            window._show_details(window._table, 0)
            dialogs = [item for item in app.get_windows() if item is not window]
            check(len(dialogs) == 1, 'Connection details dialog opens')
            dialogs[0].close()
            window._pause_button.set_active(True)
            check(window._paused, 'Pause control stops updates')
            before = list(window._connections)
            window._apply_snapshot({'connections': [], 'interfaces': {}, 'errors': []})
            check(window._connections == before, 'Paused window ignores in-flight reads')
            window._pause_button.set_active(False)
            check(not window._paused, 'Resume control restarts updates')
            window._interfaces.set_selected(window._interface_names.index('lo') + 1)
            check(window._interface_tracker.received == 0, 'Changing interface resets accumulated bytes')
            stage = 1
            ticks = 0
            return GLib.SOURCE_CONTINUE
        ticks += 1
        # GLib's second-based timer may coalesce a little after the two-second
        # boundary. Wait for the actual second sample, within the timeout above.
        if ticks < 4 or not any(row.down is not None for row in window._connections if row.protocol == 'TCP'):
            return GLib.SOURCE_CONTINUE
        client.sendall(b'y' * 4096)
        data = peer.recv(4096)
        check(bool(data), 'Loopback remains active during refresh')
        check(window._interface == 'lo', 'Loopback interface selection persists')
        check(window._down_note.get_text() == 'lo', 'Interface card names the measured interface')
        check(any(row.down is not None for row in window._connections if row.protocol == 'TCP'),
              'Second sample produces real TCP rates')
        window._reset()
        check(window._total.get_text() == '0 B', 'Reset clears only this window total')
        window._apply_snapshot({'connections': None, 'interfaces': None,
                                'errors': ['Falha de leitura simulada']})
        check(window._error.get_visible(), 'Read errors are visible')
        check(not window._connections and not window._connection_tracker.previous,
              'Failed reads discard stale sockets and baselines')
        check(window._down.get_text() == 'Indisponível', 'Failed bandwidth is never displayed as zero')
        window.close()
        check(window._closed and window._timer == 0, 'Closing cancels window timer')
        print(f'MONITOR_TRAFEGO_UI_OK: {count} verificações passaram.', flush=True)
        app.quit()
        return GLib.SOURCE_REMOVE
    except Exception as error:
        import traceback
        traceback.print_exc()
        failed = True
        app.quit()
        return GLib.SOURCE_REMOVE


app.connect('activate', activate)
GLib.timeout_add(500, exercise)
try:
    app.run([sys.argv[0]])
finally:
    client.close()
    peer.close()
    server.close()
sys.exit(1 if failed else 0)
