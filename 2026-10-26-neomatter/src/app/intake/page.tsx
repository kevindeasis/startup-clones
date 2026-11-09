import { submitIntake } from "../actions";
import { AttachmentField } from "@/components/AttachmentField";

export default function IntakePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Simulated inbox</h1>
      <p className="mb-4 text-sm text-stone-600">
        Submit a legal request as if it arrived by email, Slack or Teams. Real integrations can call <code>POST /api/intake</code>.
      </p>
      <form action={submitIntake} className="card space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="channel">Channel</label>
            <select id="channel" name="channel" className="input">
              <option value="email">email</option><option value="slack">slack</option><option value="teams">teams</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rn">Requester name</label>
            <input id="rn" name="requester_name" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="re">Requester email</label>
            <input id="re" name="requester_email" type="email" className="input" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="subject">Subject</label>
          <input id="subject" name="subject" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="body">Message</label>
          <textarea id="body" name="body" required rows={6} className="input" />
        </div>
        <AttachmentField />
        <button className="btn btn-primary" type="submit">Submit and triage</button>
      </form>
    </div>
  );
}
