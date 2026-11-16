#!/usr/bin/env python3
"""Instala o Monitor do Sistema incluído neste projeto, sem downloads."""
from pathlib import Path
import subprocess
import sys


def main():
    installer = Path(__file__).resolve().parent / 'monitor-sistema' / 'instalar.sh'
    if not installer.is_file():
        print(f'Instalador não encontrado: {installer}', file=sys.stderr)
        return 1
    return subprocess.run(['bash', str(installer)], check=False).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, KeyboardInterrupt) as error:
        print(f'Instalação interrompida: {error}', file=sys.stderr)
        sys.exit(1)
