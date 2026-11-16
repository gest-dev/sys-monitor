"""Deterministic socket/counter tests; no network access or desktop required."""
from dataclasses import replace
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'extension'))
from traffic import (Connection, ConnectionTracker, InterfaceTracker, default_interface,
                     format_bytes, parse_connections, parse_interfaces, read_connections, snapshot)


TCP = ('tcp ESTAB 0 0 192.0.2.2:45123 198.51.100.8:443 '
       'users:(("browser",pid=42,fd=12),("helper",pid=43,fd=8)) '
       'uid:1000 ino:900 sk:ab12 <-> rto:200 rtt:12/3 bytes_sent:2000 bytes_received:6000')
UDP = 'udp UNCONN 0 0 [::]:5353 [::]:* users:(("discovery",pid=70,fd=9)) ino:100 sk:cd'


class SocketTests(unittest.TestCase):
    def test_ipv4_metadata_and_counters(self):
        row, = parse_connections(TCP)
        self.assertEqual((row.protocol, row.state, row.local, row.remote),
                         ('TCP', 'ESTAB', '192.0.2.2:45123', '198.51.100.8:443'))
        self.assertEqual((row.process, row.pids, row.received, row.sent), ('browser, helper', '42, 43', 6000, 2000))
        self.assertEqual(row.socket_id, 'ab12')

    def test_udp_ipv6_has_no_fabricated_counters(self):
        row, = parse_connections(UDP)
        self.assertEqual((row.local, row.remote), ('[::]:5353', '[::]:*'))
        self.assertIsNone(row.received)
        self.assertIsNone(row.sent)

    def test_listening_socket_without_owner(self):
        row, = parse_connections('tcp LISTEN 0 4096 127.0.0.1:631 0.0.0.0:* ino:700 sk:ff')
        self.assertEqual(row.process, 'Processo indisponível')
        self.assertIsNone(row.received)

    def test_omitted_tcp_zero_counters(self):
        row, = parse_connections('tcp ESTAB 0 0 [::1]:9000 [::1]:1000 sk:bb rto:200')
        self.assertEqual((row.received, row.sent), (0, 0))

    def test_empty_malformed_and_missing_details(self):
        self.assertEqual(parse_connections('Netid State Recv-Q Send-Q Local Peer\n\nmalformed'), [])
        row, = parse_connections('udp UNCONN 0 0 *:4000 *:*')
        self.assertEqual(row.socket_id, '')

    def test_filter_ip_pid_name_protocol_and_multiple_terms(self):
        row, = parse_connections(TCP)
        self.assertTrue(row.matches('BROWSER 198.51.100 42', 'TCP'))
        self.assertFalse(row.matches('browser', 'UDP'))
        self.assertFalse(row.matches('does-not-exist'))

    def test_monotonic_elapsed_and_first_sample(self):
        row, = parse_connections(TCP)
        tracker = ConnectionTracker()
        first, = tracker.sample([row], 10)
        self.assertIsNone(first.down)
        second, = tracker.sample([replace(row, received=10000, sent=3000)], 12)
        self.assertEqual((second.down, second.up), (2000, 500))

    def test_counter_reset_and_new_socket(self):
        row, = parse_connections(TCP)
        tracker = ConnectionTracker()
        tracker.sample([row], 10)
        reset, = tracker.sample([replace(row, received=1, sent=1)], 12)
        self.assertIsNone(reset.down)
        reused, = tracker.sample([replace(row, socket_id='new')], 14)
        self.assertIsNone(reused.up)

    def test_closed_sockets_leave_no_history(self):
        row, = parse_connections(TCP)
        tracker = ConnectionTracker()
        tracker.sample([row], 10)
        self.assertEqual(tracker.sample([], 12), [])
        self.assertEqual(tracker.previous, {})
        self.assertIsNone(tracker.sample([row], 14)[0].down)

    def test_no_identity_or_elapsed_never_produces_rates(self):
        row, = parse_connections(TCP)
        for change, now in [({'socket_id': ''}, 12), ({}, 10), ({}, 9)]:
            tracker = ConnectionTracker()
            tracker.sample([replace(row, **change)], 10)
            self.assertIsNone(tracker.sample([replace(row, **change)], now)[0].down)

    def test_ss_command_is_numeric_bounded_and_has_no_shell(self):
        with patch('traffic.subprocess.run', return_value=subprocess.CompletedProcess('ss', 0, TCP, '')) as run:
            self.assertEqual(len(read_connections()), 1)
            self.assertEqual(run.call_args.args[0], ['ss', '-H', '-tuanpieO'])
            self.assertEqual(run.call_args.kwargs['timeout'], 3)
            self.assertNotIn('shell', run.call_args.kwargs)

    def test_ss_failures_are_explicit(self):
        for failure in [FileNotFoundError(), subprocess.TimeoutExpired('ss', 3)]:
            with patch('traffic.subprocess.run', side_effect=failure), self.assertRaises(RuntimeError):
                read_connections()
        with patch('traffic.subprocess.run', return_value=subprocess.CompletedProcess('ss', 0, '',
                   'Cannot open netlink socket: Operation not permitted')), self.assertRaises(RuntimeError):
            read_connections()


class InterfaceTests(unittest.TestCase):
    def test_parse_real_proc_shape_and_loopback(self):
        text = 'Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast\n'
        text += ' enp1s0: 1000 1 0 0 0 0 0 0 3000 1 0 0 0 0 0 0\n'
        text += ' lo: 200 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0\n'
        self.assertEqual(parse_interfaces(text), {'enp1s0': (1000, 3000), 'lo': (200, 200)})

    def test_rates_and_session_totals_are_deltas(self):
        tracker = InterfaceTracker()
        self.assertEqual(tracker.sample('eth0', {'eth0': (1000, 2000)}, 10), (None, None))
        self.assertEqual(tracker.sample('eth0', {'eth0': (5000, 3000)}, 12), (2000, 500))
        self.assertEqual((tracker.received, tracker.sent), (4000, 1000))

    def test_disconnect_reconnect_switch_and_reset(self):
        tracker = InterfaceTracker()
        tracker.sample('eth0', {'eth0': (1000, 2000)}, 10)
        self.assertEqual(tracker.sample('eth0', {}, 12), (None, None))
        self.assertEqual(tracker.sample('eth0', {'eth0': (9000, 9000)}, 14), (None, None))
        self.assertEqual(tracker.sample('wlan0', {'wlan0': (99999, 99999)}, 16), (None, None))
        self.assertEqual(tracker.sample('wlan0', {'wlan0': (1, 1)}, 18), (0, 0))
        tracker.reset()
        self.assertEqual((tracker.received, tracker.sent, tracker.previous), (0, 0, None))

    def test_default_route_lowest_metric_and_no_loopback_fallback(self):
        route = ('Iface Destination Gateway Flags RefCnt Use Metric Mask\n'
                 'eth0 00000000 0100000A 0003 0 0 600 00000000\n'
                 'wlan0 00000000 0100000A 0003 0 0 100 00000000\n')
        with patch('traffic.Path.read_text', return_value=route):
            self.assertEqual(default_interface({'eth0': (1, 2), 'wlan0': (3, 4)}), 'wlan0')
        with patch('traffic.Path.read_text', side_effect=FileNotFoundError()):
            self.assertIsNone(default_interface({'lo': (1, 1)}))

    def test_ipv6_default_route(self):
        route = f'{"0" * 32} 00 {"0" * 32} 00 {"0" * 32} 00000064 00000000 00000000 00000003 eth0\n'
        with patch('traffic.Path.read_text', side_effect=['', route]):
            self.assertEqual(default_interface({'eth0': (1, 2)}), 'eth0')

    def test_independent_errors_do_not_hide_other_sensor(self):
        with patch('traffic.read_connections', side_effect=RuntimeError('sem conexões')), \
             patch('traffic.read_interfaces', return_value={'lo': (1, 1)}):
            data = snapshot()
        self.assertIsNone(data['connections'])
        self.assertEqual(data['interfaces'], {'lo': (1, 1)})
        self.assertEqual(data['errors'], ['sem conexões'])

    def test_format_unknown_is_not_zero(self):
        self.assertEqual(format_bytes(None, True), '—')
        self.assertEqual(format_bytes(0), '0 B')
        self.assertEqual(format_bytes(1500, True), '1,5 KB/s')


if __name__ == '__main__':
    unittest.main()
