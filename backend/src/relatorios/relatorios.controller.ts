import { BadRequestException, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RelatoriosService } from './relatorios.service';

@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  /** Catálogo de relatórios. */
  @Get()
  catalogo() {
    return this.service.catalogo();
  }

  /** Aging da carteira (faixas de atraso × valor). */
  @Get('aging')
  aging() {
    return this.service.aging();
  }

  /** Recebimentos por mês (últimos 12). */
  @Get('recebimentos')
  recebimentos() {
    return this.service.recebimentos();
  }

  /** Exposição em aberto por UF do cedente. */
  @Get('exposicao-uf')
  exposicaoUf() {
    return this.service.exposicaoUf();
  }

  /** Gera o texto de um relatório TEXTO (comissárias). */
  @Get(':id/texto')
  texto(@Param('id') id: string) {
    return this.service.gerarTexto(id);
  }

  /** Envia todos os relatórios (na ordem fixa) por WhatsApp para o telefone do
   *  PRÓPRIO usuário logado (cadastrado na users_qitech). */
  @Post('enviar-sequencia')
  enviarSequencia(@Req() req: any) {
    const phone = (req.user?.phone ?? '').toString().replace(/\D/g, '');
    if (!phone) {
      throw new BadRequestException('Seu usuário não tem telefone (WhatsApp) cadastrado.');
    }
    return this.service.enviarSequencia([phone]);
  }

  /** Dispara a geração de um relatório PNG (Power BI). Assíncrono. */
  @Post(':id/gerar-png')
  gerarPng(@Param('id') id: string) {
    return this.service.iniciarPng(id);
  }

  /** Status da geração do PNG (idle | gerando | pronto | erro). */
  @Get(':id/status-png')
  statusPng(@Param('id') id: string) {
    return this.service.statusPng(id);
  }

  /** Serve uma imagem gerada (do SQLite) por id + parte. ?download=1 força download. */
  @Get('imagem/:id/:parte')
  imagem(
    @Param('id') id: string,
    @Param('parte') parte: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    const buf = this.service.imagemBlob(id, Number(parte));
    if (download === '1' || download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${id}_${parte}.png"`);
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }
}
