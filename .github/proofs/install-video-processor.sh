#!/usr/bin/env bash
set -euo pipefail
# imageio-ffmpeg 0.8.1, Linux x86_64. The wheel supplies a static FFmpeg executable.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s\n' 'imageio-ffmpeg==0.8.1 --hash=sha256:050d6850601c3b3890bd2b28306f3b842b3daea390a561101174375a1c460bda' > "$work/requirements.txt"
python3 -m pip download --disable-pip-version-check --only-binary=:all: --no-deps --require-hashes \
  --platform manylinux_2_28_x86_64 --dest "$work" --requirement "$work/requirements.txt"
mkdir -p apps/web/dist/proof-processor
python3 - "$work" <<'PY'
import glob
import os
import pathlib
import sys
import zipfile

wheel, = glob.glob(os.path.join(sys.argv[1], 'imageio_ffmpeg-*.whl'))
with zipfile.ZipFile(wheel) as source:
    binary, = (name for name in source.namelist() if '/binaries/ffmpeg-linux-x86_64-' in name)
    output = pathlib.Path('apps/web/dist/proof-processor/ffmpeg')
    output.write_bytes(source.read(binary))
    output.chmod(0o755)
PY
apps/web/dist/proof-processor/ffmpeg -hide_banner -version | head -n 1
