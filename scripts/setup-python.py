"""Prepare the image-processing environment used by scene generation and tests."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import venv

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--data-dir", type=Path)
args = parser.parse_args()
if not (3, 10) <= sys.version_info[:2] < (3, 13):
    raise SystemExit("Use Python 3.10, 3.11 or 3.12 for the pinned image dependencies.")

root = Path(__file__).resolve().parents[1]
data = args.data_dir or Path(os.environ.get("PIPELINE_DATA_DIR", root / "workbench/data"))
environment = data.resolve() / "reconstruction-env"
python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if not python.exists():
    venv.EnvBuilder(with_pip=True).create(environment)
subprocess.run(
    [str(python), "-m", "pip", "install", "-r", str(root / "workbench/src/geometry/requirements.lock.txt")],
    check=True,
)
subprocess.run(
    [str(python), "-c", "import PIL,numpy,cv2; print('Image dependencies ready:', PIL.__version__, numpy.__version__, cv2.__version__)"],
    check=True,
)
print("Python environment:", environment)
