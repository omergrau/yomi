// Used by the web preview only. The phone uses repo.native.ts with SQLite.
import { applyChange, emptyData } from '../domain/logic';
import type { AppData, Change, TaskEvent } from '../domain/types';
import type { Repo } from './repoTypes';

export function openRepo(): Repo {
  let data: AppData = emptyData();
  let events: TaskEvent[] = [];
  return {
    load: () => data,
    apply(change: Change) {
      data = applyChange(data, change);
      if (change.events?.length) events = [...events, ...change.events];
    },
    removeEvents: (ids) => {
      events = events.filter((e) => !ids.includes(e.id));
    },
    eventsFor: (taskId) => events.filter((e) => e.taskId === taskId),
    allEvents: () => events,
    replaceAll(d, e) {
      data = d;
      events = e;
    },
  };
}
