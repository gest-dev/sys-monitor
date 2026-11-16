// Pure functions, shared by the extension and the GJS tests.
export function parseCounters(text) {
    const counters = new Map();
    for (const line of text.split('\n')) {
        const colon = line.indexOf(':');
        if (colon < 0)
            continue;
        const name = line.slice(0, colon).trim();
        const values = line.slice(colon + 1).trim().split(/\s+/).map(Number);
        if (!name || name === 'lo' || values.length < 16 ||
            !Number.isFinite(values[0]) || !Number.isFinite(values[8]) ||
            values[0] < 0 || values[8] < 0)
            continue;
        counters.set(name, {rx: values[0], tx: values[8]});
    }
    return counters;
}

export function defaultInterface(ipv4, ipv6, counters) {
    const routes4 = [];
    for (const line of ipv4.trim().split('\n')) {
        const fields = line.trim().split(/\s+/);
        const flags = parseInt(fields[3], 16);
        const metric = Number(fields[6]);
        if (fields[1] === '00000000' && fields[7] === '00000000' &&
            (flags & 1) && !(flags & 0x200) && Number.isFinite(metric) &&
            counters.has(fields[0]))
            routes4.push({name: fields[0], metric});
    }
    routes4.sort((a, b) => a.metric - b.metric);
    if (routes4.length)
        return routes4[0].name;

    const routes6 = [];
    for (const line of ipv6.trim().split('\n')) {
        const fields = line.trim().split(/\s+/);
        const flags = parseInt(fields[8], 16);
        const metric = parseInt(fields[5], 16);
        if (fields[0] === '0'.repeat(32) && fields[1] === '00' &&
            (flags & 1) && !(flags & 0x200) && Number.isFinite(metric) &&
            counters.has(fields[9]))
            routes6.push({name: fields[9], metric});
    }
    routes6.sort((a, b) => a.metric - b.metric);
    return routes6[0]?.name ?? null;
}

export function selectInterface(preferred, ipv4, ipv6, counters) {
    if (preferred)
        return counters.has(preferred) ? preferred : null;
    return defaultInterface(ipv4, ipv6, counters);
}

export class RateTracker {
    constructor() {
        this.reset();
    }

    reset() {
        this.previous = null;
        this.received = 0;
        this.sent = 0;
    }

    sample(name, counters, seconds) {
        const current = counters.get(name);
        if (!current) {
            this.previous = null;
            return {down: 0, up: 0};
        }
        const before = this.previous;
        this.previous = {name, ...current, seconds};
        if (!before || before.name !== name || seconds <= before.seconds)
            return {down: 0, up: 0};
        // An interface reconnect or counter reset must never produce a spike.
        const rx = current.rx >= before.rx ? current.rx - before.rx : 0;
        const tx = current.tx >= before.tx ? current.tx - before.tx : 0;
        this.received += rx;
        this.sent += tx;
        return {down: rx / (seconds - before.seconds), up: tx / (seconds - before.seconds)};
    }
}

export function formatAmount(bytes, bits = false, speed = false, compact = false) {
    let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0) * (bits ? 8 : 1);
    const units = bits ? ['b', 'Kb', 'Mb', 'Gb', 'Tb'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    while (value >= 1000 && index < units.length - 1) {
        value /= 1000;
        index++;
    }
    // Promote a rounded 1000 KB to MB rather than expanding the panel text.
    value = Number(value.toFixed(index && value < 100 ? 1 : 0));
    if (value >= 1000 && index < units.length - 1) {
        value /= 1000;
        index++;
    }
    const number = value.toFixed(index && value < 100 ? 1 : 0).replace('.', ',');
    const unit = compact && index ? units[index].slice(0, -1) + (bits ? 'b' : '') : units[index];
    return `${number}${compact ? '' : ' '}${unit}${speed ? '/s' : ''}`;
}
