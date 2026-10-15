import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { VaultModule } from '../vault/vault.module.js';
import { DisputesService } from './disputes.service.js';
import { DisputesController } from './disputes.controller.js';

@Module({
  imports: [AuthModule, ApiKeysModule, VaultModule], // VaultModule exports VaultContractService
  controllers: [DisputesController],
  providers: [DisputesService, ApiAuthGuard],
})
export class DisputesModule {}
