import { redirect } from "next/navigation";
import { AegisClient } from "./aegis-client";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authenticated = await getChatGPTUser();
  const user =
    authenticated ??
    (process.env.NODE_ENV !== "production"
      ? {
          email: "local-preview@aegis.test",
          displayName: "Aegis Tester",
          fullName: "Aegis Tester",
        }
      : null);

  if (!user) redirect(chatGPTSignInPath("/"));

  return (
    <AegisClient
      user={{ email: user.email, displayName: user.displayName }}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
