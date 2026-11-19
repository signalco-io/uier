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
import gzip
import os
import pathlib
import shutil
import sys
import zipfile

wheel, = glob.glob(os.path.join(sys.argv[1], 'imageio_ffmpeg-*.whl'))
executable = pathlib.Path(sys.argv[1]) / 'ffmpeg'
with zipfile.ZipFile(wheel) as source:
    binary, = (name for name in source.namelist() if '/binaries/ffmpeg-linux-x86_64-' in name)
    with source.open(binary) as packed, executable.open('wb') as output:
        shutil.copyfileobj(packed, output)
executable.chmod(0o755)
with executable.open('rb') as source, open('apps/web/dist/proof-processor/ffmpeg.gz', 'wb') as target:
    with gzip.GzipFile(filename='', fileobj=target, mode='wb', compresslevel=6, mtime=0) as packed:
        shutil.copyfileobj(source, packed)
PY
"$work/ffmpeg" -hide_banner -version | head -n 1
