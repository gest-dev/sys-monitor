import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {formatAmount, parseCounters, RateTracker, selectInterface} from './network.js';
import {CpuTracker, diskUsage, formatPercent, parseCpu, parseMemory} from './system.js';

const MIN_ICON_SIZE = 10;
const MAX_ICON_SIZE = 32;

function readText(path, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).load_contents_async(cancellable, (file, result) => {
            try {
                const [ok, bytes] = file.load_contents_finish(result);
                if (!ok)
                    throw new Error(`Não foi possível ler ${path}`);
                resolve(new TextDecoder().decode(bytes));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function readDisk(path, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).query_filesystem_info_async(
            'filesystem::size,filesystem::free', GLib.PRIORITY_DEFAULT, cancellable,
            (file, result) => {
                try {
                    const info = file.query_filesystem_info_finish(result);
                    if (!info.has_attribute('filesystem::size') || !info.has_attribute('filesystem::free'))
                        throw new Error('Sistema de arquivos sem informação de espaço');
                    resolve(diskUsage(info.get_attribute_uint64('filesystem::size'),
                        info.get_attribute_uint64('filesystem::free')));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

function infoItem(menu, text, title = false) {
    const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
    if (title)
        item.label.add_style_class_name('monitor-sistema-title');
    menu.addMenuItem(item);
    return item;
}

export default class MonitorSistema extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tracker = new RateTracker();
        this._cpuTracker = new CpuTracker();
        this._cancellable = new Gio.Cancellable();
        this._busy = false;
        this._interfaceNames = null;
        this._diskSampledAt = -Infinity;
        this._errors = new Map();
        this._data = {name: null, rates: {down: 0, up: 0}, cpu: null, memory: null, disk: null};
        this._switches = new Map();
        this._choices = [];
        this._button = new PanelMenu.Button(0.5, 'Monitor do Sistema');
        this._button.add_style_class_name('monitor-sistema-button');
        this._box = new St.BoxLayout({style_class: 'monitor-sistema-box'});
        this._labels = new Map();
        this._groups = new Map();
        this._icons = new Map();
        for (const key of ['download', 'upload', 'cpu', 'memory', 'disk', 'total']) {
            const group = new St.BoxLayout({style_class: 'monitor-sistema-indicator'});
            const icon = new St.Icon({
                gicon: new Gio.FileIcon({file: this.dir.get_child('icons').get_child(`${key}-symbolic.svg`)}),
                icon_size: this._settings.get_int('icon-size'),
                y_align: Clutter.ActorAlign.CENTER,
            });
            const label = new St.Label({text: '—', y_align: Clutter.ActorAlign.CENTER,
                style_class: 'monitor-sistema-value'});
            group.add_child(icon);
            group.add_child(label);
            this._box.add_child(group);
            this._labels.set(key, label);
            this._groups.set(key, group);
            this._icons.set(key, icon);
        }
        // Keep a clickable handle when every indicator is hidden.
        this._fallback = new St.Label({text: '•', y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._fallback);
        this._button.add_child(this._box);
        this._buildMenu();
        this._settingsId = this._settings.connect('changed', (_settings, key) => {
            if (key === 'interface') {
                this._interfaceNames = null;
                this._tracker.previous = null;
                this._data.name = null;
            }
            if (key === 'disk-path') {
                this._diskSampledAt = -Infinity;
                this._data.disk = null;
                this._buildDiskChoices();
            }
            this._syncSettings();
            this._render();
            if (key === 'interface' || key === 'disk-path')
                this._sample();
        });
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._sample();
        });
        this._syncSettings();
        this._render();
        Main.panel.addToStatusArea(this.uuid, this._button, 0, 'right');
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._sample();
            return GLib.SOURCE_CONTINUE;
        });
        this._sample();
    }

    _switch(menu, label, key) {
        const item = new PopupMenu.PopupSwitchMenuItem(label, this._settings.get_boolean(key));
        item.connect('toggled', (_item, state) => this._settings.set_boolean(key, state));
        menu.addMenuItem(item);
        this._switches.set(key, item);
    }

    _choice(menu, label, key, value) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            if (typeof value === 'number')
                this._settings.set_int(key, value);
            else
                this._settings.set_string(key, value);
        });
        menu.addMenuItem(item);
        this._choices.push({item, key, value});
    }

    _buildIconSizeControl(menu) {
        const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        row.add_child(new St.Label({text: 'Tamanho dos ícones', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        this._iconSizeValue = new St.Label({style_class: 'monitor-sistema-size-value',
            y_align: Clutter.ActorAlign.CENTER});
        this._iconSizeButtons = new Map();
        for (const [delta, text, name] of [[-2, '−', 'Diminuir tamanho dos ícones'],
            [2, '+', 'Aumentar tamanho dos ícones']]) {
            const button = new St.Button({label: text, accessible_name: name, can_focus: true,
                style_class: 'button monitor-sistema-size-button'});
            button.connect('clicked', () => {
                const size = this._settings.get_int('icon-size');
                this._settings.set_int('icon-size', Math.max(MIN_ICON_SIZE, Math.min(MAX_ICON_SIZE, size + delta)));
            });
            row.add_child(button);
            if (delta < 0)
                row.add_child(this._iconSizeValue);
            this._iconSizeButtons.set(delta, button);
        }
        menu.addMenuItem(row);
    }

    _buildMenu() {
        const menu = this._button.menu;
        infoItem(menu, 'Monitor do Sistema', true);
        menu.addAction('Abrir monitor de tráfego', () => this._openTrafficMonitor());
        this._connection = infoItem(menu, 'Identificando conexão…');
        this._download = infoItem(menu, 'Download: —');
        this._upload = infoItem(menu, 'Upload: —');
        this._cpu = infoItem(menu, 'CPU: —');
        this._memory = infoItem(menu, 'Memória: —');
        this._disk = infoItem(menu, 'Disco: —');
        this._diskFree = infoItem(menu, 'Livre: —');
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const totals = new PopupMenu.PopupSubMenuMenuItem('Rede acumulada da sessão');
        menu.addMenuItem(totals);
        infoItem(totals.menu, 'Desde a ativação ou último reset');
        this._received = infoItem(totals.menu, 'Recebido: 0 B');
        this._sent = infoItem(totals.menu, 'Enviado: 0 B');
        totals.menu.addAction('Zerar acumulado da rede', () => {
            this._tracker.reset();
            this._data.rates = {down: 0, up: 0};
            this._render();
        });
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const indicators = new PopupMenu.PopupSubMenuMenuItem('Mostrar na barra');
        menu.addMenuItem(indicators);
        for (const [key, label] of [['download', 'Download'], ['upload', 'Upload'],
            ['cpu', 'Processador (CPU)'], ['memory', 'Memória RAM'],
            ['disk', 'Espaço ocupado em disco'], ['total', 'Rede acumulada (recebido + enviado)']])
            this._switch(indicators.menu, label, `show-${key}`);
        const appearance = new PopupMenu.PopupSubMenuMenuItem('Aparência');
        menu.addMenuItem(appearance);
        this._buildIconSizeControl(appearance.menu);
        this._switch(appearance.menu, 'Modo compacto', 'compact');
        this._switch(appearance.menu, 'Cores dos indicadores', 'colors');
        // GNOME's top menu tracks a single open submenu. Nesting another one
        // inside Appearance closes Appearance and hides the choices.
        appearance.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Identificação dos indicadores'));
        for (const [value, label] of [['icons', 'Ícones + números'], ['text', 'Texto + números'],
            ['both', 'Ícones, texto e números']])
            this._choice(appearance.menu, label, 'display-style', value);
        appearance.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Tamanho dos números'));
        for (let size = 9; size <= 14; size++)
            this._choice(appearance.menu, `${size} px${size === 10 ? ' (padrão)' : ''}`, 'font-size', size);
        this._interfaces = new PopupMenu.PopupSubMenuMenuItem('Interface de rede');
        menu.addMenuItem(this._interfaces);
        this._disks = new PopupMenu.PopupSubMenuMenuItem('Disco monitorado');
        menu.addMenuItem(this._disks);
        this._buildDiskChoices();
        this._switch(menu, 'Velocidade em bits/s', 'bits');
    }

    _openTrafficMonitor() {
        try {
            const process = Gio.Subprocess.new(['python3', this.dir.get_child('traffic-window.py').get_path()],
                Gio.SubprocessFlags.NONE);
            process.wait_check_async(null, (child, result) => {
                try {
                    child.wait_check_finish(result);
                } catch (error) {
                    Main.notifyError('Monitor de tráfego',
                        `A janela foi encerrada com erro. Verifique Python 3, GTK 4 e libadwaita: ${error.message}`);
                }
            });
        } catch (error) {
            Main.notifyError('Monitor de tráfego', `Não foi possível abrir a janela: ${error.message}`);
        }
    }

    _buildDiskChoices() {
        this._choices = this._choices.filter(choice => choice.key !== 'disk-path');
        this._disks.menu.removeAll();
        const paths = new Map([['/', 'Sistema (/)'], [GLib.get_home_dir(), 'Pasta pessoal']]);
        const current = this._settings.get_string('disk-path');
        if (!paths.has(current))
            paths.set(current, current || '(caminho inválido)');
        for (const [path, label] of paths)
            this._choice(this._disks.menu, label, 'disk-path', path);
    }

    _syncSettings() {
        for (const [key, item] of this._switches)
            item.setToggleState(this._settings.get_boolean(key));
        for (const {item, key, value} of this._choices) {
            const current = typeof value === 'number' ? this._settings.get_int(key) : this._settings.get_string(key);
            item.setOrnament(current === value ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        }
        this._box.set_style(`spacing: ${this._settings.get_boolean('compact') ? 3 : 8}px;`);
        for (const label of this._labels.values())
            label.set_style(`font-size: ${this._settings.get_int('font-size')}px;`);
        const iconSize = this._settings.get_int('icon-size');
        for (const icon of this._icons.values())
            icon.icon_size = iconSize;
        this._iconSizeValue.text = `${iconSize} px`;
        for (const [delta, button] of this._iconSizeButtons) {
            const enabled = delta < 0 ? iconSize > MIN_ICON_SIZE : iconSize < MAX_ICON_SIZE;
            button.reactive = enabled;
            button.can_focus = enabled;
            if (enabled)
                button.remove_style_pseudo_class('insensitive');
            else
                button.add_style_pseudo_class('insensitive');
        }
    }

    _updateInterfaces(counters) {
        const names = [...counters.keys()].sort();
        const preferred = this._settings.get_string('interface');
        const signature = JSON.stringify([names, preferred]);
        if (signature === this._interfaceNames)
            return;
        this._interfaceNames = signature;
        this._choices = this._choices.filter(choice => choice.key !== 'interface');
        this._interfaces.menu.removeAll();
        this._choice(this._interfaces.menu, 'Automática (rota padrão)', 'interface', '');
        for (const name of names)
            this._choice(this._interfaces.menu, name, 'interface', name);
        if (preferred && !counters.has(preferred))
            this._choice(this._interfaces.menu, `${preferred} (desconectada)`, 'interface', preferred);
        this._syncSettings();
    }

    _render() {
        const {name, rates, cpu, memory, disk} = this._data;
        const bits = this._settings.get_boolean('bits');
        const compact = this._settings.get_boolean('compact');
        const colors = this._settings.get_boolean('colors');
        const gap = compact ? '' : ' ';
        const displayStyle = this._settings.get_string('display-style');
        const down = name ? formatAmount(rates.down, bits, true) : '—';
        const up = name ? formatAmount(rates.up, bits, true) : '—';
        const amount = value => formatAmount(value, false, false, compact);
        const prefixes = {download: '↓', upload: '↑', cpu: 'CPU', memory: 'RAM', disk: 'D', total: 'Σ'};
        const values = {
            download: name ? formatAmount(rates.down, bits, true, compact) : '—',
            upload: name ? formatAmount(rates.up, bits, true, compact) : '—',
            cpu: formatPercent(cpu),
            memory: formatPercent(memory?.percent),
            disk: disk ? amount(disk.used) : '—',
            total: amount(this._tracker.received + this._tracker.sent),
        };
        let visible = 0;
        const percentages = {cpu, memory: memory?.percent, disk: disk?.percent};
        for (const [key, label] of this._labels) {
            label.text = `${displayStyle === 'icons' ? '' : prefixes[key] + gap}${values[key]}`;
            label.visible = this._settings.get_boolean(`show-${key}`);
            const group = this._groups.get(key);
            group.visible = label.visible;
            this._icons.get(key).visible = displayStyle !== 'text';
            let color = key;
            if (key in percentages) {
                const percent = percentages[key];
                if (!Number.isFinite(percent))
                    color = 'unavailable';
                else if (percent >= 90)
                    color = 'critical';
                else if (percent >= (key === 'cpu' ? 70 : 80))
                    color = 'warning';
            } else if ((key === 'download' || key === 'upload') && !name) {
                color = 'unavailable';
            }
            const classes = `monitor-sistema-value${colors ? ` monitor-sistema-${color}` : ''}`;
            if (label.get_style_class_name() !== classes)
                label.set_style_class_name(classes);
            const groupClasses = `monitor-sistema-indicator${colors ? ` monitor-sistema-${color}` : ''}`;
            if (group.get_style_class_name() !== groupClasses)
                group.set_style_class_name(groupClasses);
            if (label.visible)
                visible++;
        }
        this._fallback.visible = visible === 0;
        const preferred = this._settings.get_string('interface');
        this._connection.label.text = this._errors.has('network') ? 'Rede: leitura indisponível' :
            (name ? `Conexão: ${name}${preferred ? '' : ' (automática)'}` :
                (preferred ? `Interface ${preferred} indisponível` : 'Sem rota padrão · selecione uma interface'));
        this._download.label.text = `Download: ${down}`;
        this._upload.label.text = `Upload: ${up}`;
        this._cpu.label.text = this._errors.has('cpu') ? 'CPU: leitura indisponível' :
            `CPU: ${formatPercent(cpu)}${cpu === null ? ' (aguardando leitura)' : ' em uso'}`;
        this._memory.label.text = memory ?
            `Memória: ${formatAmount(memory.used)} / ${formatAmount(memory.total)} (${formatPercent(memory.percent)})` :
            'Memória: leitura indisponível';
        const path = this._settings.get_string('disk-path');
        this._disk.label.text = disk ?
            `Disco (${path}): ${formatAmount(disk.used)} / ${formatAmount(disk.total)} (${formatPercent(disk.percent)})` :
            `Disco (${path}): leitura indisponível`;
        this._diskFree.label.text = disk ? `Livre no disco: ${formatAmount(disk.free)}` : 'Livre no disco: —';
        this._received.label.text = `Recebido: ${formatAmount(this._tracker.received)}`;
        this._sent.label.text = `Enviado: ${formatAmount(this._tracker.sent)}`;
        this._button.accessible_name = ['Monitor do Sistema', this._connection.label.text,
            this._download.label.text, this._upload.label.text, this._cpu.label.text,
            this._memory.label.text, this._disk.label.text, this._received.label.text,
            this._sent.label.text].join('. ');
    }

    async _sample() {
        if (this._busy || !this._cancellable)
            return;
        this._busy = true;
        // A local token prevents old callbacks touching a subsequent enable().
        const token = this._cancellable;
        const preferred = this._settings.get_string('interface');
        const path = this._settings.get_string('disk-path');
        const now = GLib.get_monotonic_time() / 1e6;
        const optional = file => readText(file, token).catch(error => {
            if (error.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND))
                return '';
            throw error;
        });
        const requests = [
            ['network', Promise.all([readText('/proc/net/dev', token),
                optional('/proc/net/route'), optional('/proc/net/ipv6_route')])],
            ['cpu', readText('/proc/stat', token).then(parseCpu)],
            ['memory', readText('/proc/meminfo', token).then(parseMemory)],
        ];
        if (now - this._diskSampledAt >= 10)
            requests.push(['disk', readDisk(path, token)]);
        try {
            const results = await Promise.allSettled(requests.map(([, request]) => request));
            if (token.is_cancelled() || token !== this._cancellable)
                return;
            for (let i = 0; i < results.length; i++) {
                const key = requests[i][0];
                const result = results[i];
                // Ignore a sample if its source was changed while the read was in flight.
                if ((key === 'network' && preferred !== this._settings.get_string('interface')) ||
                    (key === 'disk' && path !== this._settings.get_string('disk-path')))
                    continue;
                if (key === 'disk')
                    this._diskSampledAt = now;
                if (result.status === 'rejected') {
                    if (key === 'network') {
                        this._data.name = null;
                        this._tracker.previous = null;
                    } else {
                        this._data[key] = null;
                        if (key === 'cpu')
                            this._cpuTracker.previous = null;
                    }
                    if (this._errors.get(key) !== result.reason.message) {
                        console.error(`[Monitor do Sistema/${key}] ${result.reason.message}`);
                        this._errors.set(key, result.reason.message);
                    }
                    continue;
                }
                this._errors.delete(key);
                if (key === 'network') {
                    const [dev, ipv4, ipv6] = result.value;
                    const counters = parseCounters(dev);
                    const name = selectInterface(preferred, ipv4, ipv6, counters);
                    this._data.name = name;
                    this._data.rates = this._tracker.sample(name, counters, GLib.get_monotonic_time() / 1e6);
                    this._updateInterfaces(counters);
                } else if (key === 'cpu') {
                    this._data.cpu = this._cpuTracker.sample(result.value);
                } else {
                    this._data[key] = result.value;
                }
            }
            this._render();
        } catch (error) {
            if (!token.is_cancelled() && token === this._cancellable)
                console.error(`[Monitor do Sistema] ${error.message}`);
        } finally {
            if (token === this._cancellable)
                this._busy = false;
        }
    }

    disable() {
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._timer = null;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = null;
        this._button?.destroy();
        this._button = null;
        this._settings = null;
        this._tracker = null;
        this._cpuTracker = null;
        this._data = null;
        this._labels = null;
        this._groups = null;
        this._icons = null;
        this._switches = null;
        this._choices = null;
        this._iconSizeButtons = null;
        this._iconSizeValue = null;
        this._errors = null;
        for (const key of ['_box', '_fallback', '_connection', '_download', '_upload',
            '_cpu', '_memory', '_disk', '_diskFree', '_received', '_sent', '_interfaces', '_disks'])
            this[key] = null;
    }
}
