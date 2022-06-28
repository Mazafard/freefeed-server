import monitorDog from 'monitor-dog';

import { NotAuthorizedException } from '../../support/exceptions';

/**
 * Middleware that monitors requests count and duration
 *
 * @param {string|{timer: string, requests: string}} monitorName
 * @param {object} monitor
 */
export function monitored(monitorName, monitor = monitorDog) {
  return async (ctx, next) => {
    if (ctx.state.isMonitored) {
      await next();
      return;
    }

    ctx.state.isMonitored = true;

    let timerName, requestsName;

    if (typeof monitorName === 'string') {
      timerName = `${monitorName}-time`;
      requestsName = `${monitorName}-requests`;
    } else {
      ({ timer: timerName, requests: requestsName } = monitorName);
    }

    const timer = monitor.timer(timerName);

    if (ctx.serverTiming) {
      ctx.serverTiming.start('controller', timerName);
    }

    try {
      await next();
      const authTokenType = ctx.state.authJWTPayload?.type || 'anonymous';
      monitor.increment(requestsName, 1, { auth: authTokenType });
    } finally {
      timer.stop();

      if (ctx.serverTiming) {
        ctx.serverTiming.stop('controller');
      }

      Reflect.deleteProperty(ctx.state, 'isMonitored');
    }
  };
}

export function authRequired() {
  return async (ctx, next) => {
    if (!ctx.state.user) {
      throw new NotAuthorizedException();
    }

    await next();
  };
}

export { postAccessRequired } from './post-access-required';
export { targetUserRequired } from './target-user-required';
export { inputSchemaRequired } from './input-schema-required';
export { commentAccessRequired } from './comment-access-required';
