// Invoke with GSETTINGS_BACKEND=memory and GSETTINGS_SCHEMA_DIR pointing to
// a temporary directory containing the compiled extension schemas.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.medidor-rede'});
let count = 0;
function check(condition, label) {
    count++;
    if (!condition)
        throw new Error(label);
}
for (const key of ['download', 'upload', 'cpu', 'memory', 'disk']) {
    check(settings.get_boolean(`show-${key}`), `${key} enabled by default`);
    settings.set_boolean(`show-${key}`, false);
    check(!settings.get_boolean(`show-${key}`), `${key} toggle saves`);
}
check(!settings.get_boolean('show-total'), 'Optional total hidden by default');
check(settings.get_boolean('compact'), 'Compact mode enabled by default');
check(settings.get_boolean('colors'), 'Colors enabled by default');
settings.set_boolean('colors', false);
check(!settings.get_boolean('colors'), 'Color preference saves');
check(settings.get_int('font-size') === 10, 'Smaller default font');
check(settings.get_string('display-style') === 'icons', 'Icons with numbers are the default');
for (const style of ['icons', 'text', 'both']) {
    settings.set_string('display-style', style);
    check(settings.get_string('display-style') === style, `Display style ${style} saves`);
}
check(!settings.settings_schema.get_key('display-style').range_check(new GLib.Variant('s', 'invalid')), 'Unknown display style rejected');
check(settings.get_int('icon-size') === 12, 'Default icon size');
settings.set_int('icon-size', 16);
check(settings.get_int('icon-size') === 16, 'Icon size saves');
check(!settings.settings_schema.get_key('icon-size').range_check(new GLib.Variant('i', 9)), 'Icon minimum enforced');
check(!settings.settings_schema.get_key('icon-size').range_check(new GLib.Variant('i', 17)), 'Icon maximum enforced');
check(settings.get_string('disk-path') === '/', 'Default root filesystem');
check(settings.get_string('interface') === '', 'Legacy automatic interface retained');
check(!settings.get_boolean('bits'), 'Legacy byte units retained');
check(!settings.settings_schema.get_key('font-size').range_check(new GLib.Variant('i', 8)), 'Font minimum enforced');
settings.set_int('font-size', 14);
check(settings.get_int('font-size') === 14, 'Font maximum allowed');
settings.set_string('interface', 'wlp3s0');
settings.set_boolean('bits', true);
check(settings.get_string('interface') === 'wlp3s0' && settings.get_boolean('bits'), 'Legacy settings still writable');
print(`${count} verificações de configurações passaram.`);
