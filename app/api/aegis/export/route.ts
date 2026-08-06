import { getAegisApiUser } from "@/lib/aegis-auth";
import { exportAegisData } from "@/lib/aegis-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = getAegisApiUser(request);
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    const body = JSON.stringify(await exportAegisData(user.email), null, 2);
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="aegis-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Export failed." },
      { status: 500 },
    );
  }
}
