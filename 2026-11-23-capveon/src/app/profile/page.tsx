import { getProfile } from "@/lib/data";
import { ProfileForm } from "../components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await getProfile();
  return (
    <>
      <h1>Company profile</h1>
      <p className="sub">What you sell and where. Fit scores on every signal are computed from this (fictional) profile.</p>
      <ProfileForm initial={profile} />
    </>
  );
}
