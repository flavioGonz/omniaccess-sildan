export const dynamic = "force-dynamic";
export async function GET() {
    return Response.json({ versionCode: 6, versionName: "1.5", url: "/api/apk" }, { headers: { "Cache-Control": "no-store" } });
}
