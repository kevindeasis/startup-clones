export function err(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
