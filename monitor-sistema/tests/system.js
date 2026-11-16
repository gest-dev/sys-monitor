import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {formatAmount} from '../extension/network.js';
import {CpuTracker, diskUsage, formatPercent, parseCpu, parseMemory} from '../extension/system.js';

let count = 0;
function equal(actual, expected, label) {
    count++;
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function throws(fn, label) {
    let thrown = false;
    try {
        fn();
    } catch {
        thrown = true;
    }
    equal(thrown, true, label);
}
equal(parseCpu('cpu  100 10 20 800 30 5 5 30 90 10\ncpu0 1 2 3 4'),
    {total: 1000, idle: 830}, 'Aggregate CPU; guest time is not counted twice');
throws(() => parseCpu('cpu0 1 2 3 4'), 'Missing aggregate rejected');
throws(() => parseCpu('cpu 1 2 invalid 4'), 'Malformed CPU rejected');
throws(() => parseCpu('cpu -1 2 3 4'), 'Negative CPU rejected');
const cpu = new CpuTracker();
equal(cpu.sample({total: 1000, idle: 800}), null, 'First CPU sample is a baseline');
equal(cpu.sample({total: 1100, idle: 875}), 25, 'CPU delta across all cores');
equal(cpu.sample({total: 1200, idle: 875}), 100, 'Full CPU load');
equal(cpu.sample({total: 1300, idle: 975}), 0, 'Idle CPU');
equal(cpu.sample({total: 1300, idle: 975}), null, 'Identical CPU counters safe');
equal(cpu.sample({total: 100, idle: 80}), null, 'CPU counter reset is a fresh baseline');
equal(cpu.sample({total: 200, idle: 60}), null, 'Decreasing idle counter is ignored');
equal(parseMemory('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 750 kB\nCached: 650 kB'),
    {total: 1024000, available: 768000, used: 256000, percent: 25}, 'Reclaimable memory stays available');
equal(parseMemory('MemTotal: 100 kB\nMemAvailable: 200 kB').used, 0, 'Memory clamped to total');
equal(parseMemory('MemTotal: 100 kB\nMemAvailable: 0 kB').percent, 100, 'Full memory');
throws(() => parseMemory('MemTotal: 0 kB\nMemAvailable: 0 kB'), 'Zero memory rejected');
throws(() => parseMemory('MemTotal: 100 kB'), 'Missing available memory rejected');
equal(diskUsage(1000, 250), {total: 1000, free: 250, used: 750, percent: 75}, 'Disk used, free, total');
equal(diskUsage(1000, 2000).used, 0, 'Disk usage never negative');
equal(diskUsage(1000, 0).percent, 100, 'Full disk');
throws(() => diskUsage(0, 0), 'Unknown filesystem size rejected');
throws(() => diskUsage(1000, -1), 'Invalid free space rejected');
equal(formatPercent(null), '—', 'No fake CPU zero while waiting');
equal(formatPercent(24.7), '25%', 'Compact integer percentage');
equal(formatPercent(1000), '100%', 'Percentage bounded');
equal(formatAmount(4200000, false, true, true), '4,2M/s', 'Compact network bytes');
equal(formatAmount(125000, true, true, true), '1,0Mb/s', 'Compact bits remain distinguishable');
equal(formatAmount(180000000000, false, false, true), '180G', 'Compact occupied disk');
equal(formatAmount(999999, false, true, true), '1,0M/s', 'Unit promoted after rounding');
equal(formatAmount(0, false, true, true), '0B/s', 'Compact zero');
equal(formatAmount(999, false, true, true), '999B/s', 'Bytes boundary');

const read = path => new TextDecoder().decode(GLib.file_get_contents(path)[1]);
equal(parseCpu(read('/proc/stat')).total > 0, true, 'Live CPU counters');
equal(parseMemory(read('/proc/meminfo')).used > 0, true, 'Live memory counters');
const info = Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::free', null);
const disk = diskUsage(info.get_attribute_uint64('filesystem::size'), info.get_attribute_uint64('filesystem::free'));
equal(disk.used >= 0 && disk.used <= disk.total, true, 'Live disk space');
print(`${count} verificações de sistema passaram (GJS), incluindo CPU, RAM e disco reais.`);
