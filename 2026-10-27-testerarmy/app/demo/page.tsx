'use client';
import { useState } from 'react';

type Todo = { id: number; text: string; done: boolean };

export default function Demo() {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [authed, setAuthed] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');

  const remaining = todos.filter((t) => !t.done).length;
  // DELIBERATE BUG for the demo: completing the last remaining item still shows "1 items left".
  const shownLeft = todos.length > 0 && remaining === 0 ? 1 : remaining;
  const box = 'rounded border border-neutral-300 px-3 py-2 text-sm';

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm rounded border border-neutral-200 bg-white p-6">
        <h1 className="mb-4 text-xl font-semibold">Demo Todo App</h1>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (user === 'demo' && pass === 'demo123') { setAuthed(true); setError(''); }
            else setError('Invalid credentials');
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-sm">Username</label>
            <input id="username" name="username" className={box} value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm">Password</label>
            <input id="password" name="password" type="password" className={box} value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">Sign in</button>
        </form>
        <p className="mt-4 text-xs text-neutral-400">Try demo / demo123</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded border border-neutral-200 bg-white p-6">
      <h1 className="mb-4 text-xl font-semibold">Your todos</h1>
      <form
        className="mb-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          setTodos([...todos, { id: Date.now(), text: draft.trim(), done: false }]);
          setDraft('');
        }}
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="new-todo" className="text-sm">New todo</label>
          <input id="new-todo" className={box} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">Add</button>
      </form>
      <ul className="space-y-2">
        {todos.map((t) => (
          <li key={t.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={t.done} onChange={() => setTodos(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} />
              <span className={t.done ? 'line-through text-neutral-400' : ''}>{t.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-neutral-600">{shownLeft} items left</p>
    </div>
  );
}
