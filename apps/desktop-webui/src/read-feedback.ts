import type { LocalizedMessage } from './locale.js';
import type { NoticeEvent } from './notices.js';

export type ReadNoticeOwner = Pick<NoticeEvent, 'identity' | 'object' | 'task' | 'generation'>;
export interface ReadFeedbackFacts {
  readonly owner: ReadNoticeOwner;
  readonly reading: boolean;
  readonly error?: string | LocalizedMessage;
  readonly tone?: 'error' | 'unknown';
  /** A successful read's own timestamp, revision, or replaced immutable result reference. */
  readonly confirmedVersion?: string | number | object;
}
export interface ReadFeedbackProjection {
  readonly owner: ReadNoticeOwner;
  readonly recovered: boolean;
  readonly event?: NoticeEvent;
  /** Nonmutating check for deferred retirement of the read attributed to this proof. */
  readonly currentConfirmation?: () => boolean;
}
interface Episode {
  failed: boolean;
  reading: boolean;
  proofToken: number;
  currentVersion?: ReadFeedbackFacts['confirmedVersion'];
  failureVersion?: ReadFeedbackFacts['confirmedVersion'];
  error?: ReadFeedbackFacts['error'];
  tone?: 'error' | 'unknown';
}

/** Display episodes only. It never starts reads, changes errors, or releases business locks. */
export class ReadFeedbackEpisodes {
  private identity = '';
  private episodes = new Map<string, Episode>();
  observe(facts: ReadFeedbackFacts, recovery: NoticeEvent['recovery']): ReadFeedbackProjection {
    if (facts.owner.identity !== this.identity) {
      this.identity = facts.owner.identity;
      this.episodes.clear();
    }
    const key = JSON.stringify([facts.owner.object, facts.owner.task, facts.owner.generation]);
    const episode: Episode = this.episodes.get(key) ?? { failed: false, reading: false, proofToken: 0 };
    this.episodes.set(key, episode);
    if (facts.reading && !episode.reading || facts.error || facts.confirmedVersion !== episode.currentVersion) episode.proofToken++;
    episode.reading = facts.reading;
    episode.currentVersion = facts.confirmedVersion;
    if (facts.error) {
      if (!episode.failed) {
        episode.failed = true;
        episode.failureVersion = facts.confirmedVersion;
      }
      episode.error = facts.error;
      episode.tone = facts.tone || 'error';
    }
    const confirmed = facts.confirmedVersion !== undefined && facts.confirmedVersion !== '';
    const fresh = facts.confirmedVersion !== episode.failureVersion;
    const recovered = episode.failed && !facts.reading && !facts.error && confirmed && fresh;
    if (recovered) {
      episode.failed = false;
      episode.error = undefined;
    }
    const error = episode.error, proofToken = episode.proofToken;
    const currentConfirmation = recovered ? () => this.identity === facts.owner.identity && this.episodes.get(key) === episode && !episode.failed && !episode.reading && episode.proofToken === proofToken : undefined;
    return { owner: facts.owner, recovered, currentConfirmation, event: episode.failed ? {
      ...facts.owner, key: `read-${episode.tone || 'error'}`, tone: episode.tone || 'error', message: () => String(error || ''), recovery,
    } : undefined };
  }
}

/** Exact attribution lets a fresh resource read retire only its earlier read record. */
export class ReadFeedbackBindings {
  private owners = new WeakMap<object, ReadNoticeOwner>();
  bind(record: { readonly kind: string }, owner: ReadNoticeOwner): void {
    if (record.kind === 'read') this.owners.set(record, owner);
  }
  has(record: object): boolean { return this.owners.has(record); }
  matches(record: object, owner: ReadNoticeOwner): boolean {
    const original = this.owners.get(record);
    return !!original && original.identity === owner.identity && original.object === owner.object && original.task === owner.task && original.generation === owner.generation;
  }
}
