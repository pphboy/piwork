import { useCallback, useEffect, useState } from 'react';
import { draft, saveDraft, watchVersion, rememberPath, restorePath } from './version-client';
import './style.css';

type Todo = { id: string; title: string; completed: boolean };
type Query<T> = { value: T; stateVersion: string; codeVersion: string };
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.code || `Request failed (${response.status})`);
  return value;
}

export default function App() {
  const [path, setPath] = useState(restorePath);
  const [todos, setTodos] = useState<Query<Todo[]> | undefined>();
  const [review, setReview] = useState<Query<{ completed: Todo[]; open: Todo[] }> | undefined>();
  const [title, setTitle] = useState(() => draft('todo-title'));
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [eventId, setEventId] = useState(() => draft('feedback-event'));
  const [feedback, setFeedback] = useState('');
  const [exportJob, setExportJob] = useState('');
  const [connection, setConnection] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [actualTodos, actualReview] = await Promise.all([request('/ui/queries/todos'), request('/ui/queries/review')]);
      setTodos(actualTodos); setReview(actualReview); setConnection('');
    } catch (error) { setConnection(String((error as Error).message)); }
  }, []);
  useEffect(() => { void refresh(); return watchVersion(() => { void refresh(); }, setConnection); }, [refresh]);
  useEffect(() => {
    const pop = () => { rememberPath(); setPath(location.pathname); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => { void request('/ui/visits', { pathname: path }).catch(() => undefined); }, [path]);
  useEffect(() => {
    if (!eventId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const receipt = await request('/ui/receipts/' + encodeURIComponent(eventId));
        let message = `Feedback ${receipt.delivery} · event ${eventId}`;
        if (receipt.receipt?.requestId) {
          const result = await request('/ui/requests/' + encodeURIComponent(receipt.receipt.requestId));
          message += ` · Pi request ${result.request.requestId} · ${result.request.state}`;
          if (result.request.result) message += ` · ${result.request.result}`;
          if (result.request.state === 'completed') void refresh();
        }
        if (!stopped) setFeedback(message);
      } catch { if (!stopped) setFeedback('Pi status unavailable; checking automatically.'); }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [eventId, refresh]);

  const navigate = (next: string) => { history.pushState({}, '', next); rememberPath(); setPath(next); };
  const action = async (name: string, input: unknown) => {
    if (busy || !todos) return;
    setBusy(true); setNotice('');
    const actionId = 'user-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    try {
      let result;
      try { result = await request('/ui/actions/' + name, { actionId, input, expectedStateVersion: todos.stateVersion }); }
      catch (error) {
        // Reconcile a lost response using the original ID; do not replay mutation.
        try { result = await request('/ui/actions/' + actionId); } catch { throw error; }
      }
      if (!['succeeded', 'accepted', 'running'].includes(result.state)) throw new Error(result.error?.code || 'Action failed');
      if (name === 'todo_add') { setTitle(''); saveDraft('todo-title', ''); }
      if (result.jobId) setExportJob(result.jobId);
      await refresh();
    } catch (error) { setNotice(String((error as Error).message)); await refresh(); }
    finally { setBusy(false); }
  };
  const report = async () => {
    try {
      const result = await request('/ui/feedback', { reason: 'review_missing', goal: 'The personal review omits completed Todos. Verify and repair the original review.' });
      saveDraft('feedback-event', result.eventId); setEventId(result.eventId);
    } catch (error) { setNotice(String((error as Error).message)); }
  };

  return <main>
    <header><p className="eyebrow">YOUR WORKSPACE</p><h1>Personal workstation</h1><p>Build a little structure around your day.</p></header>
    <nav><a href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>Todos</a><a href="/review" onClick={e => { e.preventDefault(); navigate('/review'); }}>Personal review</a></nav>
    {connection && <p role="status">{connection}</p>}
    {notice && <p role="alert">{notice}</p>}
    {path === '/review' ? <section>
      <h2>Personal review</h2><p>Completed Todos: {review?.value.completed.length ?? 0}</p>
      {review?.value.completed.map(todo => <p key={todo.id}>{todo.title}</p>)}
      <button onClick={() => { void report(); }}>Report missing completed Todos</button>
      <p role="status">{feedback || 'No feedback submitted.'}</p>
      <button disabled={busy} onClick={() => { void action('export_review', {}); }}>Export review</button>
      <p>{exportJob ? `Export Job ${exportJob}` : 'No export requested.'}</p>
    </section> : <section>
      <h2>Todos</h2><form onSubmit={e => { e.preventDefault(); void action('todo_add', { title }); }}>
        <label>Todo title<input value={title} maxLength={200} onChange={e => { setTitle(e.target.value); saveDraft('todo-title', e.target.value); }} /></label>
        <button disabled={busy || !title.trim() || !todos}>Add Todo</button>
      </form>
      <ul>{todos?.value.map(todo => <li key={todo.id}><span>{todo.title}</span>{todo.completed ? <span>Completed</span> : <button disabled={busy} onClick={() => { void action('todo_complete', { id: todo.id }); }}>Complete</button>}</li>)}</ul>
      {!todos && <p>Reading your workspace…</p>}
    </section>}
    <footer>Changes appear automatically. Your work stays in this Work.</footer>
  </main>;
}
