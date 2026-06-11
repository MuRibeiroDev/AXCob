import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Put, Req } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';

/** Telas válidas do AxCob (chaves de permissão). Mantém em sincronia com o front. */
const TELAS = new Set([
  'visao-geral', 'titulos-vencidos', 'negativacao-protestos', 'pix', 'relatorios', 'configuracoes',
]);

@Controller('admin')
export class AdminController {
  constructor(private readonly auth: AuthService) {}

  /** Só administradores DO AxCob (flag isAdmin no JWT — role é compartilhado). */
  private assertAdmin(req: any): void {
    if (!req.user?.isAdmin) throw new ForbiddenException('Acesso restrito a administradores.');
  }

  /** Lista os usuários + suas permissões de tela. */
  @Get('users')
  async users(@Req() req: any) {
    this.assertAdmin(req);
    return this.auth.listarUsuariosAdmin();
  }

  /** Define as telas liberadas de um usuário (permissoes=null → todas). */
  @Put('users/:id/permissoes')
  async setPermissoes(@Req() req: any, @Param('id') id: string, @Body() body: { permissoes?: string[] | null }) {
    this.assertAdmin(req);
    const userId = Number(id);
    if (!Number.isFinite(userId)) throw new BadRequestException('id inválido.');
    const perms = Array.isArray(body?.permissoes)
      ? body!.permissoes!.filter((p) => TELAS.has(String(p)))
      : null;
    try {
      await this.auth.salvarPermissoesTela(userId, perms);
    } catch (e) {
      throw new BadRequestException(
        `Não consegui salvar — confirme que a coluna "permissions_cobranca" (NVARCHAR) existe na Ax_Caixa.users_qitech. (${(e as Error).message})`,
      );
    }
    return { ok: true, permissoes: perms };
  }
}
