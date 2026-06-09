"""Worker HTTP dos relatórios PNG (Power BI via Playwright).

Roda num container próprio (Python + Playwright + Chromium). O backend NestJS
dispara `POST /run {script, args, outBase}`; o worker executa o script Python,
coleta os PNGs gerados (<outBase>_N.png em scripts/), devolve os bytes em base64
e apaga os arquivos. Sem volume compartilhado de filesystem com o backend.

Endpoints:
  GET  /health  -> 200 {"ok": true}
  POST /run     -> {"ok", "code", "stderr", "images": [base64, ...]}
"""
from __future__ import annotations
import base64
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # /app
SCRIPTS = ROOT / "scripts"
PORT = int(os.environ.get("WORKER_PORT", "8500"))
# Só permite rodar os scripts de captura conhecidos (evita execução arbitrária).
SCRIPT_OK = re.compile(r"^powerbi_[a-z]+\.py$")


def run_job(script: str, args: list[str], out_base: str) -> dict:
    cmd = [sys.executable, "-u", str(SCRIPTS / script), *args]
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(cmd, cwd=str(ROOT), env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        return {"ok": False, "code": proc.returncode, "stderr": proc.stderr[-2000:], "images": []}

    # Descobre as partes geradas: <out_base>_<N>.png (nº de partes é adaptativo).
    pat = re.compile(rf"^{re.escape(out_base)}_(\d+)\.png$")
    achados = sorted(
        ((int(m.group(1)), p) for p in SCRIPTS.iterdir() if (m := pat.match(p.name))),
        key=lambda t: t[0],
    )
    images: list[str] = []
    for _, p in achados:
        images.append(base64.b64encode(p.read_bytes()).decode("ascii"))
        try:
            p.unlink()
        except OSError:
            pass
    return {"ok": bool(images), "code": 0, "stderr": proc.stderr[-2000:], "images": images}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/run":
            self._send(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n) or b"{}")
            script = str(payload["script"])
            args = [str(a) for a in payload.get("args", [])]
            out_base = str(payload["outBase"])
        except Exception as e:
            self._send(400, {"error": f"bad request: {e}"})
            return
        if not SCRIPT_OK.match(script):
            self._send(400, {"error": f"script não permitido: {script}"})
            return
        print(f"[worker] run {script} {' '.join(args)} -> {out_base}", flush=True)
        try:
            result = run_job(script, args, out_base)
        except Exception as e:
            self._send(500, {"ok": False, "code": -1, "error": str(e), "images": []})
            return
        if result["ok"]:
            print(f"[worker] ok {script}: {len(result['images'])} parte(s)", flush=True)
            self._send(200, result)
        else:
            print(f"[worker] falha {script} (code {result['code']})", flush=True)
            self._send(500, result)

    def log_message(self, fmt: str, *a) -> None:  # silencia o log padrão (verboso)
        pass


if __name__ == "__main__":
    print(f"[worker] ouvindo em 0.0.0.0:{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
