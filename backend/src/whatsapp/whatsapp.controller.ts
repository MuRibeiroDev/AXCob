import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

interface EnviarTextoBody {
  numbers: string[];
  texto: string;
}

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly wa: WhatsappService) {}

  /** Envia um texto (relatório) para um ou mais números via Evolution. */
  @Post('enviar-texto')
  enviarTexto(@Body() body: EnviarTextoBody) {
    const numbers = (body?.numbers ?? []).filter((n) => n && n.trim());
    if (numbers.length === 0) throw new BadRequestException('Informe ao menos um número.');
    if (!body?.texto?.trim()) throw new BadRequestException('Texto vazio.');
    return this.wa.sendTextMany(numbers, body.texto);
  }
}
