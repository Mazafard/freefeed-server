import Knex from 'knex';

import { DbAdapter } from './support/DbAdapter';
import { PubSubAdapter } from './support/PubSubAdapter';
import { GONE_NAMES } from './models/user';
import { UUID } from './support/types';
import { SessionTokenV1Store } from './models/auth-tokens';

export const postgres: Knex;
export const dbAdapter: DbAdapter;
export const PubSub: PubSubAdapter;

export class User {
  intId: number;
  username: string;
  readonly isActive: boolean;
  setGoneStatus(status: keyof typeof GONE_NAMES): Promise<void>;
  unban(usernames: string): Promise<1>;
  unsubscribeFrom(targetUser: User): Promise<boolean>;
  getHomeFeeds(): Promise<Timeline[]>;
  getSubscriptionsWithHomeFeeds(): Promise<{ user_id: UUID; homefeed_ids: UUID[] }[]>;
}

export class Group {}

export class Post {
  destroy(destroyedBy?: User): Promise<void>;
  removeLike(user: User): Promise<boolean>;
}

export class Timeline {
  destroy(): Promise<void>;
}

export class Attachment {
  destroy(destroyedBy?: User): Promise<void>;
}

export class Comment {
  removeLike(user: User): Promise<boolean>;
}

export const sessionTokenV1Store: SessionTokenV1Store;

export { AuthToken, SessionTokenV0, AppTokenV1, SessionTokenV1 } from './models/auth-tokens';

export class ServerInfo {}

export class Job {}

export class JobManager {}

export {
  HOMEFEED_MODE_CLASSIC,
  HOMEFEED_MODE_FRIENDS_ALL_ACTIVITY,
  HOMEFEED_MODE_FRIENDS_ONLY,
} from './models/timeline';