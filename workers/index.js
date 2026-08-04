import { createWorkerHandler } from './router.js';
import { cleanExpiredProductionDrafts } from './production/cleanupDrafts.js';

const handlersByEnv = new WeakMap();

export function getWorkerHandler(env) {
  let handler = handlersByEnv.get(env);
  if (!handler) {
    handler = createWorkerHandler(env);
    handlersByEnv.set(env, handler);
  }
  return handler;
}

export default {
  fetch(request, env, ctx) {
    return getWorkerHandler(env)(request, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanExpiredProductionDrafts(env, controller.scheduledTime));
  },
};
