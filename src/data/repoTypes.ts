import type { AppData, Change, TaskEvent } from '../domain/types';

export interface Repo {
  load(): AppData;
  apply(change: Change): void;
  removeEvents(ids: string[]): void;
  eventsFor(taskId: string): TaskEvent[];
  allEvents(): TaskEvent[];
  replaceAll(data: AppData, events: TaskEvent[]): void;
}
