import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from './public.decorator';

/** Guard global: exige JWT válido, exceto em rotas @Public.
 *  Aceita o token no header Authorization: Bearer OU em ?access_token=
 *  (necessário p/ <img> de relatórios que não envia header). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth = (req.headers?.authorization as string | undefined) ?? '';
    let token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token && req.query?.access_token) token = String(req.query.access_token);
    if (!token) throw new UnauthorizedException('Autenticação necessária.');

    try {
      req.user = this.jwt.verify(token, { secret: this.config.get<string>('JWT_SECRET') });
      return true;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }
}
