import { Global, Module } from '@nestjs/common';
import { BitrixService } from './bitrix.service';

@Global()
@Module({
  providers: [BitrixService],
  exports: [BitrixService],
})
export class BitrixModule {}
