import Link from "next/link";

export default function Home() {
  return (
    <>
      <h1>Welcome to the City of Pinecrest permit portal</h1>
      <p className="muted">
        An independent learning clone of Verdant (AI permitting for local governments). Not affiliated with Verdant.
      </p>
      <div className="cards">
        <Link href="/apply" className="card">
          <h2>I&apos;m a resident</h2>
          <p>Ask which permits you need and file a complete application.</p>
        </Link>
        <Link href="/staff" className="card">
          <h2>I&apos;m city staff</h2>
          <p>Review applications, check code compliance and draft staff reports.</p>
        </Link>
      </div>
    </>
  );
}
