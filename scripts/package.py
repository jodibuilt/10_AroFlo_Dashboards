#!/usr/bin/env python3
"""Build the App Service deployment zip.

Usage: python scripts/package.py [--skip-frontend-build]

Produces a self-contained package — server source, production node_modules and
the built React app — so App Service runs it as-is with no build step on the
Azure side (SCM_DO_BUILD_DURING_DEPLOYMENT=false). Every dependency is pure
JavaScript, so node_modules installed on Windows runs unchanged on Linux.

Windows' own zip tooling writes '\\' path separators, which Linux treats as
literal filenames rather than directories. zipfile with explicit '/' avoids that.
"""
import os
import shutil
import stat
import subprocess
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(REPO, "frontend")
# Kept short deliberately: staging under the repo's own OneDrive path can
# overrun Windows' MAX_PATH partway through node_modules.
STAGE = os.environ.get("AROFLO_DASHBOARDS_PKG_STAGE", r"C:\tmp\aroflo-dashboards-pkg")
OUT = os.environ.get("AROFLO_DASHBOARDS_PKG_OUT", r"C:\tmp\aroflo-dashboards-pkg.zip")
SHELL = os.name == "nt"

# Files that must be in the zip for the app to boot and serve the UI.
REQUIRED = (
    "package.json",
    "src/server.js",
    "frontend/dist/index.html",
    "frontend/dist/admin.html",
    "node_modules/express/package.json",
)
# Anything matching these must never ship.
FORBIDDEN_NAMES = (".env",)
FORBIDDEN_SUFFIXES = (".sqlite", ".sqlite-wal", ".sqlite-shm")


def _force_remove(func, path, _exc):
    """npm leaves read-only files behind and Windows refuses to unlink them.
    Clear the bit and retry rather than leaving a stale staging dir."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def rmtree(path):
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_force_remove)
    else:
        shutil.rmtree(path, onerror=_force_remove)


def run(args, cwd):
    subprocess.run(args, cwd=cwd, check=True, shell=SHELL)


if "--skip-frontend-build" not in sys.argv:
    run(["npm", "ci", "--no-audit", "--no-fund"], FRONTEND)
    run(["npm", "run", "build"], FRONTEND)

dist = os.path.join(FRONTEND, "dist")
if not os.path.isfile(os.path.join(dist, "index.html")):
    sys.exit("frontend/dist/index.html is missing — build the frontend first.")

if os.path.exists(STAGE):
    rmtree(STAGE)
os.makedirs(STAGE)

for name in ("package.json", "package-lock.json"):
    shutil.copy(os.path.join(REPO, name), STAGE)
shutil.copytree(os.path.join(REPO, "src"), os.path.join(STAGE, "src"))
shutil.copytree(dist, os.path.join(STAGE, "frontend", "dist"))

run(["npm", "ci", "--omit=dev", "--no-audit", "--no-fund"], STAGE)

if os.path.exists(OUT):
    os.remove(OUT)
count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(STAGE):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, STAGE).replace(os.sep, "/"))
            count += 1

with zipfile.ZipFile(OUT) as z:
    names = set(z.namelist())
missing = [n for n in REQUIRED if n not in names]
if missing:
    sys.exit("Package is incomplete, missing: " + ", ".join(missing))
# Only our own files — some npm packages publish a sample .env of their own.
leaked = [
    n for n in names
    if not n.startswith("node_modules/")
    and (os.path.basename(n) in FORBIDDEN_NAMES or n.endswith(FORBIDDEN_SUFFIXES))
]
if leaked:
    os.remove(OUT)
    sys.exit("Refusing to package local secrets/data: " + ", ".join(sorted(leaked)))

print(f"{OUT}  ({count} entries, {os.path.getsize(OUT)/1048576:.2f} MB)")
