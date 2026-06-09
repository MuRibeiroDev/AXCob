/* Configurações por usuário (webhook do Bitrix). Persiste em SQLite. */
import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UserConfigStore } from './user-config.store';

@Injectable()
export class UserConfigService {
  private store_?: UserConfigStore;

  private repoRoot(): string {
    const guess = path.resolve(__dirname, '..', '..', '..');
    if (fs.existsSync(path.join(guess, 'scripts'))) return guess;
    return path.resolve(process.cwd(), '..');
  }
  private store(): UserConfigStore {
    if (!this.store_) this.store_ = new UserConfigStore(path.join(this.repoRoot(), 'data', 'user-config.db'));
    return this.store_;
  }

  /** Webhook do Bitrix do usuário (ou null). */
  webhookDoUsuario(userId: number): string | null {
    return this.store().getWebhook(userId);
  }

  /** Valida o formato e salva o webhook do usuário. String vazia limpa. */
  salvarWebhook(userId: number, webhook: string): string | null {
    const v = (webhook ?? '').trim().replace(/\/$/, '');
    if (!v) {
      this.store().setWebhook(userId, null);
      return null;
    }
    // Formato esperado: https://<conta>.bitrix24.com.br/rest/<id>/<token>
    if (!/^https?:\/\/[^/]+\/rest\/\d+\/[A-Za-z0-9]+\/?$/.test(v)) {
      throw new BadRequestException(
        'Webhook inválido. Cole a URL completa, ex.: https://suaconta.bitrix24.com.br/rest/123/token/',
      );
    }
    this.store().setWebhook(userId, v);
    return v;
  }
}
