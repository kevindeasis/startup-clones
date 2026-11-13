import InterviewClient from "../../../components/InterviewClient";

export default async function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InterviewClient token={token} />;
}
