# syntax=docker/dockerfile:1.7
# Worker dos relatórios PNG. Base oficial do Playwright p/ Python: já traz Python,
# o Playwright 1.58 e os navegadores (Chromium) instalados com as libs de sistema.
FROM mcr.microsoft.com/playwright/python:v1.58.0-noble

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_NO_SANDBOX=1

# Os navegadores já vêm na base (/ms-playwright); aqui instalamos o pacote pip
# do Playwright (a base não o traz) + deps dos scripts. Versão casa com a imagem.
RUN pip install --no-cache-dir playwright==1.58.0 pillow holidays

# Código dos scripts + servidor do worker (o build é feito com contexto = raiz)
COPY scripts/ ./scripts/

# Diretório da sessão do Power BI (montado como volume → persiste o login)
RUN mkdir -p /app/session

EXPOSE 8500
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8500/health')" || exit 1

CMD ["python", "-u", "scripts/report_worker.py"]
