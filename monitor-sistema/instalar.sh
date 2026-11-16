#!/usr/bin/env bash
set -euo pipefail

pasta="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
uuid='medidor-rede@gezer.local'
pacote="$pasta/dist/$uuid.shell-extension.zip"

for comando in gnome-shell gnome-extensions gjs; do
    if ! command -v "$comando" >/dev/null; then
        echo "Comando necessário não encontrado: $comando" >&2
        exit 1
    fi
done
versao="$(gnome-shell --version)"
if [[ ! "$versao" =~ GNOME\ Shell\ 50\. ]]; then
    echo "Esta versão foi preparada para GNOME 50. Versão encontrada: $versao" >&2
    exit 1
fi
if [[ ! -f "$pacote" ]]; then
    echo "Pacote ausente: $pacote" >&2
    exit 1
fi

destino="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
atualizacao=false
if [[ -d "$destino" ]]; then
    mkdir -p "$pasta/backups"
    backup="$(mktemp -d "$pasta/backups/anterior-XXXXXXXX")"
    cp -a -- "$destino" "$backup/"
    echo "Cópia da versão anterior: $backup"
    atualizacao=true
fi

echo 'Instalando Monitor do Sistema (sem downloads e sem sudo)…'
if [[ "$atualizacao" == true ]]; then
    gnome-extensions install --force "$pacote"
else
    gnome-extensions install "$pacote"
fi

# GNOME may discover newly installed extensions only after the next login.
# Persist just our UUID and preserve all other enabled extensions.
gjs -c '
const Gio = imports.gi.Gio;
const settings = new Gio.Settings({schema_id: "org.gnome.shell"});
const uuid = "medidor-rede@gezer.local";
const enabled = settings.get_strv("enabled-extensions");
if (!enabled.includes(uuid) && !settings.set_strv("enabled-extensions", [...enabled, uuid]))
    throw new Error("Não foi possível salvar a ativação da extensão");
const disabled = settings.get_strv("disabled-extensions");
if (disabled.includes(uuid) && !settings.set_strv("disabled-extensions", disabled.filter(item => item !== uuid)))
    throw new Error("Não foi possível remover a desativação anterior da extensão");
Gio.Settings.sync();
if (settings.get_boolean("disable-user-extensions"))
    print("Ative as extensões de usuário no aplicativo Extensões para mostrar o medidor.");
'

if [[ "$atualizacao" == true ]]; then
    echo 'Atualização instalada. Salve seu trabalho, saia da sessão e entre novamente para carregar o novo código.'
elif gnome-extensions enable "$uuid" 2>"$pasta/ativacao.log"; then
    echo 'Monitor ativado. Confira rede, CPU, RAM e disco na barra superior.'
    gnome-extensions info "$uuid"
else
    echo 'Extensão instalada e ativação salva para o próximo login.'
    echo 'Salve seu trabalho, saia da sessão do Ubuntu e entre novamente para aparecer na barra.'
fi
