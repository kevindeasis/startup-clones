"use client";

import { useState } from "react";

export function AttachmentField() {
  const [text, setText] = useState("");
  const [name, setName] = useState("pasted.txt");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setName(f.name);
    setText(await f.text());
  }

  return (
    <div className="space-y-2">
      <label className="label">Attachment (text only)</label>
      <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} className="text-sm" />
      <input type="hidden" name="attachment_name" value={name} />
      <textarea name="attachment_text" value={text} onChange={(e) => setText(e.target.value)} rows={8}
        placeholder="...or paste document text here" className="input font-mono" />
    </div>
  );
}
