import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly jwt: JwtService) {}

  /** Login: valida na users_qitech e devolve um JWT + dados do usuário. */
  @Public()
  @Post('login')
  async login(@Body() body: { login?: string; senha?: string }) {
    const user = await this.auth.validar(body?.login ?? '', body?.senha ?? '');
    if (!user) throw new UnauthorizedException('Usuário ou senha inválidos.');
    const token = await this.jwt.signAsync({ sub: user.id, username: user.username, email: user.email, nome: user.nome, role: user.role, phone: user.phone });
    return { token, user };
  }

  /** Retorna o usuário do token (p/ a tela validar a sessão ao carregar). */
  @Get('me')
  me(@Req() req: any) {
    const u = req.user ?? {};
    return { id: u.sub, username: u.username, email: u.email, nome: u.nome, role: u.role, phone: u.phone };
  }
}
