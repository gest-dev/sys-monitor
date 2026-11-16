// Pure calculations: usable in GJS tests without loading GNOME Shell.
export function parseCpu(text) {
    const line = text.split('\n').find(row => /^cpu\s/.test(row));
    if (!line)
        throw new Error('Contadores da CPU ausentes');
    const values = line.trim().split(/\s+/).slice(1, 9).map(Number);
    if (values.length < 4 || values.some(value => !Number.isFinite(value) || value < 0))
        throw new Error('Contadores da CPU inválidos');
    // guest/guest_nice are already included in user/nice. Do not add them twice.
    return {total: values.reduce((sum, value) => sum + value, 0),
        idle: values[3] + (values[4] ?? 0)};
}

export class CpuTracker {
    constructor() {
        this.previous = null;
    }

    sample(current) {
        const previous = this.previous;
        this.previous = current;
        if (!previous || current.total <= previous.total || current.idle < previous.idle)
            return null;
        const total = current.total - previous.total;
        return Math.max(0, Math.min(100, 100 * (1 - (current.idle - previous.idle) / total)));
    }
}

export function parseMemory(text) {
    const values = new Map();
    for (const line of text.split('\n')) {
        const match = line.match(/^(\w+):\s+(\d+)\s+kB\s*$/);
        if (match)
            values.set(match[1], Number(match[2]) * 1024);
    }
    const total = values.get('MemTotal');
    const available = values.get('MemAvailable');
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(available))
        throw new Error('Dados da memória indisponíveis');
    const used = Math.max(0, total - Math.min(total, available));
    return {total, available: total - used, used, percent: used / total * 100};
}

export function diskUsage(total, free) {
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0)
        throw new Error('Dados do disco indisponíveis');
    const used = Math.max(0, total - Math.min(total, free));
    return {total, free: total - used, used, percent: used / total * 100};
}

export function formatPercent(value) {
    return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(100, value)))}%` : '—';
}
