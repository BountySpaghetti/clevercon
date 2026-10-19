import { Module } from '@nestjs/common';
import { VaultModule } from '../vault/vault.module.js';
import { ServicesService } from './services.service.js';
import { ServicesController } from './services.controller.js';

@Module({
  imports: [VaultModule], // VaultContractService for the public protocol-fee read
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
