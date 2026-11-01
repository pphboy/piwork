import { messageText, t, type Feedback } from './locale.js';

/** Capture source facts only; read and credential owners retain their independent lifecycles. */
export function onboardingNoticeMessage(
  text: Feedback,
  source: {
    readonly task: string;
    readonly credential?: { readonly kind: 'administrator' | 'login'; readonly account: string } | null;
  },
): () => string {
  const task = source.task;
  const kind = source.credential?.kind;
  const account = source.credential?.account;
  return () => {
    const message = messageText(text);
    if (task === 'read') return t('onboarding.notice.readFailed', { message });
    if (kind && account !== undefined) return t(
      kind === 'administrator' ? 'onboarding.notice.administratorUnknown' : 'onboarding.notice.loginUnknown',
      { account, message },
    );
    return message;
  };
}
