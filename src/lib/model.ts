import type { ISODate } from './dates';

/** Record types. Journal (beyond the morning intention), weekReview and topic no longer have screens in v2.1,
 *  but the types stay: their stored records are kept, exported and synced untouched.
 *  Every synced entity is one record: stable id, HLC stamp, optional tombstone. */
export interface Base { id: string; type: RecType; updatedAt: string; deleted?: boolean; date?: ISODate }

export type RecType =
  | 'block' | 'todo' | 'journal' | 'habit' | 'habitLog' | 'meal' | 'mealCat'
  | 'countdown' | 'weekReview' | 'sleep' | 'template' | 'recurring' | 'topic';

export interface Block extends Base { type: 'block'; date: ISODate; start: number; dur: number; title: string; log: string;
  cat: string; done: boolean; actualDur?: number; remindLead?: number | null; cue?: string }
export interface Todo extends Base { type: 'todo'; date: ISODate; text: string; done: boolean; time?: number | null;
  remindAt?: number | null; main?: boolean; when?: string; carriedFrom?: string }
export interface Journal extends Base { type: 'journal'; date: ISODate; intention: string; text: string; win: string;
  lesson: string; ifThen: string; mood?: number | null; energy?: number | null; tags: string[]; photos: string[] }
export interface HabitTarget { kind: 'daily' | 'weekly' | 'count'; perWeek?: number; count?: number; unit?: string }
export interface Habit extends Base { type: 'habit'; name: string; cue: string; target: HabitTarget; restDays: number[];
  remindTime?: number | null; archived?: boolean; activityMin?: number; createdOn: ISODate; order: number }
export interface HabitLog extends Base { type: 'habitLog'; date: ISODate; habitId: string; value: number }
export interface Meal extends Base { type: 'meal'; date: ISODate; time: number; name: string; tag: string; photos?: string[];
  /** v2.2, all optional: what was on the plate [protein, veg, carbs, fruit or dairy], macros in grams, calories (shown only if the setting is on). */
  groups?: boolean[]; macros?: { protein: number; carbs: number; fat: number }; calories?: number }
export interface MealCat extends Base { type: 'mealCat'; name: string; tag: string }
export interface Countdown extends Base { type: 'countdown'; label: string; target: ISODate }
export interface WeekReview extends Base { type: 'weekReview'; date: ISODate; good: string; drop: string; obstacle: string; plan: string; done?: boolean }
export interface Sleep extends Base { type: 'sleep'; date: ISODate; bed: number; wake: number }
export interface TemplateBlock { start: number; dur: number; title: string; cat: string; cue?: string }
export interface Template extends Base { type: 'template'; name: string; blocks: TemplateBlock[] }
export interface Recurring extends Base { type: 'recurring'; kind: 'block' | 'todo'; title: string; start?: number; dur?: number;
  cat?: string; days: number[]; from: ISODate; cue?: string }
export interface Topic extends Base { type: 'topic'; title: string; notes: string; interval: number; due: ISODate;
  reviews: { date: ISODate; ok: boolean }[] }

export type Rec = Block | Todo | Journal | Habit | HabitLog | Meal | MealCat | Countdown | WeekReview | Sleep | Template | Recurring | Topic;

export const CATS = ['Work', 'Study', 'Health', 'Life', 'Rest'] as const;

export function uid(prefix = ''): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
