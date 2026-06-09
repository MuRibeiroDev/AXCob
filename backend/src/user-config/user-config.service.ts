/* Configurações por usuário (webhook do Bitrix). Persiste na coluna
   webhook_bitrix_deal da Ax_Caixa.users_qitech, via AuthService. */
import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UserConfigService {
  constructor(private readonly auth: AuthService) {}

  /** Webhook do Bitrix do usuário (ou null). */
  webhookDoUsuario(userId: number): Promise<string | null> {
    return this.auth.webhookDoUsuario(userId);
  }

  /** Valida o formato e salva o webhook do usuário. String vazia limpa. */
  async salvarWebhook(userId: number, webhook: string): Promise<string | null> {
    const v = (webhook ?? '').trim().replace(/\/$/, '');
    if (!v) {
      await this.auth.salvarWebhook(userId, null);
      return null;
    }
    // Formato esperado: https://<conta>.bitrix24.com.br/rest/<id>/<token>
    if (!/^https?:\/\/[^/]+\/rest\/\d+\/[A-Za-z0-9]+\/?$/.test(v)) {
      throw new BadRequestException(
        'Webhook inválido. Cole a URL completa, ex.: https://suaconta.bitrix24.com.br/rest/123/token/',
      );
    }
    await this.auth.salvarWebhook(userId, v);
    return v;
  }
}
