"""Read local socket metadata and counters without capture or elevated access."""
from dataclasses import dataclass, replace
import os
from pathlib import Path
import re
import subprocess
import time


@dataclass(frozen=True)
class Connection:
    protocol: str
    state: str
    local: str
    remote: str
    process: str = 'Processo indisponível'
    pids: str = '—'
    socket_id: str = ''
    received: int | None = None
    sent: int | None = None
    down: float | None = None
    up: float | None = None

    @property
    def key(self):
        return self.protocol, self.local, self.remote, self.socket_id

    def matches(self, query='', protocol='Todos'):
        return (protocol == 'Todos' or self.protocol == protocol) and all(
            part in ' '.join((self.protocol, self.state, self.local, self.remote,
                             self.process, self.pids)).casefold()
            for part in query.casefold().split())


def parse_connections(text):
    """ss -H -tuanpieO; endpoints stay numeric, including bracketed IPv6."""
    connections = []
    for line in text.splitlines():
        fields = line.split(None, 6)
        if len(fields) < 6 or fields[0] not in ('tcp', 'udp'):
            continue
        protocol, state, _recvq, _sendq, local, remote = fields[:6]
        extra = fields[6] if len(fields) == 7 else ''
        owners = re.findall(r'\("((?:\\.|[^"\\])*)",pid=(\d+),fd=\d+', extra)
        names = list(dict.fromkeys(name for name, _pid in owners))
        pids = list(dict.fromkeys(pid for _name, pid in owners))
        cookie = re.search(r'\bsk:([\da-fA-F]+)', extra)
        inode = re.search(r'\bino:(\d+)', extra)
        identity = cookie.group(1) if cookie else (inode.group(1) if inode else '')
        # ss omits zero-valued TCP counters. Only infer zero if TCP_INFO was
        # actually returned (rto is always present for an established socket).
        has_info = protocol == 'tcp' and bool(re.search(r'\brto:', extra))

        def counter(name):
            if protocol != 'tcp':
                return None
            match = re.search(rf'\b{name}:(\d+)', extra)
            return int(match.group(1)) if match else (0 if has_info else None)

        connections.append(Connection(
            protocol.upper(), state, local, remote, ', '.join(names) or 'Processo indisponível',
            ', '.join(pids) or '—', identity, counter('bytes_received'), counter('bytes_sent')))
    return connections


def read_connections():
    try:
        result = subprocess.run(
            ['ss', '-H', '-tuanpieO'], capture_output=True, text=True,
            timeout=3, check=False, env={**os.environ, 'LC_ALL': 'C'})
    except FileNotFoundError as error:
        raise RuntimeError('Comando ss não encontrado. Instale o pacote iproute2.') from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError('A leitura das conexões excedeu 3 segundos.') from error
    if result.returncode or 'Cannot open netlink socket' in result.stderr:
        raise RuntimeError('Não foi possível consultar as conexões de rede nesta sessão.')
    return parse_connections(result.stdout)


class ConnectionTracker:
    def __init__(self):
        self.previous = {}

    def sample(self, connections, now):
        current = {}
        rows = []
        for connection in connections:
            previous = self.previous.get(connection.key)

            def rate(name):
                value = getattr(connection, name)
                if not previous or value is None or not connection.socket_id:
                    return None
                old, before = previous
                old_value = getattr(old, name)
                if old_value is None or now <= before or value < old_value:
                    return None
                return (value - old_value) / (now - before)

            rows.append(replace(connection, down=rate('received'), up=rate('sent')))
            current[connection.key] = connection, now
        # Closed sockets must not survive in either the table or the rate cache.
        self.previous = current
        return rows


def parse_interfaces(text):
    counters = {}
    for line in text.splitlines():
        if ':' not in line:
            continue
        name, values = line.rsplit(':', 1)
        values = values.split()
        if len(values) != 16 or not values[0].isdigit() or not values[8].isdigit():
            continue
        counters[name.strip()] = int(values[0]), int(values[8])
    return counters


def read_interfaces():
    return parse_interfaces(Path('/proc/net/dev').read_text())


def default_interface(counters):
    # Match the panel: lowest-metric IPv4 default, then IPv6, then an available
    # non-loopback interface. Selecting one avoids counting VPN traffic twice.
    routes = []
    for path, ipv6 in (('/proc/net/route', False), ('/proc/net/ipv6_route', True)):
        try:
            for line in Path(path).read_text().splitlines():
                fields = line.split()
                if ipv6 and len(fields) == 10 and fields[0] == '0' * 32 and fields[1] == '00':
                    if int(fields[8], 16) & 1 and not int(fields[8], 16) & 0x200:
                        routes.append((int(fields[5], 16), fields[9]))
                elif not ipv6 and len(fields) >= 8 and fields[1] == fields[7] == '00000000':
                    if int(fields[3], 16) & 1 and not int(fields[3], 16) & 0x200:
                        routes.append((int(fields[6]), fields[0]))
        except (OSError, ValueError):
            continue
        available = [name for _metric, name in sorted(routes) if name in counters and name != 'lo']
        if available:
            return available[0]
    return next((name for name in sorted(counters) if name != 'lo'), None)


class InterfaceTracker:
    def __init__(self):
        self.reset()

    def reset(self):
        self.previous = None
        self.received = 0
        self.sent = 0

    def sample(self, name, counters, now):
        values = counters.get(name)
        previous = self.previous
        self.previous = (name, values, now) if values else None
        if not values or not previous or previous[0] != name or now <= previous[2]:
            return None, None
        elapsed = now - previous[2]
        rx, tx = (max(0, value - old) for value, old in zip(values, previous[1]))
        self.received += rx
        self.sent += tx
        return rx / elapsed, tx / elapsed


def format_bytes(value, rate=False):
    if value is None:
        return '—'
    value = max(0, value)
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    unit = 0
    while value >= 1000 and unit < len(units) - 1:
        value /= 1000
        unit += 1
    number = (f'{value:.1f}' if unit else f'{value:.0f}').replace('.', ',')
    return f'{number} {units[unit]}' + ('/s' if rate else '')


def snapshot():
    """Separate failures so an unavailable socket list does not hide bandwidth."""
    data = {'now': time.monotonic(), 'connections': None, 'interfaces': None, 'errors': []}
    for name, reader in (('connections', read_connections), ('interfaces', read_interfaces)):
        try:
            data[name] = reader()
        except (OSError, RuntimeError) as error:
            data['errors'].append(str(error))
    data['default_interface'] = default_interface(data['interfaces'] or {})
    return data
