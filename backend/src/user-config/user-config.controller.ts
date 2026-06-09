import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { BitrixService } from '../bitrix/bitrix.service';
import { UserConfigService } from './user-config.service';

@Controller('config')
export class UserConfigController {
  constructor(
    private readonly cfg: UserConfigService,
    private readonly bitrix: BitrixService,
  ) {}

  /** Configurações do PRÓPRIO usuário logado. */
  @Get()
  async minhas(@Req() req: any) {
    const userId = Number(req.user?.sub ?? req.user?.id);
    const webhook = await this.cfg.webhookDoUsuario(userId);
    const dono = webhook ? await this.bitrix.usuarioDoWebhook(webhook) : null;
    return { bitrixWebhook: webhook, bitrixNome: dono?.nome ?? null };
  }

  /** Salva o webhook do Bitrix do usuário (e confirma de quem é). */
  @Put('bitrix-webhook')
  async salvarWebhook(@Req() req: any, @Body() body: { webhook?: string }) {
    const userId = Number(req.user?.sub ?? req.user?.id);
    const salvo = await this.cfg.salvarWebhook(userId, body?.webhook ?? '');
    const dono = salvo ? await this.bitrix.usuarioDoWebhook(salvo) : null;
    return { bitrixWebhook: salvo, bitrixNome: dono?.nome ?? null };
  }
}
