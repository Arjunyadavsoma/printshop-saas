export { BaseRepository } from './base.repository';
export { ShopRepository } from './shop.repository';
export { UserRepository } from './user.repository';
export { OrderRepository } from './order.repository';
export { FileRepository } from './file.repository';
export { AuditLogRepository } from './audit-log.repository';
export { PrintJobRepository } from './print-job.repository';

import { ShopRepository } from './shop.repository';
import { UserRepository } from './user.repository';
import { OrderRepository } from './order.repository';
import { FileRepository } from './file.repository';
import { AuditLogRepository } from './audit-log.repository';
import { PrintJobRepository } from './print-job.repository';

/** Lazy singleton repos — one per table. Routes import these. The adapter is
 *  resolved lazily from the container on each call, so setContainerForTesting
 *  (in tests) re-routes these to an in-memory db. */
export const repos = {
  shops: new ShopRepository('shop'),
  users: new UserRepository('user'),
  orders: new OrderRepository('order'),
  files: new FileRepository('printFile'),
  audit: new AuditLogRepository('auditLog'),
  printJobs: new PrintJobRepository('printJob'),
};
