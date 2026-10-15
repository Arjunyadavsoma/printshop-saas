export { BaseRepository } from './base.repository';
export { ShopRepository } from './shop.repository';
export { UserRepository } from './user.repository';
export { OrderRepository } from './order.repository';
export { FileRepository } from './file.repository';
export { AuditLogRepository } from './audit-log.repository';
export { PrintJobRepository } from './print-job.repository';

import { getContainer } from '@/lib/container';
import { ShopRepository } from './shop.repository';
import { UserRepository } from './user.repository';
import { OrderRepository } from './order.repository';
import { FileRepository } from './file.repository';
import { AuditLogRepository } from './audit-log.repository';
import { PrintJobRepository } from './print-job.repository';

/** Lazy singleton repos — one per container. Routes import these. */
export const repos = {
  shops: new ShopRepository(getContainer().db, 'shop'),
  users: new UserRepository(getContainer().db, 'user'),
  orders: new OrderRepository(getContainer().db, 'order'),
  files: new FileRepository(getContainer().db, 'printFile'),
  audit: new AuditLogRepository(getContainer().db, 'auditLog'),
  printJobs: new PrintJobRepository(getContainer().db, 'printJob'),
};
