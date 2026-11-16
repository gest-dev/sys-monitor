// Run only in the isolated GNOME Shell test session (see README).
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
let count = 0;
function check(condition, message) {
    count++;
    if (!condition)
        throw new Error(message);
}

export async function run() {
    await Scripting.sleep(2500);
    Main.overview.hide();
    const uuid = 'medidor-rede@gezer.local';
    const extension = Main.extensionManager.lookup(uuid);
    check(extension?.stateObj?._button, `Extension failed to enable: ${extension?.error}`);
    const monitor = extension.stateObj;
    const settings = monitor._settings;
    check(monitor._data.memory?.total > 0, 'Real memory sampled');
    check(monitor._data.disk?.total > 0, 'Real disk sampled');
    check(Number.isFinite(monitor._data.cpu), 'CPU delta sampled');
    check(monitor._errors.size === 0, 'No sampling errors');
    check(settings.get_string('display-style') === 'icons', 'Icon display is the default');
    check([...monitor._icons.values()].every(icon => icon.visible &&
        icon.gicon.get_file().query_exists(null)), 'All bundled icons exist and are enabled');
    check([...monitor._icons.values()].filter(icon => icon.get_parent().visible)
        .every(icon => icon.is_symbolic), 'Visible icons render symbolically');
    check(!monitor._labels.get('cpu').text.includes('CPU'), 'Icon mode keeps numbers without duplicate prefix');
    check(monitor._groups.get('memory').get_style_class_name().includes('monitor-sistema-memory') ||
        monitor._groups.get('memory').get_style_class_name().includes('monitor-sistema-warning') ||
        monitor._groups.get('memory').get_style_class_name().includes('monitor-sistema-critical'), 'Icon group inherits indicator color');
    // Exercise the menu path: setting GSettings directly misses submenu failures.
    const appearance = monitor._button.menu._getMenuItems()
        .find(item => item.label?.text === 'Aparência');
    monitor._button.menu.open();
    appearance.activate(null);
    await Scripting.sleep(350);
    const iconSizeRow = appearance.menu.firstMenuItem;
    check(iconSizeRow.get_children().some(child => child.text === 'Tamanho dos ícones'),
        'Icon size controls appear first in Appearance');
    const [, rowY] = iconSizeRow.get_transformed_position();
    const [, menuY] = appearance.menu.actor.get_transformed_position();
    check(appearance.menu.isOpen && appearance.menu.actor.mapped && rowY >= menuY &&
        rowY + iconSizeRow.height <= menuY + appearance.menu.actor.height,
        'Icon size controls are visible without scrolling');
    const smaller = monitor._iconSizeButtons.get(-2);
    const larger = monitor._iconSizeButtons.get(2);
    smaller.emit('clicked', 1);
    smaller.emit('clicked', 1);
    check(settings.get_int('icon-size') === 10 && !smaller.reactive, 'Decrease clamps at 10px');
    for (let size = 10; size <= 32; size += 2) {
        if (size > 10)
            larger.emit('clicked', 1);
        await Scripting.sleep(200);
        check(settings.get_int('icon-size') === size && [...monitor._icons.values()]
            .every(icon => icon.icon_size === size && (!icon.get_parent().visible ||
                (icon.width === size && icon.height === size))) &&
            monitor._iconSizeValue.text === `${size} px` && appearance.menu.isOpen,
        `${size}px button saves, updates its label and resizes rendered icons without closing Appearance`);
    }
    larger.emit('clicked', 1);
    check(settings.get_int('icon-size') === 32 && !larger.reactive, 'Increase clamps at 32px');
    monitor._button.menu.close();
    settings.set_int('icon-size', 16);
    check([...monitor._icons.values()].every(icon => icon.icon_size === 16), 'Icon size updates immediately');
    settings.set_int('icon-size', 12);
    settings.set_string('display-style', 'both');
    check(monitor._icons.get('cpu').visible && monitor._labels.get('cpu').text.startsWith('CPU'), 'Both mode shows icon, name and number');
    settings.set_string('display-style', 'text');
    check([...monitor._icons.values()].every(icon => !icon.visible), 'Text mode hides all icons');
    check(monitor._labels.get('download').text.startsWith('↓'), 'Download visible');
    check(monitor._labels.get('upload').text.startsWith('↑'), 'Upload visible');
    check(settings.get_int('font-size') === 10, 'Default font is 10px');
    check(monitor._labels.get('memory').has_style_class_name('monitor-sistema-memory') ||
        monitor._labels.get('memory').has_style_class_name('monitor-sistema-warning') ||
        monitor._labels.get('memory').has_style_class_name('monitor-sistema-critical'), 'Memory has a color');
    settings.set_boolean('colors', false);
    check([...monitor._labels.values()].every(label =>
        label.get_style_class_name() === 'monitor-sistema-value'), 'Disabling colors restores theme for all indicators');
    check(!monitor._switches.get('colors').state, 'Color switch synchronized');
    check([...monitor._groups.values()].every(group =>
        group.get_style_class_name() === 'monitor-sistema-indicator'), 'Disabling colors restores icon theme colors');
    settings.set_boolean('colors', true);
    const liveData = monitor._data;
    monitor._data = {...liveData, cpu: 70, memory: {...liveData.memory, percent: 80},
        disk: {...liveData.disk, percent: 80}};
    monitor._render();
    check(['cpu', 'memory', 'disk'].every(key => monitor._labels.get(key)
        .has_style_class_name('monitor-sistema-warning')), 'Thresholds show amber');
    monitor._data = {...liveData, cpu: 90, memory: {...liveData.memory, percent: 90},
        disk: {...liveData.disk, percent: 90}};
    monitor._render();
    check(['cpu', 'memory', 'disk'].every(key => monitor._labels.get(key)
        .has_style_class_name('monitor-sistema-critical')), 'Critical use shows red');
    monitor._data = {...liveData, name: null, cpu: null, memory: null, disk: null};
    monitor._render();
    check(['download', 'upload', 'cpu', 'memory', 'disk'].every(key => monitor._labels.get(key)
        .has_style_class_name('monitor-sistema-unavailable')), 'Unavailable readings are neutral');
    monitor._data = liveData;
    monitor._render();
    for (const key of monitor._labels.keys()) {
        settings.set_boolean(`show-${key}`, false);
        check(!monitor._labels.get(key).visible, `${key} hides immediately`);
        check(!monitor._groups.get(key).visible, `${key} hides icon and number together`);
        check(!monitor._switches.get(`show-${key}`).state, `${key} switch synchronized`);
    }
    check(monitor._fallback.visible, 'All hidden keeps clickable handle');
    for (const key of ['download', 'upload', 'cpu', 'memory', 'disk'])
        settings.set_boolean(`show-${key}`, true);
    check(!monitor._fallback.visible, 'Fallback disappears');
    settings.set_boolean('bits', true);
    check(monitor._labels.get('download').text.includes('b/s'), 'Bit units render immediately');
    settings.set_boolean('bits', false);
    settings.set_boolean('compact', false);
    check(monitor._labels.get('download').text.startsWith('↓ '), 'Expanded layout');
    settings.set_boolean('compact', true);
    settings.set_int('font-size', 9);
    check(monitor._labels.get('cpu').get_style().includes('9px'), 'Font changes immediately');
    settings.set_int('font-size', 10);
    // A missing filesystem must not interrupt network, CPU or memory.
    settings.set_string('disk-path', '/monitor-sistema-path-does-not-exist');
    await Scripting.sleep(1500);
    check(monitor._data.disk === null, 'Missing filesystem shown as unavailable');
    check(monitor._data.memory?.total > 0 && Number.isFinite(monitor._data.cpu), 'Other sensors survive disk error');
    settings.set_string('disk-path', '/');
    await Scripting.sleep(1500);
    check(monitor._data.disk?.total > 0, 'Disk recovers after path change');
    check(monitor._errors.size === 0, 'Disk error clears after recovery');
    monitor._tracker.received = 5000;
    monitor._tracker.sent = 3000;
    settings.set_boolean('show-total', true);
    check(monitor._labels.get('total').text === 'Σ8,0K', 'Combined session total');
    monitor._tracker.reset();
    monitor._render();
    check(monitor._labels.get('total').text === 'Σ0B', 'Session reset updates panel');
    settings.set_boolean('show-total', false);
    settings.set_string('display-style', 'icons');
    monitor._button.menu.open();
    await Scripting.sleep(700);
    check(monitor._button.menu.isOpen, 'Menu opens');
    appearance.activate(null);
    await Scripting.sleep(350);
    const stream = Gio.File.new_for_path('/tmp/monitor-sistema-preview.png')
        .replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Promise((resolve, reject) => {
        const shooter = new Shell.Screenshot();
        shooter.screenshot(false, stream, (object, result) => {
            try {
                object.screenshot_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
    stream.close(null);
    monitor._button.menu.close();
    // Disable during an asynchronous read, then enable a new generation.
    monitor._sample();
    const oldToken = monitor._cancellable;
    Main.extensionManager.disableExtension(uuid);
    await Scripting.sleep(250);
    check(oldToken.is_cancelled(), 'Disable cancels in-flight reads');
    check(monitor._button === null, 'Disable releases panel');
    Main.extensionManager.enableExtension(uuid);
    await Scripting.sleep(2000);
    check(monitor._button !== null && monitor._data.disk?.total > 0, 'Re-enable samples safely');
    check(monitor._errors.size === 0, 'No errors after re-enable');
    const trafficAction = monitor._button.menu._getMenuItems()
        .find(item => item.label?.text === 'Abrir monitor de tráfego');
    check(Boolean(trafficAction), 'Traffic monitor action is available');
    trafficAction.activate(null);
    const trafficWindows = () => global.get_window_actors().map(actor => actor.meta_window)
        .filter(window => window.get_gtk_application_id() === 'org.gnome.Shell.Extensions.MonitorSistema.Trafego');
    for (let attempt = 0; attempt < 12 && trafficWindows().length === 0; attempt++)
        await Scripting.sleep(500);
    check(trafficWindows().length === 1, 'Menu opens the native traffic window');
    trafficAction.activate(null);
    await Scripting.sleep(3000);
    check(trafficWindows().length === 1, 'Repeated activation reuses one window');
    const trafficStream = Gio.File.new_for_path('/tmp/monitor-trafego-preview.png')
        .replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Promise((resolve, reject) => {
        const shooter = new Shell.Screenshot();
        shooter.screenshot(false, trafficStream, (object, result) => {
            try {
                object.screenshot_finish(result);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
    trafficStream.close(null);
    trafficWindows()[0].delete(global.get_current_time());
    await Scripting.sleep(500);
    check(trafficWindows().length === 0, 'Traffic window closes cleanly');
    // The GTK test uses real controlled loopback sockets and runs on this
    // disposable display, with no windows or settings in the main session.
    const uiTestPath = Gio.File.new_for_uri(import.meta.url).get_parent()
        .get_child('traffic-window.py').get_path();
    const uiTest = Gio.Subprocess.new(['python3', uiTestPath],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [stdout, stderr] = await new Promise((resolve, reject) => {
        uiTest.communicate_utf8_async(null, null, (process, result) => {
            try {
                const [, output, errors] = process.communicate_utf8_finish(result);
                resolve([output, errors]);
            } catch (error) {
                reject(error);
            }
        });
    });
    check(uiTest.get_successful() && stdout.includes('MONITOR_TRAFEGO_UI_OK'),
        `Traffic UI integration failed: ${stdout}\n${stderr}`);
    print(stdout.trim());
    print(`MONITOR_SISTEMA_SHELL_OK: ${count} verificações passaram. Largura: ${monitor._button.width}px.`);
}
