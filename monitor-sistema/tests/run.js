import GLib from 'gi://GLib';
import {defaultInterface, formatAmount, parseCounters, RateTracker, selectInterface} from '../extension/network.js';

let count = 0;
function equal(actual, expected, label) {
    count++;
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const row = (name, rx, tx) => `${name}: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0`;
const counters = parseCounters(`Inter-| Receive | Transmit\n${row('lo', 100, 100)}\n${row('enp2s0', 5000, 1000)}\n${row('wlp3s0', 200, 300)}\nbroken: abc\n`);
equal([...counters.keys()], ['enp2s0', 'wlp3s0'], 'Valid interfaces; loopback and malformed data excluded');
equal(counters.get('enp2s0'), {rx: 5000, tx: 1000}, 'Correct receive and transmit columns');
equal(parseCounters(row('bad', -10, 10)).size, 0, 'Negative counters rejected');
const route = (name, metric, flags = '0003') => `${name} 00000000 01010101 ${flags} 0 0 ${metric} 00000000 0 0 0`;
const ipv4 = `Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n${route('wlp3s0', 600)}\n${route('enp2s0', 100)}`;
equal(defaultInterface(ipv4, '', counters), 'enp2s0', 'Lowest IPv4 metric wins');
equal(defaultInterface(route('missing', 1), '', counters), null, 'Stale route ignored');
equal(defaultInterface(route('enp2s0', 1, '0000'), '', counters), null, 'Down route ignored');
equal(defaultInterface(route('enp2s0', 1, '0201'), '', counters), null, 'Reject route ignored');
const ipv6 = `${'0'.repeat(32)} 00 ${'0'.repeat(32)} 00 ${'0'.repeat(32)} 00000064 00000000 00000000 00000003 wlp3s0`;
equal(defaultInterface('', ipv6, counters), 'wlp3s0', 'IPv6-only default route');
equal(defaultInterface(ipv4, ipv6, counters), 'enp2s0', 'Only one interface chosen to avoid double counting');
equal(selectInterface('wlp3s0', ipv4, ipv6, counters), 'wlp3s0', 'Manual choice overrides route');
equal(selectInterface('missing', ipv4, ipv6, counters), null, 'Missing manual interface stays disconnected');
equal(selectInterface('', '', '', counters), null, 'No route is explicit');

const tracker = new RateTracker();
const sample = (name, rx, tx, time) => tracker.sample(name, new Map([[name, {rx, tx}]]), time);
equal(sample('a', 1000000, 1000000, 1), {down: 0, up: 0}, 'First sample is baseline; no boot traffic counted');
equal(sample('a', 1003000, 1001500, 2.5), {down: 2000, up: 1000}, 'Actual elapsed time used');
equal([tracker.received, tracker.sent], [3000, 1500], 'Session totals');
equal(sample('a', 20, 10, 3.5), {down: 0, up: 0}, 'Counter reset produces no spike');
equal(sample('b', 9000000, 9000000, 4.5), {down: 0, up: 0}, 'Interface switch sets new baseline');
equal(sample('b', 9001000, 9000100, 5.5), {down: 1000, up: 100}, 'New interface rates');
equal([tracker.received, tracker.sent], [4000, 1600], 'Totals survive interface switch');
equal(tracker.sample(null, new Map(), 6.5), {down: 0, up: 0}, 'Disconnected');
equal(sample('b', 9900000, 9900000, 7.5), {down: 0, up: 0}, 'Reconnect has a fresh baseline');
equal(sample('b', 9900000, 9900000, 7.5), {down: 0, up: 0}, 'Zero elapsed time safe');
tracker.reset();
equal([tracker.previous, tracker.received, tracker.sent], [null, 0, 0], 'Reset clears baseline and totals');
equal(formatAmount(0, false, true), '0 B/s', 'Idle rate');
equal(formatAmount(4200000, false, true), '4,2 MB/s', 'Portuguese decimal separator');
equal(formatAmount(125000, true, true), '1,0 Mb/s', 'Bits conversion');
equal(formatAmount(1234000000), '1,2 GB', 'Session total format');
equal(formatAmount(NaN, false, true), '0 B/s', 'Invalid value safe');

// Smoke test against real Linux counters, independent of the graphical session.
const [ok, bytes] = GLib.file_get_contents('/proc/net/dev');
equal(ok, true, 'Live proc counters readable');
const live = parseCounters(new TextDecoder().decode(bytes));
equal(live.has('lo'), false, 'Live loopback excluded');
for (const value of live.values()) {
    if (!Number.isFinite(value.rx) || !Number.isFinite(value.tx))
        throw new Error('Invalid live counter');
}
print(`${count} verificações passaram (GJS), incluindo leitura real de /proc/net/dev.`);
