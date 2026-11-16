export { BaseRepository } from './base.repository';
export { ShopRepository } from './shop.repository';
export { UserRepository } from './user.repository';
export { OrderRepository } from './order.repository';
export { FileRepository } from './file.repository';
export { AuditLogRepository } from './audit-log.repository';
export { PrintJobRepository } from './print-job.repository';
export { PrintAgentRepository } from './print-agent.repository';
export { SubscriptionRepository } from './subscription.repository';
export { CustomerAccountRepository } from './customer-account.repository';
export { NotificationRepository } from './notification.repository';

import { ShopRepository } from './shop.repository';
import { UserRepository } from './user.repository';
import { OrderRepository } from './order.repository';
import { FileRepository } from './file.repository';
import { AuditLogRepository } from './audit-log.repository';
import { PrintJobRepository } from './print-job.repository';
import { PrintAgentRepository } from './print-agent.repository';
import { SubscriptionRepository } from './subscription.repository';
import { CustomerAccountRepository } from './customer-account.repository';
import { NotificationRepository } from './notification.repository';

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
  printAgents: new PrintAgentRepository('printAgent'),
  subscriptions: new SubscriptionRepository('subscription'),
  customerAccounts: new CustomerAccountRepository('customerAccount'),
  notifications: new NotificationRepository('notification'),
};
