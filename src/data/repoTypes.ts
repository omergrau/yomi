import type { SavedChat } from '../assistant/chats';
import type { AppData, Change, TaskEvent } from '../domain/types';

export interface Repo {
  load(): AppData;
  apply(change: Change): void;
  removeEvents(ids: string[]): void;
  eventsFor(taskId: string): TaskEvent[];
  allEvents(): TaskEvent[];
  replaceAll(data: AppData, events: TaskEvent[]): void;
  /** The saved talks with the assistant. They live apart from the plan and are not part of a backup. */
  chats(): SavedChat[];
  putChat(chat: SavedChat): void;
  removeChat(id: string): void;
}
