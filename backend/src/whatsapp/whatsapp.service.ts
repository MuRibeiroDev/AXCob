import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Cliente do Evolution API (mesma lógica do whatsapp_evolution.py). */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly config: ConfigService) {}

  private cfg(): { base: string; key: string; inst: string } {
    const base = (this.config.get<string>('EVOLUTION_API_URL') ?? '').replace(/\/$/, '');
    const key = (this.config.get<string>('EVOLUTION_API_KEY') ?? '').trim();
    const inst = (this.config.get<string>('EVOLUTION_API_INSTANCE') ?? '').trim();
    if (!base || !key || !inst) {
      throw new Error('EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_API_INSTANCE não configurados.');
    }
    return { base, key, inst };
  }

  /** Mantém só dígitos — Evolution usa 55<DDD><NUMERO>. */
  normalizeNumber(raw: string): string {
    return (raw ?? '').replace(/\D/g, '');
  }

  /** Envia texto simples: POST /message/sendText/<instance>. */
  async sendText(number: string, text: string): Promise<{ number: string; ok: boolean; erro?: string }> {
    const num = this.normalizeNumber(number);
    if (!num) return { number, ok: false, erro: 'número inválido' };
    if (!text?.trim()) return { number: num, ok: false, erro: 'texto vazio' };

    const { base, key, inst } = this.cfg();
    try {
      const res = await fetch(`${base}/message/sendText/${inst}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({ number: num, text }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = JSON.stringify(await res.json()).slice(0, 400); } catch { /* */ }
        this.logger.warn(`Evolution sendText ${num} falhou: ${detail}`);
        return { number: num, ok: false, erro: detail };
      }
      this.logger.log(`Evolution texto enviado (${text.length} chars) -> ${num}`);
      return { number: num, ok: true };
    } catch (e) {
      return { number: num, ok: false, erro: (e as Error).message };
    }
  }

  /** Envia uma imagem (base64) via Evolution: POST /message/sendMedia/<instance>. */
  async sendMedia(number: string, base64: string, fileName: string, caption?: string): Promise<{ number: string; ok: boolean; erro?: string }> {
    const num = this.normalizeNumber(number);
    if (!num) return { number, ok: false, erro: 'número inválido' };
    if (!base64) return { number: num, ok: false, erro: 'imagem vazia' };

    const { base, key, inst } = this.cfg();
    try {
      const res = await fetch(`${base}/message/sendMedia/${inst}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({ number: num, mediatype: 'image', mimetype: 'image/png', media: base64, fileName, ...(caption ? { caption } : {}) }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = JSON.stringify(await res.json()).slice(0, 400); } catch { /* */ }
        this.logger.warn(`Evolution sendMedia ${num} falhou: ${detail}`);
        return { number: num, ok: false, erro: detail };
      }
      this.logger.log(`Evolution imagem enviada (${fileName}) -> ${num}`);
      return { number: num, ok: true };
    } catch (e) {
      return { number: num, ok: false, erro: (e as Error).message };
    }
  }

  /** Envia o mesmo texto para vários números. */
  async sendTextMany(numbers: string[], text: string) {
    const resultados = [];
    for (const n of numbers) resultados.push(await this.sendText(n, text));
    const ok = resultados.filter((r) => r.ok).length;
    return { total: resultados.length, ok, falhas: resultados.length - ok, resultados };
  }
}
