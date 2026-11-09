import { handler, json, parseBody } from '@/lib/http';
import { CreateRoleIn } from '@/lib/schemas';
import { createRole, insertModel, listRoles } from '@/lib/repo';
import { draftRubric } from '@/lib/ai/draftRubric';

export const dynamic = 'force-dynamic';
export const GET = handler(async () => json({ roles: listRoles() }));

export const POST = handler(async (req) => {
  const { title, job_description } = await parseBody(req, CreateRoleIn);
  const draft = await draftRubric(job_description);
  const draft_criteria = draft.map((c, i) => ({ ...c, id: `c${i + 1}` }));
  const role = createRole(title, job_description);
  // The draft is stored as a 'proposed' v1 until the user saves it from the setup screen.
  insertModel(role.id, 1, 'proposed', draft_criteria, [], 'Drafted from job description');
  return json({ role, draft_criteria }, 201);
});
