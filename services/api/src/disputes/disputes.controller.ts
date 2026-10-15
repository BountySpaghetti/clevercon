import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { DisputesService } from './disputes.service.js';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../auth/validate.js';
import type { AuthUser } from '../auth/types.js';

const openSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().max(2000).optional(),
});

/** The buyer's disputes: open one (freezes the task on-chain) and track them. */
@Controller('disputes')
@UseGuards(ApiAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * Open a dispute on a locked task. Returns the unsigned `raise_dispute` XDR;
   * sign it and POST it to /vault/submit to freeze the task on-chain.
   */
  @Post()
  open(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { taskId, reason } = parseBody(openSchema, body);
    return this.disputes.open(user.userId, taskId, reason);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.disputes.list(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.get(user.userId, id);
  }
}
