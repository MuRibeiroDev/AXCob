import { Global, Module } from '@nestjs/common';
import { UserConfigController } from './user-config.controller';
import { UserConfigService } from './user-config.service';

@Global()
@Module({
  controllers: [UserConfigController],
  providers: [UserConfigService],
  exports: [UserConfigService],
})
export class UserConfigModule {}
